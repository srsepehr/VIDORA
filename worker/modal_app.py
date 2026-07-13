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

# Subtitle generation is pure stdlib (deterministic builder) — NO torch,
# whisper, transformers, or ffmpeg. A separate lightweight image proves that
# subtitle-only work never loads AI models and keeps backfill cheap.
subtitle_image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({"TRANSLATION_PROVIDER": "local_nllb", "RESULTS_BUCKET": "vidora-video-results"})
    .add_local_python_source("worker")
)

# Insight generation (summary / takeaways / chapters) runs a small local
# instruct model on CPU. Its image has transformers+torch (the model genuinely
# requires them) but NO faster-whisper, NO NLLB bake, NO ffmpeg — insight-only
# work never touches transcription, translation, or the source video. The
# model is downloaded at build time so no invocation re-downloads it.
INSIGHT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"


def _bake_insight_model():
    from huggingface_hub import snapshot_download

    snapshot_download(INSIGHT_MODEL, cache_dir="/models")


insight_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "numpy<2",  # torch 2.2.x is built against numpy 1.x
        "torch==2.2.2",
        "transformers==4.44.2",
    )
    .env({
        "INSIGHT_MODEL": INSIGHT_MODEL,
        "STT_DOWNLOAD_ROOT": "/models",
        "OMP_NUM_THREADS": "4",
    })
    .run_function(_bake_insight_model)
    .add_local_python_source("worker")
)

# Dedicated chat/index image: local E5 embeddings + Qwen answer generation.
# It intentionally contains no whisper, NLLB, ffmpeg, subtitle, or media stack.
CHAT_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"
CHAT_EMBEDDING_MODEL = "intfloat/multilingual-e5-small"


def _bake_chat_models():
    from huggingface_hub import snapshot_download
    snapshot_download(CHAT_MODEL, cache_dir="/models")
    snapshot_download(CHAT_EMBEDDING_MODEL, cache_dir="/models")


chat_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("numpy<2", "torch==2.2.2", "transformers==4.44.2", "fastapi[standard]")
    .env({"CHAT_MODEL": CHAT_MODEL, "CHAT_EMBEDDING_MODEL": CHAT_EMBEDDING_MODEL,
          "STT_DOWNLOAD_ROOT": "/models", "OMP_NUM_THREADS": "4"})
    .run_function(_bake_chat_models)
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

    result = run_drain(max_jobs=max_jobs, max_seconds=1400.0)
    _spawn_insights_for(result)
    return result


def _spawn_insights_for(drain_result: dict) -> None:
    """Best-effort post-processing: kick off insight generation for each video
    that just completed its translation phase. Runs as a separate scale-to-zero
    function; any failure here never affects the finished job, transcript,
    translations, or subtitles."""
    for video_id in drain_result.get("video_ids") or []:
        try:
            generate_insights.spawn(video_id)
        except Exception:  # noqa: BLE001 — insight kick-off is strictly best-effort
            pass
        try:
            # Chat indexing is transcript-only and independent. It never blocks
            # or changes the completed video-processing job.
            build_chat_index.spawn(video_id)
        except Exception:  # noqa: BLE001 — indexing kick-off is strictly best-effort
            pass


@app.function(image=image, secrets=[secret], timeout=1500, max_containers=1)
@modal.fastapi_endpoint(method="POST")
def trigger():
    """On-demand HTTP trigger: the app calls this after enqueuing a test job so
    work starts without any always-on poller. Still scale-to-zero."""
    from worker.app.main import run_drain

    result = run_drain(max_jobs=1, max_seconds=1400.0)
    _spawn_insights_for(result)
    return result


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


@app.function(image=subtitle_image, secrets=[secret], timeout=300, max_containers=1)
def generate_subtitles(video_id: str, force: bool = False):
    """Lightweight, internal/manual subtitle generation + backfill. Loads NO AI
    models. Invoked via `modal run` (Modal-token authenticated) — it is NOT a
    public web endpoint and never accepts arbitrary IDs unauthenticated."""
    from worker.app.subtitle_generation import backfill_subtitles
    from worker.app.errors import WorkerError

    # Return the classified error instead of raising, so the stable code + safe
    # detail survive to the caller (a raised WorkerError loses fidelity when
    # reconstructed across the Modal boundary).
    try:
        return backfill_subtitles(video_id, force=force)
    except WorkerError as err:
        return {"status": "error", "code": err.code, "detail": err.dev_detail[:300], "retryable": err.retryable}


