"""Exercise the real extractor against a local HTTP Range source, without AWS."""

import argparse
import json
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from handler import extract

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
video = Path(args.source)
size = video.stat().st_size
stats = {"requests": 0, "bytes": 0}


class RangeHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_args):
        pass

    def do_GET(self):
        match = re.fullmatch(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
        start = int(match[1]) if match else 0
        end = min(int(match[2]), size - 1) if match and match[2] else size - 1
        if start > end:
            self.send_error(416)
            return
        stats["requests"] += 1
        self.send_response(206 if match else 200)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        if match:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        try:
            with video.open("rb") as source:
                source.seek(start)
                remaining = end - start + 1
                while remaining:
                    chunk = source.read(min(remaining, 65536))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    stats["bytes"] += len(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True


server = ThreadingHTTPServer(("127.0.0.1", 0), RangeHandler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
started = time.monotonic()
try:
    tracks = extract(f"http://127.0.0.1:{server.server_port}/video.mkv", args.output)
    output = Path(args.output)
    (output / "tracks.json").write_text(
        json.dumps({"status": "ready", "tracks": tracks}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "seconds": round(time.monotonic() - started, 2),
                "sourceBytes": size,
                "http": stats,
                "tracks": tracks,
            },
            ensure_ascii=False,
        )
    )
finally:
    server.shutdown()
    server.server_close()
