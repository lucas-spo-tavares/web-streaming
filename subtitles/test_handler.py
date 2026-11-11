import json
import os
import time
import unittest
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import handler


class ClientError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class NoSuchKey(ClientError):
    pass


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.key = "12345678-1234-4123-8123-123456789abc/filme.mkv"
        self.record = {
            "s3": {
                "bucket": {"name": "media"},
                "object": {"key": self.key, "eTag": "etag"},
            }
        }
        self.s3 = Mock()
        self.s3.exceptions = SimpleNamespace(
            ClientError=ClientError, NoSuchKey=NoSuchKey
        )
        self.s3.head_object.return_value = {"LastModified": datetime.now(UTC)}
        self.s3.get_object.side_effect = NoSuchKey("NoSuchKey")
        self.s3.generate_presigned_url.return_value = "https://s3.test/video?secret"
        self.dynamo = Mock()
        self.dynamo.get_item.return_value = {}
        self.context = SimpleNamespace(get_remaining_time_in_millis=lambda: 900000)
        self.env = patch.dict(
            os.environ, {"MEDIA_BUCKET": "media", "RETENTION_TABLE": "retention"}
        )
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_generated_files_do_not_start_extraction(self):
        for name in ("tracks.json", "3-por.srt", "3-por.vtt"):
            self.record["s3"]["object"]["key"] = self.key.rsplit("/", 1)[0] + "/" + name
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
        self.s3.head_object.assert_not_called()

    def test_duplicate_ready_events_do_not_extract_again(self):
        body = Mock()
        body.read.return_value = json.dumps(
            {"status": "ready", "sourceETag": "etag"}
        ).encode()
        self.s3.get_object.side_effect = None
        self.s3.get_object.return_value = {"Body": body}
        with patch.object(handler, "extract") as extract:
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
            extract.assert_not_called()
        body.close.assert_called_once()

    def test_duplicate_in_progress_events_are_shared(self):
        body = Mock()
        body.read.return_value = json.dumps(
            {"status": "processing", "startedAt": time.time()}
        ).encode()
        self.s3.get_object.side_effect = None
        self.s3.get_object.return_value = {"Body": body, "ETag": "state"}
        with patch.object(handler, "extract") as extract:
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
            extract.assert_not_called()
        self.s3.put_object.assert_not_called()

    def test_concurrent_event_claim_is_conditional(self):
        self.s3.put_object.side_effect = ClientError("PreconditionFailed")
        with patch.object(handler, "extract") as extract:
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
            extract.assert_not_called()
        self.assertEqual(self.s3.put_object.call_args.kwargs["IfNoneMatch"], "*")

    def test_no_subtitles_is_a_successful_empty_manifest(self):
        with patch.object(handler, "extract", return_value=[]):
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
        manifest = json.loads(self.s3.put_object.call_args.kwargs["Body"])
        self.assertEqual(manifest["status"], "ready")
        self.assertEqual(manifest["tracks"], [])

    def test_publishes_subtitles_before_ready_manifest(self):
        track = {
            "number": 3,
            "language": "por",
            "label": "Português",
            "supported": True,
            "codec": "subrip",
            "default": True,
            "forced": False,
            "srt": "3-por.srt",
            "vtt": "3-por.vtt",
        }

        def extract(_source, directory, timeout):
            Path(directory, "3-por.srt").write_text("subtitle")
            Path(directory, "3-por.vtt").write_text("WEBVTT\n\n")
            return [track]

        with patch.object(handler, "extract", side_effect=extract):
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
        calls = self.s3.put_object.call_args_list
        self.assertTrue(calls[1].kwargs["Key"].endswith("3-por.srt"))
        self.assertTrue(calls[2].kwargs["Key"].endswith("3-por.vtt"))
        self.assertEqual(json.loads(calls[3].kwargs["Body"])["status"], "ready")

    def test_failed_extraction_does_not_expose_signed_urls(self):
        with (
            patch.object(
                handler, "extract", side_effect=RuntimeError("https://s3.test?secret")
            ),
            self.assertRaisesRegex(RuntimeError, "^Subtitle extraction failed$"),
        ):
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
        manifest = json.loads(self.s3.put_object.call_args.kwargs["Body"])
        self.assertEqual(manifest["status"], "failed")
        self.assertNotIn("secret", json.dumps(manifest))

    def test_deleted_video_during_extraction_is_not_republished(self):
        self.s3.get_paginator.return_value.paginate.return_value = []
        with (
            patch.object(handler, "available", side_effect=[True, False]),
            patch.object(handler, "extract", return_value=[]),
        ):
            handler.process_record(self.record, self.s3, self.dynamo, self.context)
        self.assertEqual(self.s3.put_object.call_count, 1)


if __name__ == "__main__":
    unittest.main()
