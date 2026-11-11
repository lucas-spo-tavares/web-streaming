"""Extract text subtitles once after an S3 multipart upload. No video transcoding."""

import argparse
import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import unquote_plus

VIDEO_KEY = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[^/\\\x00-\x1f]+\.(?:mkv|mp4|m4v|webm|mov|avi|mpeg|mpg|ogv|ts|mts|m2ts|3gp|3g2)$",
    re.IGNORECASE,
)
TEXT_CODECS = {"subrip", "ass", "ssa", "webvtt", "mov_text", "text"}
MAX_SUBTITLE_BYTES = 2 * 1024 * 1024
RETENTION_MS = 30 * 86400000


def extract(source, directory, timeout=800):
    """Same extraction path used locally and in Lambda. Source may be HTTPS or a file."""
    started = time.monotonic()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-protocol_whitelist",
            "file,http,https,tcp,tls,crypto",
            "-analyzeduration",
            "1000000",
            "-probesize",
            "1048576",
            "-select_streams",
            "s",
            "-show_entries",
            "stream=index,codec_name:stream_tags=language,title:stream_disposition=default,forced",
            "-of",
            "json",
            source,
        ],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=min(timeout, 60),
    )
    streams = json.loads(probe.stdout).get("streams", [])
    if len(streams) > 32:
        raise ValueError("Too many subtitle tracks")
    tracks = []
    command = [
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-y",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,http,https,tcp,tls,crypto",
        "-i",
        source,
    ]
    for stream in streams:
        number = int(stream["index"])
        if not 0 <= number <= 255:
            raise ValueError("Invalid subtitle track index")
        tags = stream.get("tags", {})
        language = (
            re.sub(r"[^a-zA-Z0-9-]", "", tags.get("language", "und"))[:32] or "und"
        )
        supported = stream.get("codec_name") in TEXT_CODECS
        track = {
            "number": number,
            "language": language,
            "label": tags.get("title", language)[:256],
            "codec": stream.get("codec_name", "unknown"),
            "default": bool(stream.get("disposition", {}).get("default")),
            "forced": bool(stream.get("disposition", {}).get("forced")),
            "supported": supported,
        }
        if supported:
            for extension, codec in (("srt", "subrip"), ("vtt", "webvtt")):
                name = f"{number}-{language}.{extension}"
                track[extension] = name
                command.extend(
                    [
                        "-map",
                        f"0:{number}",
                        "-c:s",
                        codec,
                        "-fs",
                        str(MAX_SUBTITLE_BYTES),
                        str(directory / name),
                    ]
                )
        tracks.append(track)
    if any(track["supported"] for track in tracks):
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise TimeoutError("Extraction timed out")
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=remaining,
        )
        for track in tracks:
            if not track["supported"]:
                continue
            for extension in ("srt", "vtt"):
                output = directory / track[extension]
                if output.stat().st_size >= MAX_SUBTITLE_BYTES:
                    raise ValueError("Subtitle size limit exceeded")
                if extension == "vtt" and not output.read_text(
                    encoding="utf-8-sig"
                ).startswith("WEBVTT"):
                    raise ValueError("Invalid WebVTT output")
    return tracks


def available(s3, dynamo, bucket, key, table):
    try:
        head = s3.head_object(Bucket=bucket, Key=key)
    except s3.exceptions.ClientError as error:
        if error.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
            return False
        raise
    record = dynamo.get_item(
        TableName=table, Key={"key": {"S": key}}, ConsistentRead=True
    ).get("Item", {})
    expires = int(
        record.get("expiresAt", {}).get(
            "N", str(int(head["LastModified"].timestamp() * 1000) + RETENTION_MS)
        )
    )
    return (
        not record.get("deleting", {}).get("BOOL", False)
        and expires > time.time() * 1000
    )


def write_manifest(s3, bucket, prefix, manifest, condition=None):
    s3.put_object(
        Bucket=bucket,
        Key=f"{prefix}tracks.json",
        Body=json.dumps(manifest, ensure_ascii=False).encode(),
        ContentType="application/json; charset=utf-8",
        CacheControl="no-store",
        **(condition or {}),
    )


