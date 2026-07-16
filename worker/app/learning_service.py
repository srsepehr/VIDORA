"""Authenticated adaptive-learning orchestration (assessment + generation).

Reads ONLY already-persisted data (transcript segments and their Persian
translations); never downloads media and never runs FFmpeg/Whisper/NLLB or
regenerates subtitles/insights/chat/notes. Assessment and generation are
separate responsibilities with separate hashes: unchanged input reuses the
stored profile, and unchanged input+mode reuses the stored learning set with
no model call. Deterministic guards classify unsuitable videos (incomplete
translation, too short) WITHOUT calling the model, and an honest
none-recommendation is a successful outcome — filler items are never
fabricated to make a Learning tab look useful.

Security: authenticated entries resolve the caller from their Supabase token
(never a client-supplied user_id) and verify video ownership; all writes go
through service_role-only RPCs. Returned/logged values are STRUCTURAL metadata
only — never item text, transcript text, prompts, or tokens.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from datetime import datetime, timezone

from . import http_client
from .config import load_config
from .errors import WorkerError
from .learning import (
    AssessmentResult, assessment_hash, assessment_to_rpc, build_assessment_message,
    build_generation_message, deterministic_preassessment, generation_hash,
    items_to_rpc, prepare_learning_segments, scaled_caps, supported_modes,
    validate_assessment_payload, validate_learning_set_payload,
)
from .learning_config import (
    ASSESS_PROMPT_VERSION, ASSESS_SCHEMA_VERSION, DEFAULT_LEARNING_CONFIG,
    GEN_PROMPT_VERSION, GEN_SCHEMA_VERSION, LEARNING_PROVIDER, MODES,
    LearningConfig, load_learning_config,
)
from .learning_provider import LocalTransformersLearningProvider, VideoLearningSetProvider
from .prompts import LEARNING_ASSESS_PROMPT, LEARNING_GENERATE_PROMPT
from .supabase import SupabaseClient

log = logging.getLogger("vidora.worker.learning")

# An empty/ungrounded set for a SUPPORTED mode is most likely a bad generation
# (unsupported modes are rejected before the model runs), so it earns the one
# controlled repair before concluding the content is genuinely insufficient.
_RETRYABLE_VALIDATION = {"LEARNING_INVALID_OUTPUT", "LEARNING_GROUNDING_FAILED",
                         "LEARNING_INSUFFICIENT_CONTENT"}

_PROFILE_SELECT = ("id,status,recommended_mode,content_kind,content_suitability,"
                   "language_suitability,reason_code,teachable_points,content_hash,"
                   "prompt_version,schema_version,editorial_policy,assessed_at")


def _authenticate(client: SupabaseClient, token: str) -> dict:
    if not token:
        raise WorkerError("LEARNING_AUTH_REQUIRED", dev_detail="missing bearer token")
    response = None
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            response = http_client.request(
                "GET", f"{client.base_url}/auth/v1/user",
                headers={"apikey": client.key, "Authorization": f"Bearer {token}"}, timeout=15.0)
            break
        except (OSError, TimeoutError) as exc:
            last_error = exc
            if attempt < 2:
                time.sleep(0.2 * (attempt + 1))
    if response is None:
        raise WorkerError("LEARNING_PROVIDER_UNAVAILABLE",
                          dev_detail=f"auth transport unavailable: {type(last_error).__name__}", retryable=True)
    if not response.ok:
        raise WorkerError("LEARNING_AUTH_REQUIRED", dev_detail=f"auth http {response.status}")
    try:
        user = response.json() or {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerError("LEARNING_PROVIDER_UNAVAILABLE",
                          dev_detail=f"auth response decode: {type(exc).__name__}", retryable=True)
    if not user.get("id"):
        raise WorkerError("LEARNING_AUTH_REQUIRED", dev_detail="auth user missing id")
    return user


def _recently(iso_value, seconds: int) -> bool:
    try:
        stamp = datetime.fromisoformat(str(iso_value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).total_seconds() < seconds


def _attempt_with_repair(provider, system: str, user: str, validate, schema_hint: str):
    """One normal attempt + at most ONE controlled repair regeneration."""
    first = provider.complete_json(system, user)
    try:
        return validate(first)
    except WorkerError as err:
        if err.code not in _RETRYABLE_VALIDATION:
            raise
        rejected = json.dumps(first, ensure_ascii=False, separators=(",", ":"))
        correction = (
            "Regenerate the entire answer. The rejected JSON was: "
            f"{rejected[:1500]}\n"
            f"Validation error: {err.dev_detail[:200]}. "
            f"Return ONLY one valid JSON object with exactly this shape: {schema_hint} "
            "Copy only segment indexes that appear in the input. Write Persian-facing "
            "fields in fluent Persian."
        )
        return validate(provider.complete_json(system, user, correction))


def _load_video(client: SupabaseClient, video_id: str, user_id: str | None) -> dict:
    query = f"id=eq.{video_id}&select=id,user_id,title,original_filename"
    if user_id:
        query += f"&user_id=eq.{user_id}"
    video = client.select_one("videos", query)
    if not video:
        raise WorkerError("LEARNING_ACCESS_DENIED" if user_id else "LEARNING_VIDEO_NOT_FOUND",
                          dev_detail="video not found or not owned")
    return video


def _load_segments(client: SupabaseClient, video_id: str):
    rows = client.select_many(
        "transcript_segments",
        f"video_id=eq.{video_id}&select=segment_index,start_ms,end_ms,source_text,translated_text_fa"
        f"&order=segment_index.asc")
    return prepare_learning_segments(rows)


def _assessment_structural(result: AssessmentResult, *, status: str, hash_hex: str,
                           model: str, stats, reused: bool) -> dict:
    return {
        "status": status, "reused": reused, "model": model,
        "hash_prefix": (hash_hex or "")[:12],
        "recommended_mode": result.recommended_mode,
        "content_kind": result.content_kind,
        "content_suitability": result.content_suitability,
        "language_suitability": result.language_suitability,
        "reason_code": result.reason_code,
        "teachable_point_count": len(result.teachable_points),
        "assessment_source": result.source,
        "segment_count": stats.total_segments,
        "warning_count": len(result.warnings),
    }


# ---------------------------------------------------------------------------
# Assessment
# ---------------------------------------------------------------------------

def assess_video_for(client: SupabaseClient, video_id: str, *, force: bool = False,
                     provider: VideoLearningSetProvider | None = None,
                     learning_config: LearningConfig = DEFAULT_LEARNING_CONFIG,
                     video: dict | None = None) -> dict:
    video = video or _load_video(client, video_id, None)
    title = video.get("title") or video.get("original_filename") or ""
    segments, stats = _load_segments(client, video_id)
    provider = provider or LocalTransformersLearningProvider(
        max_new_tokens=learning_config.max_new_tokens_assess)
    new_hash = assessment_hash(video_id, segments, provider=provider.name, model=provider.model_id)

    existing = client.select_one(
        "video_learning_profiles", f"video_id=eq.{video_id}&select={_PROFILE_SELECT}")
    ready_current = bool(
        existing and existing.get("status") == "ready"
        and existing.get("content_hash") == new_hash
        and existing.get("prompt_version") == ASSESS_PROMPT_VERSION
        and existing.get("schema_version") == ASSESS_SCHEMA_VERSION)
    if ready_current and not force:
        return {
            "status": "reused", "reused": True, "model": provider.model_id,
            "hash_prefix": new_hash[:12],
            "recommended_mode": existing.get("recommended_mode"),
            "content_kind": existing.get("content_kind"),
            "content_suitability": existing.get("content_suitability"),
            "language_suitability": existing.get("language_suitability"),
            "reason_code": existing.get("reason_code"),
            "teachable_point_count": len(existing.get("teachable_points") or []),
            "segment_count": stats.total_segments,
        }
    if force and existing and _recently(existing.get("assessed_at"), learning_config.min_rerun_interval_seconds):
        raise WorkerError("LEARNING_RATE_LIMITED", dev_detail="assessment rerun interval not elapsed")

    # Input changed: preserve old ready artifacts as explicitly stale until a
    # replacement lands (sets whose profile hash no longer matches go stale too).
    if existing and existing.get("status") == "ready" and not ready_current:
        client.rpc("mark_video_learning_stale", {"p_video_id": video_id, "p_keep_profile_hash": new_hash})

    result = deterministic_preassessment(stats, learning_config)
    if result is None:
        if not ready_current:
            client.rpc("set_video_learning_profile_status", {
                "p_video_id": video_id, "p_status": "generating",
                "p_content_hash": new_hash, "p_error_code": None})
        user_message = build_assessment_message(segments, stats, title=title, config=learning_config)
        schema_hint = ('{"content_kind":"...","content_suitability":"high|medium|low|none",'
                       '"language_suitability":"high|medium|low|none","reason_code":"...",'
                       '"teachable_points":[{"text":"...","segment_indexes":[0]}]}')
        try:
            result = _attempt_with_repair(
                provider, LEARNING_ASSESS_PROMPT, user_message,
                lambda payload: validate_assessment_payload(payload, segments, stats, learning_config),
                schema_hint)
        except WorkerError as err:
            if not ready_current:
                try:
                    client.rpc("set_video_learning_profile_status", {
                        "p_video_id": video_id, "p_status": "failed",
                        "p_content_hash": new_hash, "p_error_code": err.code})
                except WorkerError:
                    pass  # never mask the original failure
            raise

    params = {"p_video_id": video_id, "p_content_hash": new_hash,
              "p_provider": provider.name, "p_model": provider.model_id,
              "p_prompt_version": ASSESS_PROMPT_VERSION, "p_schema_version": ASSESS_SCHEMA_VERSION}
    params.update(assessment_to_rpc(result))
    client.rpc("persist_video_learning_profile", params)

    out = _assessment_structural(result, status="assessed", hash_hex=new_hash,
                                 model=provider.model_id, stats=stats, reused=False)
    log.info("learning assessment for video=%s: %s", video_id, {
        k: out[k] for k in ("recommended_mode", "content_suitability", "language_suitability",
                            "reason_code", "assessment_source", "hash_prefix")})
    return out


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------

def generate_learning_set_for(client: SupabaseClient, video_id: str, mode: str, *,
                              force: bool = False,
                              provider: VideoLearningSetProvider | None = None,
                              learning_config: LearningConfig = DEFAULT_LEARNING_CONFIG,
                              video: dict | None = None) -> dict:
    if mode not in MODES:
        raise WorkerError("LEARNING_MODE_UNSUPPORTED", dev_detail=f"unknown mode {mode!r}")
    video = video or _load_video(client, video_id, None)
    title = video.get("title") or video.get("original_filename") or ""
    segments, stats = _load_segments(client, video_id)
    provider = provider or LocalTransformersLearningProvider(
        max_new_tokens=learning_config.max_new_tokens_generate)
    assess_hash = assessment_hash(video_id, segments, provider=provider.name, model=provider.model_id)

    # A current ready profile is required; an assessment reuse is free, so
    # re-establishing it here keeps generation retry-safe without blending the
    # two responsibilities (the model is only re-invoked when input changed).
    profile = client.select_one(
        "video_learning_profiles", f"video_id=eq.{video_id}&select={_PROFILE_SELECT}")
    profile_current = bool(
        profile and profile.get("status") == "ready"
        and profile.get("content_hash") == assess_hash
        and profile.get("prompt_version") == ASSESS_PROMPT_VERSION
        and profile.get("schema_version") == ASSESS_SCHEMA_VERSION)
    if not profile_current:
        assess_video_for(client, video_id, provider=provider,
                         learning_config=learning_config, video=video)
        profile = client.select_one(
            "video_learning_profiles", f"video_id=eq.{video_id}&select={_PROFILE_SELECT}")
        if not profile or profile.get("status") != "ready":
            raise WorkerError("LEARNING_ASSESSMENT_FAILED", dev_detail="profile unavailable after assess")

    allowed = supported_modes(profile)
    if mode not in allowed:
        code = ("LEARNING_NOT_RECOMMENDED"
                if (profile.get("recommended_mode") == "none"
                    and (profile.get("editorial_policy") or "auto") == "auto")
                else "LEARNING_MODE_UNSUPPORTED")
        raise WorkerError(code, dev_detail=f"mode {mode!r} not in supported {allowed}")

    new_hash = generation_hash(assess_hash, mode, provider=provider.name, model=provider.model_id)
    existing = client.select_one(
        "video_learning_sets",
        f"video_id=eq.{video_id}&mode=eq.{mode}"
        f"&select=id,status,content_hash,prompt_version,schema_version,"
        f"flashcard_count,quiz_count,generated_at")
    ready_current = bool(
        existing and existing.get("status") == "ready"
        and existing.get("content_hash") == new_hash
        and existing.get("prompt_version") == GEN_PROMPT_VERSION
        and existing.get("schema_version") == GEN_SCHEMA_VERSION)
    if ready_current and not force:
        return {"status": "reused", "reused": True, "mode": mode, "model": provider.model_id,
                "hash_prefix": new_hash[:12],
                "flashcard_count": existing.get("flashcard_count"),
                "quiz_count": existing.get("quiz_count"),
                "segment_count": stats.total_segments}
    if force and existing and _recently(existing.get("generated_at"), learning_config.min_rerun_interval_seconds):
        raise WorkerError("LEARNING_RATE_LIMITED", dev_detail="generation rerun interval not elapsed")

    if not ready_current:
        client.rpc("set_video_learning_set_status", {
            "p_video_id": video_id, "p_mode": mode, "p_status": "generating",
            "p_content_hash": new_hash, "p_error_code": None})

    caps = scaled_caps(stats, learning_config)
    user_message = build_generation_message(
        mode, segments, profile.get("teachable_points") or [], caps,
        title=title, config=learning_config)
    schema_hint = ('{"flashcards":[{"learning_mode":"content|language","front":"...","back":"...",'
                   '"segment_indexes":[0]}],"quiz":[{"learning_mode":"content|language",'
                   '"question":"...","choices":["...","...","..."],"correct_choice_index":0,'
                   '"explanation":"...","segment_indexes":[0]}]}')
    try:
        result = _attempt_with_repair(
            provider, LEARNING_GENERATE_PROMPT, user_message,
            lambda payload: validate_learning_set_payload(payload, mode, segments, stats, learning_config),
            schema_hint)
    except WorkerError as err:
        if not ready_current:
            try:
                client.rpc("set_video_learning_set_status", {
                    "p_video_id": video_id, "p_mode": mode, "p_status": "failed",
                    "p_content_hash": new_hash, "p_error_code": err.code})
            except WorkerError:
                pass  # never mask the original failure
        raise

    client.rpc("persist_video_learning_set", {
        "p_video_id": video_id, "p_mode": mode,
        "p_content_hash": new_hash, "p_profile_hash": assess_hash,
        "p_provider": LEARNING_PROVIDER, "p_model": provider.model_id,
        "p_prompt_version": GEN_PROMPT_VERSION, "p_schema_version": GEN_SCHEMA_VERSION,
        "p_items": items_to_rpc(result)})

    out = {"status": "generated", "reused": False, "mode": mode, "model": provider.model_id,
           "hash_prefix": new_hash[:12], "flashcard_count": result.flashcard_count,
           "quiz_count": result.quiz_count, "segment_count": stats.total_segments,
           "warning_count": len(result.warnings)}
    log.info("learning set %s for video=%s: %s", out["status"], video_id, {
        k: out[k] for k in ("mode", "flashcard_count", "quiz_count", "warning_count", "hash_prefix")})
    return out


# ---------------------------------------------------------------------------
# Authenticated entries (used by the Modal endpoint via the Edge gateway)
# ---------------------------------------------------------------------------

def _authed_context(body: dict, access_token: str):
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    user = _authenticate(client, access_token)
    try:
        video_id = str(uuid.UUID(str(body.get("video_id") or "")))
    except ValueError:
        raise WorkerError("LEARNING_VIDEO_NOT_FOUND", dev_detail="invalid video UUID")
    video = _load_video(client, video_id, user["id"])
    return client, video_id, video


def assess_learning(body: dict, access_token: str, *,
                    provider: VideoLearningSetProvider | None = None) -> dict:
    started = time.monotonic()
    client, video_id, video = _authed_context(body, access_token)
    out = assess_video_for(client, video_id, force=bool(body.get("force")),
                           provider=provider, learning_config=load_learning_config(), video=video)
    out["runtime_ms"] = int((time.monotonic() - started) * 1000)
    return out


def generate_learning(body: dict, access_token: str, *,
                      provider: VideoLearningSetProvider | None = None) -> dict:
    started = time.monotonic()
    client, video_id, video = _authed_context(body, access_token)
    mode = str(body.get("mode") or "").strip().lower()
    out = generate_learning_set_for(client, video_id, mode, force=bool(body.get("force")),
                                    provider=provider, learning_config=load_learning_config(),
                                    video=video)
    out["runtime_ms"] = int((time.monotonic() - started) * 1000)
    return out


# ---------------------------------------------------------------------------
# Modal-token-only entries (backfill / inspection; no user auth, no user data)
# ---------------------------------------------------------------------------

def backfill_learning_assessment(video_id: str, *, force: bool = False,
                                 provider: VideoLearningSetProvider | None = None) -> dict:
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    return assess_video_for(client, video_id, force=force, provider=provider,
                            learning_config=load_learning_config())


def backfill_learning_set(video_id: str, mode: str, *, force: bool = False,
                          provider: VideoLearningSetProvider | None = None) -> dict:
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    return generate_learning_set_for(client, video_id, mode, force=force, provider=provider,
                                     learning_config=load_learning_config())


def inspect_learning(video_id: str) -> dict:
    """Structural inspection. Returns no item text, transcript text, or answers."""
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    profile = client.select_one(
        "video_learning_profiles",
        f"video_id=eq.{video_id}&select={_PROFILE_SELECT},assessment_source") or {}
    sets = client.select_many(
        "video_learning_sets",
        f"video_id=eq.{video_id}&select=mode,status,content_hash,flashcard_count,quiz_count,"
        f"error_code,generated_at&order=mode.asc")
    items = client.select_many(
        "video_learning_items",
        f"video_id=eq.{video_id}&select=item_index,item_type,learning_mode,"
        f"source_segment_indexes,start_ms,end_ms&order=item_index.asc")
    return {
        "video_id": video_id,
        "profile_status": profile.get("status"),
        "recommended_mode": profile.get("recommended_mode"),
        "content_kind": profile.get("content_kind"),
        "content_suitability": profile.get("content_suitability"),
        "language_suitability": profile.get("language_suitability"),
        "reason_code": profile.get("reason_code"),
        "editorial_policy": profile.get("editorial_policy"),
        "assessment_source": profile.get("assessment_source"),
        "teachable_point_count": len(profile.get("teachable_points") or []),
        "profile_hash_prefix": (profile.get("content_hash") or "")[:12],
        "assessed_at": profile.get("assessed_at"),
        "sets": [{"mode": s["mode"], "status": s["status"],
                  "hash_prefix": (s.get("content_hash") or "")[:12],
                  "flashcard_count": s.get("flashcard_count"), "quiz_count": s.get("quiz_count"),
                  "error_code": s.get("error_code"), "generated_at": s.get("generated_at")}
                 for s in sets],
        "item_count": len(items),
        "items": [{"index": i["item_index"], "type": i["item_type"], "mode": i["learning_mode"],
                   "segment_refs": i["source_segment_indexes"],
                   "start_ms": i["start_ms"], "end_ms": i["end_ms"]} for i in items],
    }
