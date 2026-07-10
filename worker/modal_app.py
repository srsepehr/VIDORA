"""Modal runtime adapter for the Vidora worker (private zero-cost phase).

Event-triggered and scale-to-zero: there is NO always-on polling process. A
container is created only when the drain function is invoked (manually via
`modal run`, or on demand via the web endpoint after a test job is enqueued),
processes the currently-available jobs, and then Modal spins the container back
down to zero. Concurrency and worker count are pinned to 1.

This adapter contains NO domain logic — it only wires the platform to
`worker.app.main.run_drain`. Swapping Modal for another runtime later means
replacing this file, nothing else.

Secrets are provided by a Modal Secret named "vidora-worker" (created by the
project owner); nothing sensitive is committed here.

Deploy/run (after `modal token new` and creating the secret):
    modal run worker/modal_app.py            # one-shot drain (dev trigger)
    modal deploy worker/modal_app.py         # deploy the web trigger endpoint
"""

from __future__ import annotations

import os

import modal

# Non-secret defaults for the private phase. Secrets (SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY) come from the Modal Secret, never from source.
PHASE_ENV = {
    "TRANSLATION_PROVIDER": "local_nllb",
    "STT_MODEL": "base",
    "STT_COMPUTE_TYPE": "int8",
    "STT_DEVICE": "cpu",
    "STT_DOWNLOAD_ROOT": "/models",
    "NLLB_MODEL": "facebook/nllb-200-distilled-600M",
    "MAX_DURATION_SECONDS": "120",
    "MAX_SOURCE_BYTES": "104857600",  # 100 MB
    "WORK_DIR": "/tmp/vidora-worker",
    "LOG_TRANSCRIPTS": "false",
}

STT_MODEL = PHASE_ENV["STT_MODEL"]
NLLB_MODEL = PHASE_ENV["NLLB_MODEL"]


def _bake_models():
    # Runs at image-build time so no job ever re-downloads a model.
    from faster_whisper import WhisperModel

    WhisperModel(STT_MODEL, device="cpu", compute_type="int8", download_root="/models")
    from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

    AutoTokenizer.from_pretrained(NLLB_MODEL, cache_dir="/models")
    AutoModelForSeq2SeqLM.from_pretrained(NLLB_MODEL, cache_dir="/models")


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "numpy<2",  # torch 2.2.x is built against numpy 1.x; numpy 2 breaks it
        "faster-whisper==1.0.3",
        "transformers==4.44.2",
        "torch==2.2.2",
        "sentencepiece==0.2.0",
        "fastapi[standard]",
    )
    .env(PHASE_ENV)
    .run_function(_bake_models)
    .add_local_python_source("worker")
)

app = modal.App("vidora-worker")

# The owner creates this once: `modal secret create vidora-worker SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...`
secret = modal.Secret.from_name("vidora-worker")


@app.function(
    image=image,
    secrets=[secret],
    timeout=1500,          # hard per-invocation cap
    max_containers=1,      # at most one worker
    cpu=2.0,
    memory=4096,
    retries=0,             # the DB queue owns retry/lease semantics, not Modal
)
def drain(max_jobs: int = 3):
    """Process available jobs then exit (scale to zero). One container only."""
    from worker.app.main import run_drain

    return run_drain(max_jobs=max_jobs, max_seconds=1400.0)


@app.function(image=image, secrets=[secret], timeout=1500, max_containers=1)
@modal.fastapi_endpoint(method="POST")
def trigger():
    """On-demand HTTP trigger: the app calls this after enqueuing a test job so
    work starts without any always-on poller. Still scale-to-zero."""
    from worker.app.main import run_drain

    return run_drain(max_jobs=1, max_seconds=1400.0)


