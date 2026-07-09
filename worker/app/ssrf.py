"""Server-side SSRF guard.

The frontend already rejects obviously-unsafe URLs, but the worker must never
trust client input: before fetching a direct-media URL it re-validates the
scheme, rejects embedded credentials, resolves the hostname, and refuses any
address that resolves into loopback, private, link-local, unique-local, or
cloud-metadata ranges. Redirects are validated per-hop by the caller.
"""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit

from .errors import WorkerError, SSRF_BLOCKED

_BLOCKED_HOST_SUFFIXES = (".local", ".internal")
_BLOCKED_HOST_EXACT = {"localhost", "metadata.google.internal"}


def _ip_is_blocked(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True  # unparseable -> refuse
    return (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
        or (addr.version == 6 and addr.is_site_local)
        # AWS/GCP/Azure metadata lives in link-local 169.254.0.0/16 (covered),
        # but guard the well-known v4 address explicitly for clarity.
        or str(addr) == "169.254.169.254"
    )


def resolve_all_addresses(hostname: str) -> list[str]:
    """Return every A/AAAA address a hostname resolves to (used for the guard)."""
    infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    return sorted({info[4][0] for info in infos})


def assert_safe_public_url(raw_url: str, *, resolver=resolve_all_addresses) -> str:
    """Validate a URL for server-side fetching. Returns the normalized URL or
    raises WorkerError(SSRF_BLOCKED). ``resolver`` is injectable for tests."""
    parts = urlsplit(raw_url.strip())

    if parts.scheme != "https":
        raise WorkerError(SSRF_BLOCKED, dev_detail=f"non-https scheme {parts.scheme!r}")
    if parts.username or parts.password:
        raise WorkerError(SSRF_BLOCKED, dev_detail="embedded credentials")

    host = (parts.hostname or "").lower()
    if not host:
        raise WorkerError(SSRF_BLOCKED, dev_detail="missing host")
    if host in _BLOCKED_HOST_EXACT or host.endswith(_BLOCKED_HOST_SUFFIXES) or "." not in host:
        raise WorkerError(SSRF_BLOCKED, dev_detail=f"blocked host {host!r}")

    # Bare IP literals (public or not) are refused: legitimate media uses
    # hostnames, and IP literals are a common rebinding vector.
    try:
        ipaddress.ip_address(host)
        raise WorkerError(SSRF_BLOCKED, dev_detail=f"ip literal host {host!r}")
    except ValueError:
        pass  # not an IP literal -> resolve it below

    try:
        addresses = resolver(host)
    except OSError as exc:
        raise WorkerError(SSRF_BLOCKED, dev_detail=f"dns resolution failed for {host!r}: {exc}")
    if not addresses:
        raise WorkerError(SSRF_BLOCKED, dev_detail=f"no addresses for {host!r}")
    for ip in addresses:
        if _ip_is_blocked(ip):
            raise WorkerError(SSRF_BLOCKED, dev_detail=f"{host!r} resolves to blocked {ip}")

    return raw_url.strip()
