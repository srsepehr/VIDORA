"""Worker health/readiness HTTP server.

Runs in a background thread so orchestration platforms can probe liveness and
readiness. Never includes secrets. /health is liveness (process up); /ready
reports dependency reachability and tool availability.
"""

from __future__ import annotations

import json
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from . import __version__


class HealthState:
    def __init__(self, worker_id: str, commit: str = ""):
        self.worker_id = worker_id
        self.commit = commit
        self.started = False
        self.claiming = False
        self.checks: Callable[[], dict] = lambda: {}

    def readiness(self) -> dict:
        deps = self.checks() or {}
        tools = {
            "ffmpeg": shutil.which("ffmpeg") is not None,
            "ffprobe": shutil.which("ffprobe") is not None,
        }
        ready = self.started and all(tools.values()) and all(
            v.get("ok", False) for v in deps.values() if isinstance(v, dict)
        )
        return {
            "ready": ready,
            "worker_version": __version__,
            "commit": self.commit,
            "worker_id": self.worker_id,
            "claiming": self.claiming,
            "tools": tools,
            "dependencies": deps,
        }


def _handler_factory(state: HealthState):
    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            if self.path.startswith("/health"):
                self._send(200, {"status": "ok", "worker_version": __version__, "worker_id": state.worker_id})
            elif self.path.startswith("/ready"):
                r = state.readiness()
                self._send(200 if r["ready"] else 503, r)
            else:
                self._send(404, {"error": "not found"})

        def log_message(self, *args):  # silence default stderr logging
            return

    return Handler


def start_health_server(host: str, port: int, state: HealthState) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), _handler_factory(state))
    thread = threading.Thread(target=server.serve_forever, name="health", daemon=True)
    thread.start()
    return server