@app.function(image=subtitle_image, secrets=[secret], timeout=120, max_containers=1)
def inspect_subtitles(video_id: str = ""):
    """Read back subtitle artifact metadata (no processing) for verification."""
    from worker.app.config import load_config
    from worker.app.supabase import SupabaseClient

    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    if not video_id:
        recent = client.select_many("videos", "select=id&order=created_at.desc&limit=1")
        video_id = recent[0]["id"] if recent else ""
    rows = client.select_many(
        "subtitle_artifacts",
        f"video_id=eq.{video_id}&select=format,language,status,content_hash,builder_version,cue_count,"
        f"source_segment_count,storage_path,validation_warnings,error_code&order=format.asc",
    )
    return {"video_id": video_id, "artifacts": rows}


@app.function(image=subtitle_image, secrets=[secret], timeout=120, max_containers=1)
def verify_subtitles(video_id: str = ""):
    """Structurally verify the stored VTT/SRT by parsing them back — returns
    facts only (counts, header/timestamp/UTF-8 checks), NEVER the subtitle text,
    so nothing sensitive lands in CI logs."""
    import os
    import tempfile

    from worker.app.config import load_config
    from worker.app.supabase import SupabaseClient
    from worker.app import subtitles as S

    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    if not video_id:
        recent = client.select_many("videos", "select=id&order=created_at.desc&limit=1")
        video_id = recent[0]["id"] if recent else ""
    arts = client.select_many(
        "subtitle_artifacts",
        f"video_id=eq.{video_id}&language=eq.fa&select=format,status,storage_path,cue_count,content_hash",
    )
    out = {"video_id": video_id, "formats": {}}
    for a in arts:
        if a["status"] != "ready" or not a.get("storage_path"):
            out["formats"][a["format"]] = {"status": a["status"]}
            continue
        tmp = tempfile.mktemp(suffix="." + a["format"])
        try:
            client.download_storage_object(cfg.results_bucket, a["storage_path"], tmp, max_bytes=5_000_000)
            with open(tmp, encoding="utf-8") as fh:
                text = fh.read()
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        cues = S.parse_vtt(text) if a["format"] == "vtt" else S.parse_srt(text)
        monotonic = all(cues[i].end_ms <= cues[i + 1].start_ms for i in range(len(cues) - 1)) if len(cues) > 1 else True
        persian = any("؀" <= ch <= "ۿ" for ch in text)
        header_ok = text.startswith("WEBVTT") if a["format"] == "vtt" else text.lstrip().startswith("1")
        out["formats"][a["format"]] = {
            "status": "ready",
            "bytes": len(text.encode("utf-8")),
            "header_ok": header_ok,
            "parsed_cue_count": len(cues),
            "db_cue_count": a.get("cue_count"),
            "cue_count_matches": len(cues) == a.get("cue_count"),
            "timestamps_monotonic": monotonic,
            "persian_present": persian,
            "final_newline": text.endswith("\n"),
            "utf8_roundtrip": text.encode("utf-8").decode("utf-8") == text,
        }
    return out


@app.function(
    image=insight_image,
    secrets=[secret],
    timeout=1200,          # CPU generation for a short video fits comfortably
    max_containers=1,
    cpu=4.0,
    memory=12288,          # Qwen2.5-1.5B fp32 (~6.2 GB) + headroom
    retries=0,
)
def generate_insights(video_id: str, force: bool = False):
    """Internal/manual insight generation + backfill (Modal-token authenticated,
    NOT a public endpoint). Returns structural metadata or a classified error —
    never generated content, so nothing private reaches CI logs."""
    from worker.app.errors import WorkerError
    from worker.app.insight_generation import backfill_insights

    try:
        return backfill_insights(video_id, force=force)
    except WorkerError as err:
        return {"status": "error", "code": err.code, "detail": err.dev_detail[:300], "retryable": err.retryable}


