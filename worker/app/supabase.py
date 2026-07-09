"""Service-role Supabase client (PostgREST RPC/reads + Storage download).

Uses the service-role key, which bypasses RLS — so it exists only in the worker
process and is never logged or returned by the health endpoint. All privileged
mutations go through the SECURITY DEFINER RPCs; this client never issues raw
table writes for job/transcript state.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any, Optional

from . import http_client
from .errors import WorkerError, SOURCE_OBJECT_MISSING, SOURCE_TOO_LARGE, SOURCE_DOWNLOAD_FAILED


class SupabaseClient:
    def __init__(self, base_url: str, service_role_key: str):
        self.base_url = base_url.rstrip("/")
        self.key = service_role_key

    def _headers(self, extra: Optional[dict] = None) -> dict:
        return {
            "apikey": self.key,
            "Authorization": f"Bearer {self.key}",
            **(extra or {}),
        }

    # --- PostgREST -------------------------------------------------------
    def rpc(self, fn: str, params: dict) -> Any:
        resp = http_client.post_json(
            f"{self.base_url}/rest/v1/rpc/{fn}", params, headers=self._headers(), timeout=30.0
        )
        if not resp.ok:
            raise WorkerError(
                "INTERNAL_PROCESSING_ERROR",
                dev_detail=f"rpc {fn} http {resp.status}: {resp.body[:200]!r}",
                retryable=resp.status >= 500,
            )
        return resp.json() if resp.body else None

    def select_many(self, table: str, query: str) -> list[dict]:
        resp = http_client.request(
            "GET", f"{self.base_url}/rest/v1/{table}?{query}", headers=self._headers(), timeout=30.0
        )
        if not resp.ok:
            raise WorkerError(
                "INTERNAL_PROCESSING_ERROR",
                dev_detail=f"select {table} http {resp.status}",
                retryable=resp.status >= 500,
            )
        return resp.json() or []

    def select_one(self, table: str, query: str) -> Optional[dict]:
        resp = http_client.request(
            "GET", f"{self.base_url}/rest/v1/{table}?{query}", headers=self._headers(), timeout=30.0
        )
        if not resp.ok:
            raise WorkerError(
                "INTERNAL_PROCESSING_ERROR",
                dev_detail=f"select {table} http {resp.status}",
                retryable=resp.status >= 500,
            )
        rows = resp.json()
        return rows[0] if rows else None

    # --- Storage ---------------------------------------------------------
    def storage_object_exists(self, bucket: str, key: str) -> bool:
        resp = http_client.request(
            "GET",
            f"{self.base_url}/storage/v1/object/info/authenticated/{bucket}/{key}",
            headers=self._headers(),
            timeout=30.0,
        )
        return resp.ok

    def download_storage_object(self, bucket: str, key: str, dest_path: str, *, max_bytes: int) -> int:
        """Stream a private object to disk with a hard size cap. Returns bytes
        written. Never exposes a public URL."""
        url = f"{self.base_url}/storage/v1/object/authenticated/{bucket}/{key}"
        req = urllib.request.Request(url, headers=self._headers())
        try:
            with urllib.request.urlopen(req, timeout=120.0) as resp, open(dest_path, "wb") as out:  # noqa: S310
                written = 0
                while True:
                    chunk = resp.read(1024 * 256)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > max_bytes:
                        raise WorkerError(SOURCE_TOO_LARGE, dev_detail=f"exceeded {max_bytes} bytes")
                    out.write(chunk)
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                raise WorkerError(SOURCE_OBJECT_MISSING, dev_detail="storage 404")
            raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail=f"storage http {exc.code}", retryable=exc.code >= 500)
        except OSError as exc:
            raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail=f"storage io: {exc}")
        if written == 0:
            raise WorkerError(SOURCE_OBJECT_MISSING, dev_detail="empty object")
        return written

    def ping(self) -> bool:
        resp = http_client.request("GET", f"{self.base_url}/rest/v1/", headers=self._headers(), timeout=10.0)
        return resp.status in (200, 400, 404)  # any structured reply proves connectivity
