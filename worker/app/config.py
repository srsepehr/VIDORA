"""Worker configuration loaded from the environment.

Secrets (service-role key, translation API key) live only here, never in logs
or health output. Missing required configuration raises WorkerError so the
worker fails fast and loudly at startup.
"""

from __future__ import annotations

import os
import socket
from dataclasses import dataclass

from .errors import WorkerError, WORKER_CONFIGURATION_MISSING


def _req(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise WorkerError(WORKER_CONFIGURATION_MISSING, dev_detail=f"missing env {name}")
    return value


def _opt(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Config:
    # Supabase (service role — server side only)
    supabase_url: str
    service_role_key: str
    upload_bucket: str

    # Queue / lease behaviour
    worker_id: str
    lease_seconds: int
    heartbeat_seconds: int
    poll_interval_seconds: int
    reap_interval_seconds: int

    # Media limits
    max_source_bytes: int
    max_duration_seconds: int

    # STT
    stt_provider: str
    stt_model: str
    stt_device: str
    stt_compute_type: str
    stt_beam_size: int
    stt_download_root: str

    # Translation (OpenAI-compatible endpoint; provider-agnostic)
    translation_provider: str
    translation_base_url: str
    translation_model: str
    translation_api_key: str
    translation_batch_chars: int
    translation_max_retries: int

    # Health server
    health_host: str
    health_port: int

    # Ops
    work_dir: str
    log_transcripts: bool

    @property
    def has_translation(self) -> bool:
        return bool(self.translation_base_url and self.translation_api_key and self.translation_model)


def load_config(*, require_translation: bool = True) -> Config:
    supabase_url = _req("SUPABASE_URL").rstrip("/")
    service_role_key = _req("SUPABASE_SERVICE_ROLE_KEY")

    worker_id = _opt("WORKER_ID") or f"{socket.gethostname()}-{os.getpid()}"

    translation_base_url = _opt("TRANSLATION_BASE_URL").rstrip("/")
    translation_api_key = _opt("TRANSLATION_API_KEY")
    translation_model = _opt("TRANSLATION_MODEL")
    if require_translation and not (translation_base_url and translation_api_key and translation_model):
        raise WorkerError(
            WORKER_CONFIGURATION_MISSING,
            dev_detail="translation endpoint not fully configured (TRANSLATION_BASE_URL/API_KEY/MODEL)",
        )

    return Config(
        supabase_url=supabase_url,
        service_role_key=service_role_key,
        upload_bucket=_opt("UPLOAD_BUCKET", "vidora-video-uploads"),
        worker_id=worker_id,
        lease_seconds=_int("LEASE_SECONDS", 120),
        heartbeat_seconds=_int("HEARTBEAT_SECONDS", 20),
        poll_interval_seconds=_int("POLL_INTERVAL_SECONDS", 5),
        reap_interval_seconds=_int("REAP_INTERVAL_SECONDS", 30),
        max_source_bytes=_int("MAX_SOURCE_BYTES", 500 * 1024 * 1024),
        max_duration_seconds=_int("MAX_DURATION_SECONDS", 900),
        stt_provider=_opt("STT_PROVIDER", "faster_whisper"),
        stt_model=_opt("STT_MODEL", "small"),
        stt_device=_opt("STT_DEVICE", "cpu"),
        stt_compute_type=_opt("STT_COMPUTE_TYPE", "int8"),
        stt_beam_size=_int("STT_BEAM_SIZE", 5),
        stt_download_root=_opt("STT_DOWNLOAD_ROOT", "/models"),
        translation_provider=_opt("TRANSLATION_PROVIDER", "openai_compatible"),
        translation_base_url=translation_base_url,
        translation_model=translation_model,
        translation_api_key=translation_api_key,
        translation_batch_chars=_int("TRANSLATION_BATCH_CHARS", 4000),
        translation_max_retries=_int("TRANSLATION_MAX_RETRIES", 3),
        health_host=_opt("HEALTH_HOST", "0.0.0.0"),
        health_port=_int("HEALTH_PORT", 8080),
        work_dir=_opt("WORK_DIR", "/tmp/vidora-worker"),
        log_transcripts=_opt("LOG_TRANSCRIPTS", "false").lower() == "true",
    )