@app.function(image=subtitle_image, secrets=[secret], timeout=120, max_containers=1)
def inspect_insights(video_id: str = ""):
    """Read back insight/chapter state for verification — structural fields only
    (status, versions, counts, timing ranges); no summary or title text."""
    from worker.app.config import load_config
    from worker.app.supabase import SupabaseClient

    cfg = load_config(require_translation=False)
    client = SupabaseClient(cfg.supabase_url, cfg.service_role_key)
    if not video_id:
        recent = client.select_many("videos", "select=id&order=created_at.desc&limit=1")
        video_id = recent[0]["id"] if recent else ""
    insight = client.select_one(
        "video_insights",
        f"video_id=eq.{video_id}&select=status,language,content_hash,provider,model,prompt_version,"
        f"schema_version,source_segment_count,error_code,generated_at,short_summary,detailed_summary,key_takeaways",
    ) or {}
    chapters = client.select_many(
        "video_chapters",
        f"video_id=eq.{video_id}&select=chapter_index,start_ms,end_ms,title,source_segment_indexes&order=chapter_index.asc",
    )
    takeaways = insight.get("key_takeaways") or []
    return {
        "video_id": video_id,
        "status": insight.get("status"),
        "language": insight.get("language"),
        "hash_prefix": (insight.get("content_hash") or "")[:12],
        "provider": insight.get("provider"),
        "model": insight.get("model"),
        "prompt_version": insight.get("prompt_version"),
        "schema_version": insight.get("schema_version"),
        "source_segment_count": insight.get("source_segment_count"),
        "error_code": insight.get("error_code"),
        "generated_at": insight.get("generated_at"),
        "short_summary_chars": len(insight.get("short_summary") or ""),
        "detailed_summary_chars": len(insight.get("detailed_summary") or ""),
        "takeaway_count": len(takeaways),
        "takeaway_ref_counts": [len(t.get("segment_indexes") or []) for t in takeaways if isinstance(t, dict)],
        "chapter_count": len(chapters),
        "chapters": [
            {"index": c["chapter_index"], "start_ms": c["start_ms"], "end_ms": c["end_ms"],
             "title_chars": len(c.get("title") or ""),
             "segment_refs": c.get("source_segment_indexes")}
            for c in chapters
        ],
    }


@app.function(image=chat_image, secrets=[secret], timeout=900, max_containers=1, cpu=4.0, memory=12288, retries=0)
def build_chat_index(video_id: str, force: bool = False):
    """Internal transcript-only chat-index backfill. No media processing."""
    from worker.app.chat_service import backfill_chat_index
    from worker.app.errors import WorkerError
    try:
        return backfill_chat_index(video_id, force=force)
    except WorkerError as err:
        return {"status": "error", "code": err.code, "detail": err.dev_detail[:240], "retryable": err.retryable}


@app.function(image=subtitle_image, secrets=[secret], timeout=120, max_containers=1)
def inspect_chat_index(video_id: str):
    from worker.app.chat_service import inspect_chat_index as inspect_index
    return inspect_index(video_id)


@app.function(image=chat_image, secrets=[secret], timeout=900, max_containers=1, cpu=4.0, memory=12288)
def diagnose_chat(video_id: str):
    """Modal-token-only structural chat diagnostic. Returns no private text."""
    from worker.app.chat_service import diagnose_chat_pipeline
    return diagnose_chat_pipeline(video_id)


