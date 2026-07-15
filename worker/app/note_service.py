"""Authenticated AI Living-Note generation orchestration.

Builds the AI portion of a per-user Living Note (overview / key points /
action items) by SYNTHESIZING already-persisted, already-grounded material:
the video's ready insights, the owner's saved chat answers, and the referenced
Persian transcript text. It never downloads media, never runs FFmpeg/Whisper/
NLLB, and never regenerates insights, subtitles, or the chat index.

Security: the authenticated entry resolves the caller from their Supabase token
(never a client-supplied user_id), verifies video ownership, and writes AI
content only through the service_role-only persist RPC. Personal notes and saved
answers are never touched by this path, and a failed regeneration never discards
a prior valid AI result.

All returned/logged values are STRUCTURAL metadata only — never overview text,
key points, action items, transcript text, prompts, or tokens.
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
from .note_config import (
    DEFAULT_NOTE_CONFIG, NOTE_LANG, NOTE_MODEL, NOTE_PROMPT_VERSION,
    NOTE_PROVIDER, NOTE_SCHEMA_VERSION, NoteConfig,
)
from .note_provider import LocalTransformersNoteProvider, VideoNoteProvider
from .notes import (
    build_note_user_message, collect_allowed_refs, has_source_material,
    note_content_hash, prepare_note_segments, result_to_rpc_items,
    saved_answer_fingerprints, validate_note_payload,
)
from .prompts import NOTE_SYSTEM_PROMPT
from .supabase import SupabaseClient

log = logging.getLogger("vidora.worker.notes")

_RETRYABLE_VALIDATION = {"NOTE_INVALID_OUTPUT", "NOTE_GROUNDING_FAILED"}
# Guard against rapid forced regeneration of the same note (seconds).
_MIN_REGENERATE_INTERVAL = 20


def _authenticate(client: SupabaseClient, token: str) -> dict:
    if not token:
        raise WorkerError("NOTE_AUTH_REQUIRED", dev_detail="missing bearer token")
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
        raise WorkerError("NOTE_PROVIDER_UNAVAILABLE",
                          dev_detail=f"auth transport unavailable: {type(last_error).__name__}", retryable=True)
    if not response.ok:
        raise WorkerError("NOTE_AUTH_REQUIRED", dev_detail=f"auth http {response.status}")
    try:
        user = response.json() or {}
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise WorkerError("NOTE_PROVIDER_UNAVAILABLE",
                          dev_detail=f"auth response decode: {type(exc).__name__}", retryable=True)
    if not user.get("id"):
        raise WorkerError("NOTE_AUTH_REQUIRED", dev_detail="auth user missing id")
    return user


def _attempt_with_repair(provider: VideoNoteProvider, user: str, validate):
    """One normal attempt + at most ONE controlled repair regeneration."""
    first = provider.complete_json(NOTE_SYSTEM_PROMPT, user)
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
            "Return ONLY one valid JSON object with exactly these keys: "
            '{"overview":"...","key_points":[{"text":"...","segment_indexes":[0]}],'
            '"action_items":[{"text":"...","segment_indexes":[0]}]}. '
            "overview must be 2-4 fluent Persian sentences; key_points must contain "
            "at least one distinct Persian point; action_items may be an empty list. "
            "Copy only segment indexes that appear in the provided material."
        )
        return validate(provider.complete_json(NOTE_SYSTEM_PROMPT, user, correction))


def _structural(status: str, *, reused: bool, hash_hex: str, insight_hash: str, model: str,
                result=None, allowed_refs=None, saved_count: int = 0, segment_count: int = 0) -> dict:
    out = {
        "status": status,
        "reused": reused,
        "model": model,
        "hash_prefix": (hash_hex or "")[:12],
        "insight_hash_prefix": (insight_hash or "")[:12],
        "saved_answer_count": saved_count,
        "segment_count": segment_count,
        "allowed_ref_count": len(allowed_refs or []),
    }
    if result is not None:
        cited = sum(1 for item in (result.key_points + result.action_items) if item.citations)
        out.update({
            "overview_chars": len(result.overview),
            "key_point_count": len(result.key_points),
            "action_item_count": len(result.action_items),
            "cited_item_count": cited,
            "warning_count": len(result.warnings),
        })
    return out


def generate_note_for_video(config, client: SupabaseClient, video_id: str, user_id: str, *,
                            force: bool = False, provider: VideoNoteProvider | None = None,
                            note_config: NoteConfig = DEFAULT_NOTE_CONFIG) -> dict:
    video = client.select_one(
        "videos", f"id=eq.{video_id}&user_id=eq.{user_id}&select=id,user_id,title,original_filename")
    if not video:
        raise WorkerError("NOTE_ACCESS_DENIED", dev_detail="video not found or not owned")
    title = video.get("title") or video.get("original_filename") or ""

    insight = client.select_one(
        "video_insights",
        f"video_id=eq.{video_id}&language=eq.{NOTE_LANG}"
        f"&select=status,content_hash,short_summary,detailed_summary,key_takeaways")
    if not insight or insight.get("status") != "ready":
        raise WorkerError("NOTE_INSIGHT_MISSING", dev_detail="ready insight required")
    insight_hash = insight.get("content_hash") or ""

    chapters = client.select_many(
        "video_chapters",
        f"video_id=eq.{video_id}&select=title,description,start_ms,end_ms,source_segment_indexes"
        f"&order=chapter_index.asc")
    saved_answers = client.select_many(
        "video_note_saved_answers",
        f"video_id=eq.{video_id}&user_id=eq.{user_id}"
        f"&select=id,message_id,question,answer,not_in_video,citations&order=created_at.asc")
    rows = client.select_many(
        "transcript_segments",
        f"video_id=eq.{video_id}&select=segment_index,start_ms,end_ms,translated_text_fa"
        f"&order=segment_index.asc")
    segment_map = prepare_note_segments(rows)
    if not segment_map:
        raise WorkerError("NOTE_TRANSCRIPT_MISSING", dev_detail="no transcript segments")
    if not has_source_material(insight, saved_answers):
        raise WorkerError("NOTE_NO_SOURCE_MATERIAL", dev_detail="nothing to synthesize")

    allowed_refs = collect_allowed_refs(insight, chapters, saved_answers, segment_map)
    saved_fps = saved_answer_fingerprints(saved_answers)
    provider = provider or LocalTransformersNoteProvider()
    new_hash = note_content_hash(video_id, user_id, insight_hash, saved_fps,
                                 provider=provider.name, model=provider.model_id)

    existing = client.select_one(
        "video_notes",
        f"video_id=eq.{video_id}&user_id=eq.{user_id}"
        f"&select=ai_status,ai_content_hash,ai_prompt_version,ai_schema_version,ai_generated_at")
    ready_current = bool(
        existing and existing.get("ai_status") == "ready"
        and existing.get("ai_content_hash") == new_hash
        and existing.get("ai_prompt_version") == NOTE_PROMPT_VERSION
        and existing.get("ai_schema_version") == NOTE_SCHEMA_VERSION)
    if ready_current and not force:
        return _structural("reused", reused=True, hash_hex=new_hash, insight_hash=insight_hash,
                           model=provider.model_id, allowed_refs=allowed_refs,
                           saved_count=len(saved_answers), segment_count=len(segment_map))

    if force and existing and existing.get("ai_generated_at"):
        if _recently_generated(existing["ai_generated_at"], _MIN_REGENERATE_INTERVAL):
            raise WorkerError("NOTE_RATE_LIMITED", dev_detail="regeneration interval not elapsed")

    # A ready note whose inputs changed is marked stale (content preserved for the
    # UI) before regenerating.
    if existing and existing.get("ai_status") == "ready" and not ready_current:
        client.rpc("mark_video_note_ai_stale",
                   {"p_video_id": video_id, "p_user_id": user_id, "p_keep_hash": new_hash})
    if not ready_current:
        client.rpc("set_video_note_ai_status", {
            "p_video_id": video_id, "p_user_id": user_id, "p_status": "generating",
            "p_content_hash": new_hash, "p_error_code": None})

    user_message = build_note_user_message(
        insight, chapters, saved_answers, allowed_refs, segment_map, title=title, config=note_config)
    try:
        result = _attempt_with_repair(
            provider, user_message,
            lambda payload: validate_note_payload(payload, allowed_refs, segment_map, note_config))
    except WorkerError as err:
        if not ready_current:
            try:
                client.rpc("set_video_note_ai_status", {
                    "p_video_id": video_id, "p_user_id": user_id, "p_status": "failed",
                    "p_content_hash": new_hash, "p_error_code": err.code})
            except WorkerError:
                pass  # never mask the original failure
        raise

    client.rpc("persist_video_note_ai", {
        "p_video_id": video_id, "p_user_id": user_id,
        "p_overview": result.overview,
        "p_key_points": result_to_rpc_items(result.key_points),
        "p_action_items": result_to_rpc_items(result.action_items),
        "p_content_hash": new_hash,
        "p_source_insight_hash": insight_hash,
        "p_saved_answer_count": len(saved_answers),
        "p_provider": NOTE_PROVIDER, "p_model": provider.model_id,
        "p_prompt_version": NOTE_PROMPT_VERSION, "p_schema_version": NOTE_SCHEMA_VERSION})

    out = _structural("generated", reused=False, hash_hex=new_hash, insight_hash=insight_hash,
                      model=provider.model_id, result=result, allowed_refs=allowed_refs,
                      saved_count=len(saved_answers), segment_count=len(segment_map))
    log.info("note %s for video=%s: %s", out["status"], video_id,
             {k: out[k] for k in ("key_point_count", "action_item_count", "cited_item_count", "hash_prefix")})
    return out


def _recently_generated(iso_value: str, seconds: int) -> bool:
    try:
        stamp = datetime.fromisoformat(str(iso_value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - stamp).total_seconds() < seconds


def generate_note(body: dict, access_token: str, *, provider: VideoNoteProvider | None = None) -> dict:
    """Authenticated entry used by the Modal note endpoint (via the Edge gateway)."""
    started = time.monotonic()
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    user = _authenticate(client, access_token)
    try:
        video_id = str(uuid.UUID(str(body.get("video_id") or "")))
    except ValueError:
        raise WorkerError("NOTE_VIDEO_NOT_FOUND", dev_detail="invalid video UUID")
    force = bool(body.get("force"))
    out = generate_note_for_video(config, client, video_id, user["id"], force=force, provider=provider)
    out["runtime_ms"] = int((time.monotonic() - started) * 1000)
    return out


def backfill_note(video_id: str, user_id: str, *, force: bool = False,
                  provider: VideoNoteProvider | None = None) -> dict:
    """Modal-token-only note backfill for a specific owner. No media processing."""
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    return generate_note_for_video(config, client, video_id, user_id, force=force, provider=provider)


def inspect_note(video_id: str, user_id: str) -> dict:
    """Structural inspection of a user's note. Returns no note or transcript text."""
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    note = client.select_one(
        "video_notes",
        f"video_id=eq.{video_id}&user_id=eq.{user_id}"
        f"&select=ai_status,ai_content_hash,ai_source_insight_hash,ai_saved_answer_count,"
        f"ai_provider,ai_model,ai_prompt_version,ai_schema_version,ai_error_code,ai_generated_at,"
        f"personal_text,ai_overview,ai_key_points,ai_action_items,personal_updated_at") or {}
    saved = client.select_many(
        "video_note_saved_answers",
        f"video_id=eq.{video_id}&user_id=eq.{user_id}&select=id,message_id&order=created_at.asc")
    key_points = note.get("ai_key_points") or []
    action_items = note.get("ai_action_items") or []
    return {
        "video_id": video_id,
        "ai_status": note.get("ai_status"),
        "hash_prefix": (note.get("ai_content_hash") or "")[:12],
        "insight_hash_prefix": (note.get("ai_source_insight_hash") or "")[:12],
        "provider": note.get("ai_provider"), "model": note.get("ai_model"),
        "prompt_version": note.get("ai_prompt_version"), "schema_version": note.get("ai_schema_version"),
        "error_code": note.get("ai_error_code"), "generated_at": note.get("ai_generated_at"),
        "overview_chars": len(note.get("ai_overview") or ""),
        "key_point_count": len(key_points) if isinstance(key_points, list) else 0,
        "action_item_count": len(action_items) if isinstance(action_items, list) else 0,
        "personal_text_chars": len(note.get("personal_text") or ""),
        "personal_updated_at": note.get("personal_updated_at"),
        "saved_answer_count": len(saved),
    }
