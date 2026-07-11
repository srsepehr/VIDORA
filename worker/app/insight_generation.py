"""Server-side insight generation / backfill orchestration.

Reads the persisted transcript (never mutated), computes the canonical input
hash, reuses a matching ready result, otherwise generates via the provider,
strictly validates + grounds the output, and persists insight + chapters
atomically through the service_role-only RPC. Returns STRUCTURAL metadata only
(counts, hash prefix, booleans) — never summary/takeaway/chapter text — so
nothing private lands in CI or worker logs.

Insight state is independent from video/job/subtitle state: a failure here
records a failed insight row and never touches the transcript, translations,
subtitles, or job status. Whisper, NLLB, FFmpeg, and the source video are never
loaded on this path.
"""

from __future__ import annotations

import json
import logging

from .config import Config, load_config
from .errors import WorkerError
from .insight_config import (
    DEFAULT_INSIGHT_CONFIG,
    INSIGHT_LANG,
    InsightConfig,
    PROMPT_VERSION,
    SCHEMA_VERSION,
)
from .insight_provider import LocalTransformersInsightProvider, VideoInsightProvider
from .insights import (
    InsightResult,
    InsightSegment,
    build_chunk_message,
    build_synthesis_message,
    build_user_message,
    content_hash,
    needs_hierarchical,
    plan_chunks,
    prepare_segments,
    validate_chunk_payload,
    validate_insight_payload,
)
from .prompts import INSIGHT_CHUNK_PROMPT, INSIGHT_SYNTHESIS_PROMPT, INSIGHT_SYSTEM_PROMPT
from .supabase import SupabaseClient

log = logging.getLogger("vidora.worker.insights")

_RETRYABLE_VALIDATION = {"INSIGHT_INVALID_OUTPUT", "INSIGHT_GROUNDING_FAILED", "INSIGHT_CHAPTERS_INVALID"}


def _attempt_with_repair(provider: VideoInsightProvider, system: str, user: str, validate):
    """One normal attempt + at most ONE controlled repair regeneration.

    The repair request includes the rejected structured payload and an explicit
    non-empty schema. Small local models otherwise tend to repeat omissions
    because they cannot see their previous assistant turn in this provider seam.
    """
    first_payload = provider.complete_json(system, user)
    try:
        return validate(first_payload)
    except WorkerError as err:
        if err.code not in _RETRYABLE_VALIDATION:
            raise
        rejected = json.dumps(first_payload, ensure_ascii=False, separators=(",", ":"))
        correction = (
            "Regenerate the entire answer. The rejected JSON was: "
            f"{rejected[:2000]}\n"
            f"Validation error: {err.dev_detail[:200]}. "
            "Return ONLY one valid JSON object with ALL of these exact keys: "
            '{"short_summary":"...","detailed_summary":"...",'
            '"key_takeaways":[{"text":"...","segment_indexes":[0]}],'
            '"chapters":[{"title":"...","description":"...",'
            '"segment_indexes":[0]}]}. '
            "key_takeaways and chapters MUST each contain at least one object. "
            "Write user-facing text in Persian, copy only real segment indexes "
            "from the input, and use each segment index in at most one chapter."
        )
        return validate(provider.complete_json(system, user, correction))


def _generate_direct(provider, segments, *, title, duration_ms, config) -> InsightResult:
    user = build_user_message(segments, title=title, duration_ms=duration_ms)
    return _attempt_with_repair(
        provider, INSIGHT_SYSTEM_PROMPT, user,
        lambda payload: validate_insight_payload(payload, segments, duration_ms, config),
    )


def _generate_hierarchical(provider, segments, *, title, duration_ms, config) -> InsightResult:
    chunks = plan_chunks(segments, config)
    intermediates: list[dict] = []
    for number, chunk in enumerate(chunks, start=1):
        user = build_chunk_message(chunk, number, len(chunks))
        intermediate = _attempt_with_repair(
            provider, INSIGHT_CHUNK_PROMPT, user,
            lambda payload, c=chunk: validate_chunk_payload(payload, c, config),
        )
        intermediates.append(intermediate)
    synthesis_user = build_synthesis_message(intermediates, title=title, duration_ms=duration_ms)
    return _attempt_with_repair(
        provider, INSIGHT_SYNTHESIS_PROMPT, synthesis_user,
        lambda payload: validate_insight_payload(payload, segments, duration_ms, config),
    )


def _structural(result: InsightResult, *, status: str, hash_hex: str, model: str, reused: bool) -> dict:
    """Safe metadata only — no generated content."""
    return {
        "status": status,
        "reused": reused,
        "model": model,
        "hash_prefix": hash_hex[:12],
        "segment_count": None,  # filled by caller
        "takeaway_count": len(result.takeaways),
        "chapter_count": len(result.chapters),
        "chapter_ranges_ms": [[c.start_ms, c.end_ms] for c in result.chapters],
        "short_summary_chars": len(result.short_summary),
        "detailed_summary_chars": len(result.detailed_summary),
        "warning_count": len(result.warnings),
    }