@app.function(image=chat_image, secrets=[secret], timeout=900, max_containers=1, cpu=4.0, memory=12288)
@modal.asgi_app()
def chat_api():
    """Authenticated scale-to-zero chat API for the GitHub Pages frontend."""
    import json
    from fastapi import FastAPI, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from worker.app.chat_service import ask_video, persist_chat_failure
    from worker.app.errors import WorkerError

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    api.add_middleware(CORSMiddleware,
        allow_origins=["https://srsepehr.github.io", "http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=False, allow_methods=["POST", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "apikey", "X-Request-ID"], max_age=600)
    messages = {
        "CHAT_AUTH_REQUIRED": "برای پرسش از ویدیو ابتدا وارد حساب شوید.",
        "CHAT_ACCESS_DENIED": "اجازه دسترسی به گفت‌وگوی این ویدیو را ندارید.",
        "CHAT_VIDEO_NOT_FOUND": "ویدیوی موردنظر پیدا نشد.",
        "CHAT_TRANSCRIPT_MISSING": "متن این ویدیو هنوز آماده نیست.",
        "CHAT_TRANSLATION_INCOMPLETE": "ترجمه فارسی این ویدیو هنوز کامل نیست.",
        "CHAT_INDEX_MISSING": "جست‌وجوی هوشمند این ویدیو هنوز آماده نشده است.",
        "CHAT_STALE_INDEX": "متن ویدیو تغییر کرده و جست‌وجوی هوشمند باید به‌روزرسانی شود.",
        "CHAT_QUESTION_EMPTY": "پرسش خود را بنویسید.",
        "CHAT_QUESTION_TOO_LONG": "پرسش بیش از حد طولانی است.",
        "CHAT_RATE_LIMITED": "تعداد پرسش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
        "CHAT_REQUEST_CONFLICT": "این پرسش با شناسه تکراری نامعتبر است. دوباره ارسال کنید.",
        "CHAT_PROVIDER_UNAVAILABLE": "پاسخ‌گویی هوشمند موقتاً در دسترس نیست.",
        "CHAT_INVALID_OUTPUT": "پاسخ معتبر تولید نشد. دوباره تلاش کنید.",
        "CHAT_GROUNDING_FAILED": "پاسخ قابل استناد تولید نشد. دوباره تلاش کنید.",
    }

    async def ask(request):
        try:
            declared_length = int(request.headers.get("content-length") or 0)
        except ValueError:
            declared_length = 12_001
        if declared_length > 12_000:
            return JSONResponse({"error": {"code": "CHAT_QUESTION_TOO_LONG", "message_fa": messages["CHAT_QUESTION_TOO_LONG"]}}, status_code=413)
        raw_body = await request.body()
        if len(raw_body) > 12_000:
            return JSONResponse({"error": {"code": "CHAT_QUESTION_TOO_LONG", "message_fa": messages["CHAT_QUESTION_TOO_LONG"]}}, status_code=413)
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
        body: dict = {}
        try:
            body = json.loads(raw_body)
            if not isinstance(body, dict):
                raise ValueError("request body must be an object")
            result = ask_video(body, token)
            return JSONResponse(result)
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": {"code": "CHAT_INVALID_OUTPUT", "message_fa": "ساختار درخواست معتبر نیست."}}, status_code=400)
        except WorkerError as err:
            status = 401 if err.code == "CHAT_AUTH_REQUIRED" else 403 if err.code == "CHAT_ACCESS_DENIED" else 409 if err.code == "CHAT_REQUEST_CONFLICT" else 429 if err.code == "CHAT_RATE_LIMITED" else 400
            # Stable structural diagnostics only. Never log tokens, request
            # bodies, questions, transcript evidence, prompts, or answers.
            print(json.dumps({"event": "chat_api_worker_error", "code": err.code,
                              "status": status, "retryable": bool(err.retryable)},
                             sort_keys=True), flush=True)
            try:
                persist_chat_failure(body if isinstance(body, dict) else {}, token, err.code)
            except Exception:
                # Failure recording is best-effort and must never replace the
                # original classified response or leak internal diagnostics.
                pass
            return JSONResponse({"error": {"code": err.code, "message_fa": messages.get(err.code, "در پاسخ‌گویی خطایی رخ داد.")}}, status_code=status,
                headers={"Retry-After": "3600"} if err.code == "CHAT_RATE_LIMITED" else None)
        except Exception as exc:
            # Log only the exception class. Never log tokens, request bodies,
            # transcript evidence, prompts, or generated content.
            print(json.dumps({"event": "chat_api_unhandled",
                              "error_type": type(exc).__name__}, sort_keys=True), flush=True)
            try:
                persist_chat_failure(body, token, "CHAT_PROVIDER_UNAVAILABLE")
            except Exception:
                pass
            return JSONResponse({"error": {"code": "CHAT_PROVIDER_UNAVAILABLE", "message_fa": messages["CHAT_PROVIDER_UNAVAILABLE"]}}, status_code=500)

    # Postponed annotations cannot resolve a type imported only inside this
    # factory from the route function globals. Attach the concrete class before
    # registration so FastAPI injects Request instead of requiring a query field.
    ask.__annotations__["request"] = Request
    api.add_api_route("/", ask, methods=["POST"])
    return api


@app.local_entrypoint()
def chat_diagnose(video_id: str = ""):
    import json
    result = diagnose_chat.remote(video_id)
    print("diagnose_chat:", json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") == "error":
        raise SystemExit(1)


@app.local_entrypoint()
def chat_index(video_id: str = "", force: bool = False):
    import json
    result = build_chat_index.remote(video_id, force)
    print("chat_index:", json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") == "error":
        raise SystemExit(1)


@app.local_entrypoint()
def chat_index_inspect(video_id: str = ""):
    import json
    print("inspect_chat_index:", json.dumps(inspect_chat_index.remote(video_id), ensure_ascii=False, indent=2))


@app.local_entrypoint()
def insights(video_id: str = "", force: bool = False):
    import json
    result = generate_insights.remote(video_id, force)
    print("generate_insights:", json.dumps(result, ensure_ascii=False, indent=2))
    if result.get("status") == "error":
        raise SystemExit(1)


@app.local_entrypoint()
def insights_inspect(video_id: str = ""):
    import json
    print("inspect_insights:", json.dumps(inspect_insights.remote(video_id), ensure_ascii=False, indent=2))


@app.local_entrypoint()
def verify_subs(video_id: str = ""):
    import json
    print("verify_subtitles:", json.dumps(verify_subtitles.remote(video_id), ensure_ascii=False, indent=2))


@app.local_entrypoint()
def subs(video_id: str = "", force: bool = False):
    import json
    print("generate_subtitles:", json.dumps(generate_subtitles.remote(video_id, force), ensure_ascii=False, indent=2))


@app.local_entrypoint()
def subs_inspect(video_id: str = ""):
    import json
    print("inspect_subtitles:", json.dumps(inspect_subtitles.remote(video_id), ensure_ascii=False, indent=2))


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
