"""Server-side subtitle generation / backfill.

Reads the persisted Persian transcript (never mutates it), builds deterministic
cues + VTT/SRT with the shared builder, uploads the artifacts to the private
results bucket, and records idempotent metadata. Loads NO AI models — only the
stdlib subtitle builder — so it is safe to run in a lightweight image.

Idempotency: keyed by the canonical content hash. If matching ready artifacts
already exist for both formats, generation is a safe no-op reuse. A failure
never clobbers a previously-ready artifact, and superseded objects (from an old
hash) are deleted only after the new set is confirmed ready.
"""

from __future__ import annotations

from .config import Config, load_config
from .errors import (
    WorkerError,
    SUBTITLE_TRANSCRIPT_MISSING,
    SUBTITLE_TRANSLATION_INCOMPLETE,
    SUBTITLE_STORAGE_FAILED,
)
from .subtitle_config import SUBTITLE_LANG, BUILDER_VERSION
from .subtitles import SourceSegment, build_artifacts, content_hash
from .supabase import SupabaseClient

# The results bucket's allowed_mime_types allowlist matches these values
# exactly (a charset parameter would be rejected). The stored bytes are UTF-8,
# so Persian is preserved regardless of the header parameter.
VTT_MIME = "text/vtt"
# SRT has no registered IANA type; application/x-subrip is the de-facto value the
# results bucket already allows.
SRT_MIME = "application/x-subrip"

_FORMATS = ("vtt", "srt")


def _subtitle_path(owner_id: str, video_id: str, hash_hex: str, fmt: str) -> str:
    return f"{owner_id}/videos/{video_id}/subtitles/{hash_hex}/fa.{fmt}"


def _fetch_segments(client: SupabaseClient, video_id: str) -> list[SourceSegment]:
    rows = client.select_many(
        "transcript_segments",
        f"video_id=eq.{video_id}&select=segment_index,start_ms,end_ms,translated_text_fa&order=segment_index.asc",
    )
    if not rows:
        raise WorkerError(SUBTITLE_TRANSCRIPT_MISSING, dev_detail="no transcript rows")
    segments: list[SourceSegment] = []
    for r in rows:
        text = (r.get("translated_text_fa") or "").strip()
        if not text:
            raise WorkerError(
                SUBTITLE_TRANSLATION_INCOMPLETE,
                dev_detail=f"segment {r.get('segment_index')} missing Persian translation",
            )
        segments.append(SourceSegment(r["segment_index"], r["start_ms"], r["end_ms"], text))
    return segments


def _upsert(client: SupabaseClient, video_id: str, fmt: str, status: str, *, storage_path=None,
            hash_hex=None, cue_count=None, source_count=None, warnings=None, error_code=None, error_detail=None):
    client.rpc("upsert_subtitle_artifact", {
        "p_video_id": video_id, "p_language": SUBTITLE_LANG, "p_format": fmt, "p_status": status,
        "p_storage_path": storage_path, "p_content_hash": hash_hex, "p_builder_version": BUILDER_VERSION,
        "p_cue_count": cue_count, "p_source_segment_count": source_count,
        "p_validation_warnings": warnings or [], "p_error_code": error_code, "p_error_detail": error_detail,
    })


def _fail_both(client: SupabaseClient, video_id: str, err: WorkerError):
    for fmt in _FORMATS:
        try:
            _upsert(client, video_id, fmt, "failed", error_code=err.code, error_detail=err.dev_detail[:400])
        except WorkerError:
            pass  # never mask the original failure


def generate_subtitles_for_video(config: Config, client: SupabaseClient, video_id: str, *, force: bool = False) -> dict:
    video = client.select_one("videos", f"id=eq.{video_id}&select=id,user_id,duration_seconds,status")
    if not video:
        raise WorkerError(SUBTITLE_TRANSCRIPT_MISSING, dev_detail="video not found")
    owner_id = video["user_id"]
    duration_ms = int(round(video["duration_seconds"] * 1000)) if video.get("duration_seconds") else None

    segments = _fetch_segments(client, video_id)
    new_hash = content_hash(video_id, segments, SUBTITLE_LANG, BUILDER_VERSION)

    existing = client.select_many(
        "subtitle_artifacts",
        f"video_id=eq.{video_id}&language=eq.{SUBTITLE_LANG}&select=format,status,content_hash,builder_version,storage_path,cue_count",
    )

    def ready(fmt):
        return next((a for a in existing if a["format"] == fmt and a["status"] == "ready"
                     and a.get("content_hash") == new_hash and a.get("builder_version") == BUILDER_VERSION), None)

    if not force and ready("vtt") and ready("srt"):
        return {
            "status": "reused", "content_hash": new_hash,
            "cue_count": ready("vtt").get("cue_count"),
            "vtt_path": ready("vtt")["storage_path"], "srt_path": ready("srt")["storage_path"],
        }

    # Objects from a superseded hash — deleted only after the new set is ready.
    old_paths = [a["storage_path"] for a in existing if a.get("storage_path") and a.get("content_hash") != new_hash]

    for fmt in _FORMATS:
        _upsert(client, video_id, fmt, "generating", hash_hex=new_hash)

    try:
        result, vtt, srt = build_artifacts(video_id, segments, duration_ms)
    except WorkerError as err:
        _fail_both(client, video_id, err)
        raise

    vtt_path = _subtitle_path(owner_id, video_id, result.content_hash, "vtt")
    srt_path = _subtitle_path(owner_id, video_id, result.content_hash, "srt")
    uploaded: list[str] = []
    try:
        client.upload_storage_object(config.results_bucket, vtt_path, vtt.encode("utf-8"), VTT_MIME)
        uploaded.append(vtt_path)
        client.upload_storage_object(config.results_bucket, srt_path, srt.encode("utf-8"), SRT_MIME)
        uploaded.append(srt_path)
        # Confirm both objects are readable before recording success.
        if not (client.storage_object_exists(config.results_bucket, vtt_path)
                and client.storage_object_exists(config.results_bucket, srt_path)):
            raise WorkerError(SUBTITLE_STORAGE_FAILED, dev_detail="uploaded object not found on verify")
    except WorkerError as err:
        for path in uploaded:  # clean partial upload
            try:
                client.delete_storage_object(config.results_bucket, path)
            except WorkerError:
                pass
        _fail_both(client, video_id, err)
        raise

    cue_count = len(result.cues)
    _upsert(client, video_id, "vtt", "ready", storage_path=vtt_path, hash_hex=result.content_hash,
            cue_count=cue_count, source_count=result.source_segment_count, warnings=result.warnings)
    _upsert(client, video_id, "srt", "ready", storage_path=srt_path, hash_hex=result.content_hash,
            cue_count=cue_count, source_count=result.source_segment_count, warnings=result.warnings)

    # Supersede: remove old-hash objects now that the new set is confirmed ready.
    for path in old_paths:
        if path in (vtt_path, srt_path):
            continue
        try:
            client.delete_storage_object(config.results_bucket, path)
        except WorkerError:
            pass

    return {
        "status": "generated", "content_hash": result.content_hash, "cue_count": cue_count,
        "source_segment_count": result.source_segment_count, "warnings": result.warnings,
        "vtt_path": vtt_path, "srt_path": srt_path,
    }


def backfill_subtitles(video_id: str, *, force: bool = False) -> dict:
    """Entry used by the lightweight Modal function — loads config, no AI models."""
    config = load_config(require_translation=False)
    client = SupabaseClient(config.supabase_url, config.service_role_key)
    return generate_subtitles_for_video(config, client, video_id, force=force)