def generate_insights_for_video(config: Config, client: SupabaseClient, video_id: str,
                                *, force: bool = False,
                                provider: VideoInsightProvider | None = None,
                                insight_config: InsightConfig = DEFAULT_INSIGHT_CONFIG) -> dict:
    video = client.select_one(
        "videos", f"id=eq.{video_id}&select=id,user_id,title,original_filename,duration_seconds")
    if not video:
        raise WorkerError("INSIGHT_TRANSCRIPT_MISSING", dev_detail="video not found")
    duration_ms = int(round(video["duration_seconds"] * 1000)) if video.get("duration_seconds") else None
    title = video.get("title") or video.get("original_filename") or ""

    rows = client.select_many(
        "transcript_segments",
        f"video_id=eq.{video_id}&select=segment_index,start_ms,end_ms,source_text,translated_text_fa"
        f"&order=segment_index.asc",
    )
    segments = prepare_segments(rows)

    provider = provider or LocalTransformersInsightProvider(
        model_id=config.insight_model, download_root=config.stt_download_root)
    new_hash = content_hash(video_id, segments, provider=provider.name, model=provider.model_id)

    existing = client.select_one(
        "video_insights",
        f"video_id=eq.{video_id}&language=eq.{INSIGHT_LANG}"
        f"&select=id,status,content_hash,prompt_version,schema_version",
    )
    ready_current = bool(
        existing and existing.get("status") == "ready"
        and existing.get("content_hash") == new_hash
        and existing.get("prompt_version") == PROMPT_VERSION
        and existing.get("schema_version") == SCHEMA_VERSION
    )
    if ready_current and not force:
        chapters = client.select_many(
            "video_chapters", f"video_id=eq.{video_id}&select=start_ms,end_ms&order=chapter_index.asc")
        return {
            "status": "reused", "reused": True, "model": provider.model_id,
            "hash_prefix": new_hash[:12], "segment_count": len(segments),
            "chapter_count": len(chapters),
            "chapter_ranges_ms": [[c["start_ms"], c["end_ms"]] for c in chapters],
        }

    # A ready result whose input changed is explicitly marked stale (its content
    # is preserved for the UI until a valid replacement lands).
    if existing and existing.get("status") == "ready" and not ready_current:
        client.rpc("mark_video_insights_stale", {"p_video_id": video_id, "p_keep_hash": new_hash})

    # Only flip to 'generating' when there is no still-valid ready result: a
    # forced regeneration that fails must leave the valid ready row untouched.
    if not ready_current:
        client.rpc("set_video_insight_status", {
            "p_video_id": video_id, "p_language": INSIGHT_LANG, "p_status": "generating",
            "p_content_hash": new_hash, "p_error_code": None, "p_error_detail": None,
        })

    try:
        if needs_hierarchical(segments, insight_config):
            result = _generate_hierarchical(
                provider, segments, title=title, duration_ms=duration_ms, config=insight_config)
        else:
            result = _generate_direct(
                provider, segments, title=title, duration_ms=duration_ms, config=insight_config)
    except WorkerError as err:
        if not ready_current:
            try:
                client.rpc("set_video_insight_status", {
                    "p_video_id": video_id, "p_language": INSIGHT_LANG, "p_status": "failed",
                    "p_content_hash": new_hash, "p_error_code": err.code,
                    "p_error_detail": err.dev_detail[:400],
                })
            except WorkerError:
                pass  # never mask the original failure
        raise

    client.rpc("persist_video_insight", {
        "p_video_id": video_id,
        "p_language": INSIGHT_LANG,
        "p_short_summary": result.short_summary,
        "p_detailed_summary": result.detailed_summary,
        "p_key_takeaways": [
            {"text": t.text, "segment_indexes": t.segment_indexes} for t in result.takeaways
        ],
        "p_content_hash": new_hash,
        "p_provider": provider.name,
        "p_model": provider.model_id,
        "p_prompt_version": PROMPT_VERSION,
        "p_schema_version": SCHEMA_VERSION,
        "p_source_segment_count": len(segments),
        "p_chapters": [
            {
                "chapter_index": c.index, "title": c.title, "description": c.description,
                "start_ms": c.start_ms, "end_ms": c.end_ms,
                "source_segment_indexes": c.segment_indexes,
            }
            for c in result.chapters
        ],
    })

    out = _structural(result, status="generated", hash_hex=new_hash, model=provider.model_id, reused=False)
    out["segment_count"] = len(segments)
    log.info("insights %s for video=%s: %s", out["status"], video_id, {
        k: out[k] for k in ("takeaway_count", "chapter_count", "warning_count", "hash_prefix")})
    return out


def backfill_insights(video_id: str, *, force: bool = False,
                      provider: VideoInsightProvider | None = None) -> dict:
    """Entry used by the Modal insight function. No Whisper, NLLB, FFmpeg, or
    source-video access on this path."""
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    return generate_insights_for_video(config, client, video_id, force=force, provider=provider)
