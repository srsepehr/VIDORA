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
        "faster-whisper==1.0.3",
        "transformers==4.44.2",
        "torch==2.2.2",
        "sentencepiece==0.2.0",
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

    return run_drain(max_jobs=3, max_seconds=1400.0)


@app.local_entrypoint()
def main():
    result = drain.remote()
    print("drain result:", result)
