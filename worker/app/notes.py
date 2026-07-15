"""Pure, deterministic logic for the AI portion of a video Living Note.

The AI note is a SYNTHESIS of already-persisted, already-grounded material:
the video's insights (summary / key takeaways / chapters) and the owner's
explicitly saved chat answers. It never reprocesses video, audio, STT,
translation, or insight generation. Every citation it emits is a subset of
timestamps that were already validated elsewhere, mapped to real transcript
segment boundaries here — the model's own numbers are never trusted.

This module has no I/O and no heavy imports; all orchestration, persistence,
and provider calls live in note_service.py.
"""

from __future__ import annotations

import difflib
import hashlib
import json
from dataclasses import dataclass, field

from .errors import WorkerError
from .insights import is_mostly_persian, normalize_text
from .note_config import (
    DEFAULT_NOTE_CONFIG,
    NOTE_LANG,
    NOTE_MODEL,
    NOTE_PROMPT_VERSION,
    NOTE_PROVIDER,
    NOTE_SCHEMA_VERSION,
    NoteConfig,
)


@dataclass(frozen=True)
class NoteCitation:
    start_ms: int
    end_ms: int
    segment_indexes: list[int]


@dataclass(frozen=True)
class NoteItem:
    text: str
    citations: list[NoteCitation]


@dataclass
class NoteResult:
    overview: str
    key_points: list[NoteItem]
    action_items: list[NoteItem]
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class NoteSegment:
    segment_index: int
    start_ms: int
    end_ms: int
    text_fa: str


# ---------------------------------------------------------------------------
# Source-material assembly (from persisted insights + saved answers)
# ---------------------------------------------------------------------------

