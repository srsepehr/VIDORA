"""Source acquisition.

- upload: download the private object with the service-role key (never a public
  URL), size-capped.
- direct_media_url: re-validate SSRF safety server-side and stream the body with
  per-redirect re-validation, connection + total timeouts, and a hard size cap.
- youtube / other: accepted at submission time but not yet acquirable in the
  worker; fails permanently with a clear, honest code until a reliable adapter
  exists (no browser scraping, no fake success).
"""

from __future__ import annotations

import urllib.error
import urllib.request
from urllib.parse import urljoin, urlsplit

from .config import Config
from .errors import (
    WorkerError,
    SOURCE_DOWNLOAD_FAILED,
    SOURCE_TOO_LARGE,
    SOURCE_UNSUPPORTED,
)
from .ssrf import assert_safe_public_url
from .supabase import SupabaseClient

_MAX_REDIRECTS = 3


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None  # never auto-follow; we validate each hop ourselves


def _safe_streaming_download(url: str, dest_path: str, *, max_bytes: int, timeout: float) -> int:
    opener = urllib.request.build_opener(_NoRedirect)
    current = url
    for _ in range(_MAX_REDIRECTS + 1):
        assert_safe_public_url(current)  # re-validate every hop (defeats DNS-rebind on redirect)
        req = urllib.request.Request(current, headers={"User-Agent": "vidora-worker/1"})
        try:
            resp = opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            if exc.code in (301, 302, 303, 307, 308):
                location = exc.headers.get("Location")
                if not location:
                    raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail="redirect without Location")
                current = urljoin(current, location)
                continue
            raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail=f"http {exc.code}", retryable=exc.code >= 500)
        except OSError as exc:
            raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail=f"io: {exc}")

        with resp, open(dest_path, "wb") as out:
            written = 0
            while True:
                chunk = resp.read(1024 * 256)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    raise WorkerError(SOURCE_TOO_LARGE, dev_detail=f"exceeded {max_bytes} bytes")
                out.write(chunk)
        if written == 0:
            raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail="empty body")
        return written

    raise WorkerError(SOURCE_DOWNLOAD_FAILED, dev_detail="too many redirects")


def acquire_source(config: Config, client: SupabaseClient, video: dict, dest_path: str) -> int:
    """Fetch the source media to ``dest_path``. Returns bytes written."""
    source_type = video.get("source_type")

    if source_type == "upload":
        key = video.get("storage_key")
        if not key:
            raise WorkerError("SOURCE_OBJECT_MISSING", dev_detail="video has no storage_key")
        if not client.storage_object_exists(config.upload_bucket, key):
            raise WorkerError("SOURCE_OBJECT_MISSING", dev_detail="object info 404")
        return client.download_storage_object(config.upload_bucket, key, dest_path, max_bytes=config.max_source_bytes)

    if source_type == "direct_media_url":
        url = video.get("source_url") or ""
        return _safe_streaming_download(url, dest_path, max_bytes=config.max_source_bytes, timeout=60.0)

    # youtube / supported_external_url / supported_url: honest permanent failure.
    raise WorkerError(
        SOURCE_UNSUPPORTED,
        dev_detail=f"acquisition not implemented for source_type={source_type}",
        retryable=False,
    )
