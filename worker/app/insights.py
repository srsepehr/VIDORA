"""Pure video-insight logic: canonical hashing, prompt payloads, strict output
validation, grounding checks, and deterministic chapter mapping.

No model, network, or database dependency — fully unit-testable. The model is
never allowed to invent timestamps: it may only reference transcript segment
indexes, and chapter start/end times are derived here from the real persisted
segment boundaries. The persisted transcript is never mutated.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Optional

from .errors import (
    WorkerError,
    INSIGHT_TRANSCRIPT_MISSING,
    INSIGHT_TRANSLATION_INCOMPLETE,
    INSIGHT_TRANSCRIPT_TOO_LARGE,
    INSIGHT_INVALID_OUTPUT,
    INSIGHT_GROUNDING_FAILED,
    INSIGHT_CHAPTERS_INVALID,
)
from .insight_config import (
    DEFAULT_INSIGHT_CONFIG,
    INSIGHT_LANG,
    InsightConfig,
    PROMPT_VERSION,
    SCHEMA_VERSION,
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class InsightSegment:
    segment_index: int
    start_ms: int
    end_ms: int
    text_fa: str
    source_text: str = ""


@dataclass
class Takeaway:
    text: str
    segment_indexes: list[int]


@dataclass
class Chapter:
    index: int
    title: str
    description: str
    start_ms: int
    end_ms: int
    segment_indexes: list[int]


@dataclass
class InsightResult:
    language: str
    short_summary: str
    detailed_summary: str
    takeaways: list[Takeaway]
    chapters: list[Chapter]
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    if text is None:
        return ""
    return _WS.sub(" ", str(text)).strip()


_ARABIC_BLOCKS = (
    ("؀", "ۿ"), ("ݐ", "ݿ"), ("ﭐ", "﷿"), ("ﹰ", "﻿"),
)


def is_mostly_persian(text: str, min_ratio: float = DEFAULT_INSIGHT_CONFIG.min_persian_ratio) -> bool:
    """Among alphabetic characters, require at least ``min_ratio`` Arabic-script.
    Latin technical terms, names, and code identifiers remain allowed."""
    persian = latin = 0
    for ch in text:
        if any(lo <= ch <= hi for lo, hi in _ARABIC_BLOCKS):
            persian += 1
        elif ("a" <= ch <= "z") or ("A" <= ch <= "Z"):
            latin += 1
    letters = persian + latin
    if letters == 0:
        return False
    return persian / letters >= min_ratio


def _normalized_for_similarity(text: str) -> str:
    return (
        normalize_text(text)
        .replace("ي", "ی").replace("ك", "ک")
        .replace("‌", " ")
        .lower()
    )


def dedupe_takeaways(takeaways: list[Takeaway], similarity: float) -> tuple[list[Takeaway], list[str]]:
    """Drop exact and near-duplicate takeaways (deterministic, order-preserving)."""
    kept: list[Takeaway] = []
    warnings: list[str] = []
    for candidate in takeaways:
        cnorm = _normalized_for_similarity(candidate.text)
        duplicate = False
        for existing in kept:
            enorm = _normalized_for_similarity(existing.text)
            if cnorm == enorm or difflib.SequenceMatcher(None, cnorm, enorm).ratio() >= similarity:
                duplicate = True
                break
        if duplicate:
            warnings.append(f"dropped near-duplicate takeaway (refs {candidate.segment_indexes})")
        else:
            kept.append(candidate)
    return kept, warnings


# ---------------------------------------------------------------------------
# Canonical input + hash (idempotency)
# ---------------------------------------------------------------------------

def canonical_input(video_id: str, segments: list[InsightSegment], *, provider: str, model: str,
                    prompt_version: str = PROMPT_VERSION, schema_version: str = SCHEMA_VERSION,
                    language: str = INSIGHT_LANG) -> str:
    ordered = sorted(segments, key=lambda s: (s.segment_index, s.start_ms))
    payload = {
        "video_id": video_id,
        "language": language,
        "provider": provider,
        "model": model,
        "prompt_version": prompt_version,
        "schema_version": schema_version,
        "segments": [
            {"i": s.segment_index, "s": int(s.start_ms), "e": int(s.end_ms),
             "t": normalize_text(s.text_fa), "src": normalize_text(s.source_text)}
            for s in ordered
        ],
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(video_id: str, segments: list[InsightSegment], *, provider: str, model: str,
                 prompt_version: str = PROMPT_VERSION, schema_version: str = SCHEMA_VERSION) -> str:
    return hashlib.sha256(
        canonical_input(video_id, segments, provider=provider, model=model,
                        prompt_version=prompt_version, schema_version=schema_version).encode("utf-8")
    ).hexdigest()


# ---------------------------------------------------------------------------
# Input preparation + deterministic chunk planning
# ---------------------------------------------------------------------------

def prepare_segments(rows: list[dict]) -> list[InsightSegment]:
    """Build ordered segments from transcript rows, refusing incomplete input."""
    if not rows:
        raise WorkerError(INSIGHT_TRANSCRIPT_MISSING, dev_detail="no transcript rows")
    segments: list[InsightSegment] = []
    for row in rows:
        fa = normalize_text(row.get("translated_text_fa") or "")
        if not fa:
            raise WorkerError(
                INSIGHT_TRANSLATION_INCOMPLETE,
                dev_detail=f"segment {row.get('segment_index')} missing Persian translation",
            )
        segments.append(InsightSegment(
            segment_index=int(row["segment_index"]),
            start_ms=int(row["start_ms"]),
            end_ms=int(row["end_ms"]),
            text_fa=fa,
            source_text=normalize_text(row.get("source_text") or ""),
        ))
    segments.sort(key=lambda s: (s.start_ms, s.segment_index))
    return segments


def input_chars(segments: list[InsightSegment]) -> int:
    return sum(len(s.text_fa) + len(s.source_text) + 24 for s in segments)


def plan_chunks(segments: list[InsightSegment], config: InsightConfig = DEFAULT_INSIGHT_CONFIG) -> list[list[InsightSegment]]:
    """Chronological chunks for the hierarchical path. Never splits a segment,
    never drops one, preserves order and timestamps."""
    total = input_chars(segments)
    if total > config.max_total_input_chars:
        raise WorkerError(INSIGHT_TRANSCRIPT_TOO_LARGE, dev_detail=f"{total} chars > {config.max_total_input_chars}")
    chunks: list[list[InsightSegment]] = []
    current: list[InsightSegment] = []
    size = 0
    for seg in segments:
        seg_size = len(seg.text_fa) + len(seg.source_text) + 24
        if current and size + seg_size > config.chunk_chars:
            chunks.append(current)
            current = []
            size = 0
        current.append(seg)
        size += seg_size
    if current:
        chunks.append(current)
    # Invariant: no segment lost.
    assert sum(len(c) for c in chunks) == len(segments)
    return chunks


def needs_hierarchical(segments: list[InsightSegment], config: InsightConfig = DEFAULT_INSIGHT_CONFIG) -> bool:
    return input_chars(segments) > config.max_direct_input_chars


# ---------------------------------------------------------------------------
# Prompt payloads (the model sees segment indexes, never invents timestamps)
# ---------------------------------------------------------------------------

def build_user_message(segments: list[InsightSegment], *, title: str = "",
                       duration_ms: Optional[int] = None) -> str:
    return json.dumps({
        "video_title": normalize_text(title)[:120],
        "duration_seconds": round(duration_ms / 1000, 1) if duration_ms else None,
        "segment_count": len(segments),
        "segments": [
            {
                "index": s.segment_index,
                "start_s": round(s.start_ms / 1000, 1),
                "end_s": round(s.end_ms / 1000, 1),
                "fa": s.text_fa,
                **({"source": s.source_text} if s.source_text else {}),
            }
            for s in segments
        ],
    }, ensure_ascii=False)


def build_chunk_message(chunk: list[InsightSegment], chunk_no: int, total_chunks: int) -> str:
    return json.dumps({
        "chunk": chunk_no,
        "total_chunks": total_chunks,
        "segments": [
            {"index": s.segment_index, "start_s": round(s.start_ms / 1000, 1),
             "end_s": round(s.end_ms / 1000, 1), "fa": s.text_fa}
            for s in chunk
        ],
    }, ensure_ascii=False)


def build_synthesis_message(intermediates: list[dict], *, title: str = "",
                            duration_ms: Optional[int] = None) -> str:
    return json.dumps({
        "video_title": normalize_text(title)[:120],
        "duration_seconds": round(duration_ms / 1000, 1) if duration_ms else None,
        "chunk_summaries": intermediates,
    }, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Strict output validation + grounding + deterministic chapter mapping
# ---------------------------------------------------------------------------

def _require_str(payload: dict, key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not normalize_text(value):
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"missing/empty {key}")
    return normalize_text(value)


def _valid_indexes(raw, real: set[int], context: str) -> list[int]:
    if not isinstance(raw, list) or not raw:
        raise WorkerError(INSIGHT_GROUNDING_FAILED, dev_detail=f"{context}: empty segment reference list")
    out: list[int] = []
    for item in raw:
        try:
            idx = int(item)
        except (TypeError, ValueError):
            raise WorkerError(INSIGHT_GROUNDING_FAILED, dev_detail=f"{context}: non-integer segment ref {item!r}")
        if idx not in real:
            raise WorkerError(INSIGHT_GROUNDING_FAILED, dev_detail=f"{context}: unknown segment index {idx}")
        if idx not in out:
            out.append(idx)
    return sorted(out)


def validate_insight_payload(payload: dict, segments: list[InsightSegment],
                             duration_ms: Optional[int] = None,
                             config: InsightConfig = DEFAULT_INSIGHT_CONFIG) -> InsightResult:
    """Strictly validate a parsed model payload, ground every reference against
    real segments, and derive chapter timing from real segment boundaries."""
    if not isinstance(payload, dict):
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="payload is not an object")

    warnings: list[str] = []
    by_index = {s.segment_index: s for s in segments}
    real = set(by_index)

    short_summary = _require_str(payload, "short_summary")
    detailed_summary = _require_str(payload, "detailed_summary")
    for label, text in (("short_summary", short_summary), ("detailed_summary", detailed_summary)):
        if not is_mostly_persian(text, config.min_persian_ratio):
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"{label} is not Persian")

    # --- takeaways ---------------------------------------------------------
    raw_takeaways = payload.get("key_takeaways")
    if not isinstance(raw_takeaways, list) or not raw_takeaways:
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="key_takeaways missing/empty")
    takeaways: list[Takeaway] = []
    for i, item in enumerate(raw_takeaways):
        if not isinstance(item, dict):
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"takeaway {i} not an object")
        text = normalize_text(item.get("text") or "")
        if not text:
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"takeaway {i} empty text")
        if not is_mostly_persian(text, config.min_persian_ratio):
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"takeaway {i} is not Persian")
        refs = _valid_indexes(item.get("segment_indexes"), real, f"takeaway {i}")
        takeaways.append(Takeaway(text=text, segment_indexes=refs))
    takeaways, dup_warnings = dedupe_takeaways(takeaways, config.duplicate_similarity)
    warnings.extend(dup_warnings)
    if not takeaways:
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="all takeaways were duplicates")
    if len(takeaways) > config.max_takeaways:
        warnings.append(f"trimmed takeaways {len(takeaways)} -> {config.max_takeaways}")
        takeaways = takeaways[: config.max_takeaways]

    # --- chapters (timing derived from real segment boundaries) -------------
    raw_chapters = payload.get("chapters")
    if not isinstance(raw_chapters, list) or not raw_chapters:
        raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail="chapters missing/empty")
    if len(raw_chapters) > min(config.max_chapters, len(segments)):
        raise WorkerError(
            INSIGHT_CHAPTERS_INVALID,
            dev_detail=f"{len(raw_chapters)} chapters exceeds limit for {len(segments)} segments",
        )
    used: set[int] = set()
    drafts: list[Chapter] = []
    for i, item in enumerate(raw_chapters):
        if not isinstance(item, dict):
            raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail=f"chapter {i} not an object")
        title = normalize_text(item.get("title") or "")
        if not title:
            raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail=f"chapter {i} empty title")
        if not is_mostly_persian(title, config.min_persian_ratio):
            raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail=f"chapter {i} title not Persian")
        refs = _valid_indexes(item.get("segment_indexes"), real, f"chapter {i}")
        overlap = used.intersection(refs)
        if overlap:
            raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail=f"chapter {i} reuses segments {sorted(overlap)}")
        used.update(refs)
        start_ms = min(by_index[r].start_ms for r in refs)
        end_ms = max(by_index[r].end_ms for r in refs)
        if duration_ms is not None:
            end_ms = min(end_ms, duration_ms)
        if end_ms <= start_ms:
            raise WorkerError(INSIGHT_CHAPTERS_INVALID, dev_detail=f"chapter {i} non-positive duration after clamp")
        description = normalize_text(item.get("description") or "")[:280]
        drafts.append(Chapter(0, title, description, start_ms, end_ms, refs))

    drafts.sort(key=lambda c: (c.start_ms, c.end_ms))
    for a, b in zip(drafts, drafts[1:]):
        if b.start_ms < a.end_ms:
            raise WorkerError(
                INSIGHT_CHAPTERS_INVALID,
                dev_detail=f"chapters overlap after boundary mapping ({a.end_ms} > {b.start_ms})",
            )
    for i, chapter in enumerate(drafts):
        chapter.index = i
    uncovered = real - used
    if uncovered:
        warnings.append(f"{len(uncovered)} segment(s) not covered by any chapter")

    return InsightResult(
        language=INSIGHT_LANG,
        short_summary=short_summary,
        detailed_summary=detailed_summary,
        takeaways=takeaways,
        chapters=drafts,
        warnings=warnings,
    )


def validate_chunk_payload(payload: dict, chunk: list[InsightSegment],
                           config: InsightConfig = DEFAULT_INSIGHT_CONFIG) -> dict:
    """Validate one intermediate chunk result for the hierarchical path."""
    if not isinstance(payload, dict):
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="chunk payload not an object")
    summary = _require_str(payload, "chunk_summary")
    if not is_mostly_persian(summary, config.min_persian_ratio):
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="chunk_summary not Persian")
    real = {s.segment_index for s in chunk}
    topics = payload.get("topics")
    if not isinstance(topics, list):
        raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail="chunk topics missing")
    validated_topics = []
    for i, topic in enumerate(topics):
        if not isinstance(topic, dict):
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"chunk topic {i} not an object")
        title = normalize_text(topic.get("title") or "")
        if not title:
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"chunk topic {i} empty title")
        refs = _valid_indexes(topic.get("segment_indexes"), real, f"chunk topic {i}")
        validated_topics.append({"title": title, "segment_indexes": refs})
    return {
        "chunk_summary": summary,
        "topics": validated_topics,
        "segment_indexes": sorted(real),
    }