@app.function(image=image, secrets=[secret], timeout=600, max_containers=1)
def health():
    """Readiness probe: verifies tools, DB connectivity, and that both
    self-hosted models load — without claiming or processing any job."""
    import shutil

    from worker.app import __version__
    from worker.app.config import load_config
    from worker.app.supabase import SupabaseClient
    from worker.app.transcription import FasterWhisperProvider
    from worker.app.translation_local import LocalNLLBTranslationProvider

    cfg = load_config(require_translation=True)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    stt = FasterWhisperProvider(
        model_size=cfg.stt_model, device=cfg.stt_device,
        compute_type=cfg.stt_compute_type, download_root=cfg.stt_download_root,
    )
    tr = LocalNLLBTranslationProvider(
        model_name=cfg.nllb_model, target_lang=cfg.nllb_target_lang,
        download_root=cfg.stt_download_root,
    )
    sh, th = stt.health_check(), tr.health_check()
    out = {
        "worker_version": __version__,
        "translation_provider": cfg.translation_provider,
        "stt_model": cfg.stt_model,
        "max_duration_seconds": cfg.max_duration_seconds,
        "max_source_bytes": cfg.max_source_bytes,
        "ffmpeg": shutil.which("ffmpeg") is not None,
        "ffprobe": shutil.which("ffprobe") is not None,
        "supabase": client.ping(),
        "stt_ok": sh.ok, "stt_detail": sh.detail,
        "translation_ok": th.ok, "translation_detail": th.detail,
    }
    out["ready"] = all([out["ffmpeg"], out["ffprobe"], out["supabase"], sh.ok, th.ok])
    return out


@app.function(image=image, secrets=[secret], timeout=120, max_containers=1)
def inspect(video_id: str = ""):
    """Read back the live DB state for verification (no processing). Defaults to
    the most recently created video when no id is given."""
    from worker.app.config import load_config
    from worker.app.supabase import SupabaseClient

    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    if not video_id:
        recent = client.select_many("videos", "select=id&order=created_at.desc&limit=1")
        video_id = recent[0]["id"] if recent else ""
    if not video_id:
        return {"error": "no videos found"}

    video = client.select_one("videos", f"id=eq.{video_id}&select=*") or {}
    job = client.select_one("video_jobs", f"video_id=eq.{video_id}&select=*&order=created_at.desc&limit=1") or {}
    segs = client.select_many(
        "transcript_segments",
        f"video_id=eq.{video_id}&select=segment_index,start_ms,end_ms,source_language,source_text,translated_text_fa,translation_provider,translation_model&order=segment_index.asc",
    )
    translated = [s for s in segs if (s.get("translated_text_fa") or "").strip()]
    empty_source = [s for s in segs if not (s.get("source_text") or "").strip()]
    invalid_timestamps = [
        s for s in segs
        if int(s.get("start_ms") or 0) < 0 or int(s.get("end_ms") or 0) <= int(s.get("start_ms") or 0)
    ]
    distinct = len({s["segment_index"] for s in segs})
    providers = sorted({s["translation_provider"] for s in segs if s.get("translation_provider")})
    models = sorted({s["translation_model"] for s in segs if s.get("translation_model")})
    return {
        "video_id": video_id,
        "video_status": video.get("status"),
        "detected_language": video.get("detected_language"),
        "duration_seconds": video.get("duration_seconds"),
        "source_type": video.get("source_type"),
        "failure_code": video.get("failure_code"),
        "failure_message_fa": video.get("failure_message_fa"),
        "job_status": job.get("status"),
        "job_worker_id": job.get("worker_id"),
        "job_attempt": job.get("attempt"),
        "job_max_attempts": job.get("max_attempts"),
        "job_started_at": job.get("started_at"),
        "job_finished_at": job.get("finished_at"),
        "job_error_code": job.get("error_code"),
        "segments_total": len(segs),
        "segments_translated": len(translated),
        "segments_missing_source": len(empty_source),
        "invalid_timestamp_rows": len(invalid_timestamps),
        "distinct_segment_indexes": distinct,
        "duplicate_rows": len(segs) - distinct,
        "translation_providers": providers,
        "translation_models": models,
    }


@app.local_entrypoint()
def look(video_id: str = ""):
    import json
    print("inspect:", json.dumps(inspect.remote(video_id), ensure_ascii=False, indent=2))


@app.local_entrypoint()
def main(max_jobs: int = 1):
    # Default to a single job so a dev trigger never processes more than the one
    # test video without an explicit override.
    result = drain.remote(max_jobs=max_jobs)
    print("drain result:", result)


@app.local_entrypoint()
def check():
    print("health:", health.remote())