def prepare_note_segments(rows: list[dict]) -> dict[int, NoteSegment]:
    """Map segment_index -> NoteSegment. Only used for citation timing and to
    supply grounding text for referenced segments (never mutates transcripts)."""
    out: dict[int, NoteSegment] = {}
    for row in rows or []:
        try:
            index = int(row["segment_index"])
            start = int(row["start_ms"])
            end = int(row["end_ms"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start or start < 0:
            continue
        out[index] = NoteSegment(index, start, end, normalize_text(row.get("translated_text_fa") or ""))
    return out


def _refs_from(raw) -> list[int]:
    refs: list[int] = []
    if isinstance(raw, list):
        for item in raw:
            try:
                refs.append(int(item))
            except (TypeError, ValueError):
                continue
    return refs


def collect_allowed_refs(insight: dict, chapters: list[dict], saved_answers: list[dict],
                         segment_map: dict[int, NoteSegment]) -> list[int]:
    """Union of segment indexes referenced by already-grounded material that
    also exist in the transcript. These are the ONLY indexes the note may cite."""
    allowed: set[int] = set()
    for takeaway in (insight or {}).get("key_takeaways") or []:
        if isinstance(takeaway, dict):
            allowed.update(_refs_from(takeaway.get("segment_indexes")))
    for chapter in chapters or []:
        if isinstance(chapter, dict):
            allowed.update(_refs_from(chapter.get("source_segment_indexes")))
    for answer in saved_answers or []:
        for citation in (answer or {}).get("citations") or []:
            if isinstance(citation, dict):
                allowed.update(_refs_from(citation.get("source_segment_indexes")))
    return sorted(index for index in allowed if index in segment_map)


def has_source_material(insight: dict, saved_answers: list[dict]) -> bool:
    """True when there is anything meaningful to synthesize a note from."""
    if insight:
        if normalize_text(insight.get("short_summary") or ""):
            return True
        if normalize_text(insight.get("detailed_summary") or ""):
            return True
        if insight.get("key_takeaways"):
            return True
    return bool(saved_answers)


# ---------------------------------------------------------------------------
# Canonical generation hash (idempotency)
# ---------------------------------------------------------------------------

def saved_answer_fingerprints(saved_answers: list[dict]) -> list[str]:
    """Order-independent fingerprint of the saved answers feeding a note."""
    prints: list[str] = []
    for answer in saved_answers or []:
        citations = []
        for citation in (answer or {}).get("citations") or []:
            if not isinstance(citation, dict):
                continue
            citations.append([
                int(citation.get("start_ms") or 0),
                int(citation.get("end_ms") or 0),
                sorted(_refs_from(citation.get("source_segment_indexes"))),
            ])
        canonical = json.dumps(
            {
                "m": str(answer.get("message_id") or answer.get("id") or ""),
                "q": normalize_text(answer.get("question") or ""),
                "a": normalize_text(answer.get("answer") or ""),
                "c": sorted(citations),
            },
            ensure_ascii=False, sort_keys=True, separators=(",", ":"),
        )
        prints.append(hashlib.sha256(canonical.encode("utf-8")).hexdigest())
    return sorted(prints)


def note_content_hash(video_id: str, user_id: str, insight_hash: str,
                      saved_fingerprints: list[str], *,
                      provider: str = NOTE_PROVIDER, model: str = NOTE_MODEL,
                      prompt_version: str = NOTE_PROMPT_VERSION,
                      schema_version: str = NOTE_SCHEMA_VERSION,
                      language: str = NOTE_LANG) -> str:
    payload = {
        "video_id": video_id,
        "user_id": user_id,
        "language": language,
        "provider": provider,
        "model": model,
        "prompt_version": prompt_version,
        "schema_version": schema_version,
        "insight_hash": insight_hash or "",
        "saved": sorted(saved_fingerprints or []),
    }
    return hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


# ---------------------------------------------------------------------------
# Prompt payload (references only segment indexes; Persian material)
# ---------------------------------------------------------------------------

def build_note_user_message(insight: dict, chapters: list[dict], saved_answers: list[dict],
                            allowed_refs: list[int], segment_map: dict[int, NoteSegment], *,
                            title: str = "", config: NoteConfig = DEFAULT_NOTE_CONFIG) -> str:
    lines: list[str] = []
    if title:
        lines.append(f"عنوان ویدیو: {normalize_text(title)}")
    short = normalize_text((insight or {}).get("short_summary") or "")
    detailed = normalize_text((insight or {}).get("detailed_summary") or "")
    if short:
        lines.append(f"\nخلاصه کوتاه موجود:\n{short}")
    if detailed:
        lines.append(f"\nخلاصه کامل موجود:\n{detailed}")

    takeaways = [t for t in (insight or {}).get("key_takeaways") or [] if isinstance(t, dict)]
    if takeaways:
        lines.append("\nنکات کلیدی استخراج‌شده:")
        for takeaway in takeaways:
            refs = sorted(r for r in _refs_from(takeaway.get("segment_indexes")) if r in segment_map)
            text = normalize_text(takeaway.get("text") or "")
            if text:
                lines.append(f"- {text} [بخش‌ها: {refs}]")

    real_chapters = [c for c in chapters or [] if isinstance(c, dict)]
    if real_chapters:
        lines.append("\nفصل‌ها:")
        for chapter in real_chapters:
            refs = sorted(r for r in _refs_from(chapter.get("source_segment_indexes")) if r in segment_map)
            ctitle = normalize_text(chapter.get("title") or "")
            if ctitle:
                lines.append(f"- {ctitle} [بخش‌ها: {refs}]")

    real_saved = [a for a in saved_answers or [] if isinstance(a, dict)]
    if real_saved:
        lines.append("\nپرسش و پاسخ‌های ذخیره‌شده توسط کاربر:")
        for answer in real_saved:
            question = normalize_text(answer.get("question") or "")
            reply = normalize_text(answer.get("answer") or "")
            refs: set[int] = set()
            for citation in answer.get("citations") or []:
                if isinstance(citation, dict):
                    refs.update(r for r in _refs_from(citation.get("source_segment_indexes")) if r in segment_map)
            if reply:
                lines.append(f"- پرسش: {question}\n  پاسخ: {reply} [بخش‌ها: {sorted(refs)}]")

    # Grounding text for citable segments, bounded by the input budget.
    if allowed_refs:
        lines.append("\nمتن بخش‌های مرتبط (برای استناد زمانی):")
        budget = config.max_input_chars
        used = sum(len(line) for line in lines)
        for index in allowed_refs:
            segment = segment_map.get(index)
            if not segment or not segment.text_fa:
                continue
            entry = f"[{index}] {segment.text_fa}"
            if used + len(entry) > budget:
                break
            lines.append(entry)
            used += len(entry)

    return "\n".join(lines).strip()


# ---------------------------------------------------------------------------
# Strict validation + citation grounding
# ---------------------------------------------------------------------------

def _normalized_for_similarity(text: str) -> str:
    return normalize_text(text).replace("ي", "ی").replace("ك", "ک").replace("‌", " ").lower()


def _citation_for(refs: list[int], segment_map: dict[int, NoteSegment]) -> NoteCitation | None:
    valid = sorted({r for r in refs if r in segment_map})
    if not valid:
        return None
    return NoteCitation(
        start_ms=min(segment_map[r].start_ms for r in valid),
        end_ms=max(segment_map[r].end_ms for r in valid),
        segment_indexes=valid,
    )


def _clean_items(raw, allowed: set[int], segment_map: dict[int, NoteSegment], *,
                 max_items: int, min_persian: float, similarity: float) -> tuple[list[NoteItem], list[str]]:
    items: list[NoteItem] = []
    warnings: list[str] = []
    kept_norms: list[str] = []
    if not isinstance(raw, list):
        return items, warnings
    for entry in raw:
        if len(items) >= max_items:
            break
        if not isinstance(entry, dict):
            continue
        text = normalize_text(entry.get("text") or "")
        if not text or not is_mostly_persian(text, min_persian):
            continue
        norm = _normalized_for_similarity(text)
        if any(norm == existing or difflib.SequenceMatcher(None, norm, existing).ratio() >= similarity
               for existing in kept_norms):
            warnings.append("dropped near-duplicate note item")
            continue
        refs = [r for r in _refs_from(entry.get("segment_indexes")) if r in allowed]
        citation = _citation_for(refs, segment_map)
        items.append(NoteItem(text=text, citations=[citation] if citation else []))
        kept_norms.append(norm)
    return items, warnings


def validate_note_payload(payload: dict, allowed_refs: list[int], segment_map: dict[int, NoteSegment],
                          config: NoteConfig = DEFAULT_NOTE_CONFIG) -> NoteResult:
    if not isinstance(payload, dict):
        raise WorkerError("NOTE_INVALID_OUTPUT", dev_detail="payload not an object")
    overview = normalize_text(payload.get("overview") or payload.get("summary") or "")
    if not overview or not is_mostly_persian(overview, config.min_persian_ratio):
        raise WorkerError("NOTE_INVALID_OUTPUT", dev_detail="overview missing or not Persian")

    allowed = set(allowed_refs)
    key_points, kp_warn = _clean_items(
        payload.get("key_points"), allowed, segment_map,
        max_items=config.max_key_points, min_persian=config.min_persian_ratio,
        similarity=config.duplicate_similarity)
    if not key_points:
        raise WorkerError("NOTE_INVALID_OUTPUT", dev_detail="no valid key points")
    action_items, ai_warn = _clean_items(
        payload.get("action_items"), allowed, segment_map,
        max_items=config.max_action_items, min_persian=config.min_persian_ratio,
        similarity=config.duplicate_similarity)

    return NoteResult(overview=overview, key_points=key_points, action_items=action_items,
                      warnings=kp_warn + ai_warn)


def result_to_rpc_items(items: list[NoteItem]) -> list[dict]:
    """Serialize note items to the jsonb shape persisted by persist_video_note_ai."""
    return [
        {
            "text": item.text,
            "citations": [
                {"start_ms": c.start_ms, "end_ms": c.end_ms, "source_segment_indexes": c.segment_indexes}
                for c in item.citations
            ],
        }
        for item in items
    ]
