"""Minimal stdlib HTTP client.

Uses urllib so the core worker logic (queue, translation, storage REST) has no
heavy third-party HTTP dependency and stays unit-testable without network. Adds
timeouts and returns (status, headers, body_bytes) without raising on non-2xx.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Optional


@dataclass
class HttpResponse:
    status: int
    headers: dict
    body: bytes

    def json(self):
        return json.loads(self.body.decode("utf-8"))

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300


def request(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    body: Optional[bytes] = None,
    timeout: float = 30.0,
) -> HttpResponse:
    req = urllib.request.Request(url, method=method.upper(), data=body)
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted URLs / SSRF-guarded upstream)
            return HttpResponse(status=resp.status, headers=dict(resp.headers), body=resp.read())
    except urllib.error.HTTPError as exc:
        return HttpResponse(status=exc.code, headers=dict(exc.headers or {}), body=exc.read() or b"")


def post_json(url: str, payload: dict, *, headers: Optional[dict] = None, timeout: float = 60.0) -> HttpResponse:
    merged = {"Content-Type": "application/json", **(headers or {})}
    return request("POST", url, headers=merged, body=json.dumps(payload).encode("utf-8"), timeout=timeout)