def clear_outputs(s3, bucket, prefix):
    for page in s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, Prefix=prefix
    ):
        for item in page.get("Contents", []):
            if re.fullmatch(
                r"(?:tracks\.json|\d+-[a-zA-Z0-9-]+\.(?:srt|vtt))",
                item["Key"][len(prefix) :],
            ):
                s3.delete_object(Bucket=bucket, Key=item["Key"])


def process_record(record, s3, dynamo, context):
    bucket = os.environ["MEDIA_BUCKET"]
    key = unquote_plus(record["s3"]["object"]["key"])
    if record["s3"]["bucket"]["name"] != bucket or not VIDEO_KEY.fullmatch(key):
        return
    prefix = key.split("/")[0] + "/"
    etag = record["s3"]["object"]["eTag"].strip('"')
    table = os.environ["RETENTION_TABLE"]
    if not available(s3, dynamo, bucket, key, table):
        clear_outputs(s3, bucket, prefix)
        return
    condition = {"IfNoneMatch": "*"}
    try:
        response = s3.get_object(Bucket=bucket, Key=f"{prefix}tracks.json")
        try:
            previous = json.loads(response["Body"].read(MAX_SUBTITLE_BYTES))
        finally:
            response["Body"].close()
        if previous.get("status") == "ready" and previous.get("sourceETag") == etag:
            return
        if (
            previous.get("status") == "processing"
            and time.time() - previous.get("startedAt", 0) < 900
        ):
            return
        condition = {"IfMatch": response["ETag"]}
    except s3.exceptions.NoSuchKey:
        pass
    manifest = {
        "key": key,
        "sourceETag": etag,
        "status": "processing",
        "tracks": [],
        "startedAt": time.time(),
    }
    try:
        write_manifest(s3, bucket, prefix, manifest, condition)
    except s3.exceptions.ClientError as error:
        if error.response["Error"]["Code"] in {
            "PreconditionFailed",
            "ConditionalRequestConflict",
            "412",
            "409",
        }:
            return
        raise
    try:
        # Range/seek access over HTTPS avoids storing a multi-GiB video in /tmp.
        url = s3.generate_presigned_url(
            "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=900
        )
        with tempfile.TemporaryDirectory(prefix="subtitles-") as directory:
            tracks = extract(
                url,
                directory,
                timeout=max(1, context.get_remaining_time_in_millis() / 1000 - 30),
            )
            if not available(s3, dynamo, bucket, key, table):
                clear_outputs(s3, bucket, prefix)
                return
            for track in tracks:
                if not track["supported"]:
                    continue
                for extension in ("srt", "vtt"):
                    name = track[extension]
                    s3.put_object(
                        Bucket=bucket,
                        Key=prefix + name,
                        Body=(Path(directory) / name).read_bytes(),
                        ContentType="text/vtt; charset=utf-8"
                        if extension == "vtt"
                        else "application/x-subrip; charset=utf-8",
                        CacheControl="no-store",
                    )
            write_manifest(
                s3, bucket, prefix, {**manifest, "status": "ready", "tracks": tracks}
            )
            # Cover deletion/expiration while outputs were being published.
            if not available(s3, dynamo, bucket, key, table):
                clear_outputs(s3, bucket, prefix)
    except Exception:  # noqa: BLE001 - sanitize subprocess errors before the Lambda runtime logs them
        if available(s3, dynamo, bucket, key, table):
            write_manifest(
                s3,
                bucket,
                prefix,
                {
                    **manifest,
                    "status": "failed",
                    "message": "Não foi possível extrair as legendas deste vídeo.",
                },
            )
        else:
            clear_outputs(s3, bucket, prefix)
        # FFmpeg exceptions can contain the signed input URL. Never expose their command line.
        raise RuntimeError("Subtitle extraction failed") from None


def handler(event, context):
    import boto3

    s3 = boto3.client("s3")
    dynamo = boto3.client("dynamodb")
    for record in event.get("Records", []):
        if record.get("eventName", "").startswith("ObjectCreated:"):
            process_record(record, s3, dynamo, context)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Extract subtitles locally without AWS access"
    )
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    arguments = parser.parse_args()
    started = time.monotonic()
    tracks = extract(arguments.source, arguments.output)
    manifest = {"status": "ready", "tracks": tracks}
    (Path(arguments.output) / "tracks.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {"seconds": round(time.monotonic() - started, 2), "tracks": tracks},
            ensure_ascii=False,
        )
    )
