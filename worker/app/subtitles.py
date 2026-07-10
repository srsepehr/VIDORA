"""Deterministic Persian subtitle builder.

Pure, dependency-free (no torch/whisper/transformers/numpy). Converts persisted
Persian transcript segments into ordered subtitle cues and serializes them to
WebVTT and SRT. Same input + same BUILDER_VERSION -> byte-identical output and
the same canonical content hash. The persisted transcript is never mutated.

Used by both the worker pipeline (future jobs) and the one-time backfill, so
there is a single implementation.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from typing import Optional

from .errors import (
    WorkerError,
    SUBTITLE_TRANSCRIPT_MISSING,
    SUBTITLE_TRANSLATION_INCOMPLETE,
    SUBTITLE_TIMESTAMP_INVALID,
    SUBTITLE_NO_CUES,
    SUBTITLE_VALIDATION_FAILED,
)
from .subtitle_config import (
    BUILDER_VERSION,
    CueConfig,
    DEFAULT_CUE_CONFIG,
    SENTENCE_BOUNDARIES,
    CLAUSE_BOUNDARIES,
    SUBTITLE_LANG,
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class SourceSegment:
    segment_index: int
    start_ms: int
    end_ms: int
    translated_text_fa: str


@dataclass
class Cue:
    index: int              # 1-based sequential
    start_ms: int
    end_ms: int
    text: str               # may contain a single "\n" for a 2nd line
    source_indexes: list[int] = field(default_factory=list)

    @property
    def duration_ms(self) -> int:
        return self.end_ms - self.start_ms


@dataclass
class BuildResult:
    cues: list[Cue]
    warnings: list[str]
    source_segment_count: int
    content_hash: str
    builder_version: str


# ---------------------------------------------------------------------------
# Text normalization / layout
# ---------------------------------------------------------------------------

_WS = re.compile(r"[ \t ]+")
_MULTINEWLINE = re.compile(r"\n{2,}")


def normalize_text(text: str) -> str:
    """Formatting-only normalization: trim, collapse runs of spaces, drop empty
    lines, unify newlines. The semantic Persian translation is never changed."""
    if text is None:
        return ""
    unified = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [_WS.sub(" ", line).strip() for line in unified.split("\n")]
    lines = [line for line in lines if line]
    return "\n".join(lines).strip()


def _flatten(text: str) -> str:
    return _WS.sub(" ", text.replace("\n", " ")).strip()


def wrap_two_lines(text: str, max_chars_per_line: int) -> str:
    """Wrap a single cue's text into at most two balanced lines, breaking only
    at whitespace (never mid-word). A word longer than the limit is kept whole."""
    flat = _flatten(text)
    if len(flat) <= max_chars_per_line:
        return flat
    words = flat.split(" ")
    # Find the split index that best balances the two lines while keeping the
    # first line within the limit.
    best_idx = None
    best_diff = None
    for i in range(1, len(words)):
        first = " ".join(words[:i])
        second = " ".join(words[i:])
        if len(first) > max_chars_per_line:
            break
        diff = abs(len(first) - len(second))
        if best_diff is None or diff < best_diff:
            best_diff = diff
            best_idx = i
    if best_idx is None:
        return flat  # single over-long word; cannot break
    return f"{' '.join(words[:best_idx])}\n{' '.join(words[best_idx:])}"


def _split_sentences(text: str) -> list[str]:
    out, buf = [], []
    for ch in text:
        buf.append(ch)
        if ch in SENTENCE_BOUNDARIES:
            token = "".join(buf).strip()
            if token:
                out.append(token)
            buf = []
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out or ([text.strip()] if text.strip() else [])


def _split_on_chars(text: str, boundary_chars: str) -> list[str]:
    out, buf = [], []
    for ch in text:
        buf.append(ch)
        if ch in boundary_chars:
            token = "".join(buf).strip()
            if token:
                out.append(token)
            buf = []
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def _split_words(text: str, limit: int) -> list[str]:
    words = text.split(" ")
    chunks, cur = [], ""
    for w in words:
        candidate = f"{cur} {w}".strip()
        if cur and len(candidate) > limit:
            chunks.append(cur)
            cur = w
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return chunks


def split_long_text(text: str, max_chars_per_cue: int) -> list[str]:
    """Split text that cannot fit one cue into ordered chunks, each <=
    max_chars_per_cue, preferring sentence -> clause -> word boundaries. Never
    splits inside a word. Preserves all text and order."""
    flat = _flatten(text)
    if len(flat) <= max_chars_per_cue:
        return [flat]

    units = _split_sentences(flat)
    # Ensure no unit exceeds the limit by falling back to clause, then words.
    normalized_units: list[str] = []
    for unit in units:
        if len(unit) <= max_chars_per_cue:
            normalized_units.append(unit)
            continue
        for clause in _split_on_chars(unit, CLAUSE_BOUNDARIES) or [unit]:
            if len(clause) <= max_chars_per_cue:
                normalized_units.append(clause)
            else:
                normalized_units.extend(_split_words(clause, max_chars_per_cue))

    # Greedily pack units into chunks under the limit.
    chunks, cur = [], ""
    for unit in normalized_units:
        candidate = f"{cur} {unit}".strip()
        if cur and len(candidate) > max_chars_per_cue:
            chunks.append(cur)
            cur = unit
        else:
            cur = candidate
    if cur:
        chunks.append(cur)
    return chunks or [flat]


# ---------------------------------------------------------------------------
# Timestamp validation / repair
# ---------------------------------------------------------------------------

def _coerce_int_ms(value) -> int:
    try:
        if isinstance(value, bool):
            raise ValueError("bool")
        return int(round(float(value)))
    except (TypeError, ValueError):
        raise WorkerError(SUBTITLE_TIMESTAMP_INVALID, dev_detail=f"non-numeric timestamp {value!r}")


def _prepare_segments(segments: list[SourceSegment], video_duration_ms: Optional[int],
                      config: CueConfig) -> tuple[list[SourceSegment], list[str]]:
    warnings: list[str] = []
    if not segments:
        raise WorkerError(SUBTITLE_TRANSCRIPT_MISSING, dev_detail="no segments")

    prepared: list[SourceSegment] = []
    for seg in segments:
        text = normalize_text(seg.translated_text_fa)
        if not text:
            raise WorkerError(
                SUBTITLE_TRANSLATION_INCOMPLETE,
                dev_detail=f"segment {seg.segment_index} has no Persian translation",
            )
        start = _coerce_int_ms(seg.start_ms)
        end = _coerce_int_ms(seg.end_ms)
        if start < 0:
            start = 0
        if video_duration_ms is not None:
            start = min(start, video_duration_ms)
            end = min(end, video_duration_ms)
        prepared.append(SourceSegment(seg.segment_index, start, end, text))

    prepared.sort(key=lambda s: (s.start_ms, s.end_ms, s.segment_index))

    # Overlap prevention + zero-length repair, forward pass.
    for i, seg in enumerate(prepared):
        if seg.end_ms - seg.start_ms <= config.epsilon_ms:
            # Try to extend to the next start (or a minimal readable length),
            # clamped to duration. Ambiguous zero-length with no room fails.
            next_start = prepared[i + 1].start_ms if i + 1 < len(prepared) else None
            ceiling = min(x for x in [next_start, video_duration_ms] if x is not None) if (next_start is not None or video_duration_ms is not None) else seg.start_ms + config.min_cue_ms
            target = min(seg.start_ms + config.min_cue_ms, ceiling)
            if target <= seg.start_ms:
                raise WorkerError(
                    SUBTITLE_TIMESTAMP_INVALID,
                    dev_detail=f"segment {seg.segment_index} has non-positive duration and no room to repair",
                )
            seg.end_ms = target
        if i + 1 < len(prepared):
            nxt = prepared[i + 1]
            if seg.end_ms > nxt.start_ms:  # overlap -> shorten current
                clamped = nxt.start_ms - config.min_gap_ms
                if clamped <= seg.start_ms:
                    raise WorkerError(
                        SUBTITLE_TIMESTAMP_INVALID,
                        dev_detail=f"unrepairable overlap at segment {seg.segment_index}",
                    )
                seg.end_ms = clamped
    return prepared, warnings


# ---------------------------------------------------------------------------
# Merge / split passes
# ---------------------------------------------------------------------------

def _can_merge(a: SourceSegment, b: SourceSegment, config: CueConfig) -> bool:
    # Only merge genuinely short fragments; normal segments stay one-cue-each so
    # unrelated statements are never fused just to reduce cue count.
    if (a.end_ms - a.start_ms) >= config.min_cue_ms or (b.end_ms - b.start_ms) >= config.min_cue_ms:
        return False
    if b.start_ms < a.end_ms:  # overlap
        return False
    if b.start_ms - a.end_ms > config.merge_gap_ms:
        return False
    if b.end_ms - a.start_ms > config.merge_max_ms:
        return False
    combined = f"{a.translated_text_fa} {b.translated_text_fa}".strip()
    if len(_flatten(combined)) > config.max_chars_per_cue:
        return False
    # Do not merge across a strong sentence boundary (misleading).
    if a.translated_text_fa.rstrip() and a.translated_text_fa.rstrip()[-1] in SENTENCE_BOUNDARIES:
        return False
    return True


def _merge_fragments(segments: list[SourceSegment], config: CueConfig) -> list[SourceSegment]:
    merged: list[SourceSegment] = []
    sources: list[list[int]] = []
    for seg in segments:
        if merged and _can_merge(merged[-1], seg, config):
            prev = merged[-1]
            prev.end_ms = seg.end_ms
            prev.translated_text_fa = f"{prev.translated_text_fa} {seg.translated_text_fa}".strip()
            sources[-1].append(seg.segment_index)
        else:
            merged.append(SourceSegment(seg.segment_index, seg.start_ms, seg.end_ms, seg.translated_text_fa))
            sources.append([seg.segment_index])
    for seg, src in zip(merged, sources):
        seg._sources = src  # type: ignore[attr-defined]
    return merged


def _split_segment_to_cues(seg: SourceSegment, config: CueConfig) -> list[Cue]:
    chunks = split_long_text(seg.translated_text_fa, config.max_chars_per_cue)
    sources = getattr(seg, "_sources", [seg.segment_index])
    if len(chunks) == 1:
        return [Cue(0, seg.start_ms, seg.end_ms, wrap_two_lines(chunks[0], config.max_chars_per_line), list(sources))]

    total_chars = sum(len(c) for c in chunks) or 1
    total_dur = seg.end_ms - seg.start_ms
    cues: list[Cue] = []
    cursor = seg.start_ms
    for i, chunk in enumerate(chunks):
        if i == len(chunks) - 1:
            end = seg.end_ms
        else:
            end = cursor + max(1, round(total_dur * (len(chunk) / total_chars)))
            end = min(end, seg.end_ms - (len(chunks) - 1 - i))  # leave >=1ms per remaining cue
        if end <= cursor:
            end = cursor + 1
        cues.append(Cue(0, cursor, end, wrap_two_lines(chunk, config.max_chars_per_line), list(sources)))
        cursor = end
    return cues


# ---------------------------------------------------------------------------
# Public builder
# ---------------------------------------------------------------------------

def build_cues(segments: list[SourceSegment], video_duration_ms: Optional[int] = None,
               config: CueConfig = DEFAULT_CUE_CONFIG) -> tuple[list[Cue], list[str]]:
    prepared, warnings = _prepare_segments(segments, video_duration_ms, config)
    merged = _merge_fragments(prepared, config)

    cues: list[Cue] = []
    for seg in merged:
        cues.extend(_split_segment_to_cues(seg, config))

    # Renumber and gather reading warnings.
    for i, cue in enumerate(cues, start=1):
        cue.index = i
        chars = len(_flatten(cue.text))
        secs = cue.duration_ms / 1000.0
        if secs > 0 and chars / secs > config.max_chars_per_second:
            warnings.append(f"cue {i}: reading speed {chars/secs:.1f} cps exceeds {config.max_chars_per_second}")
        if cue.duration_ms < config.min_cue_ms:
            warnings.append(f"cue {i}: duration {cue.duration_ms}ms below comfortable minimum")
        if cue.text.count("\n") + 1 > config.max_lines:
            warnings.append(f"cue {i}: exceeds {config.max_lines} lines")

    if not cues:
        raise WorkerError(SUBTITLE_NO_CUES, dev_detail="builder produced no cues")
    validate_cues(cues, video_duration_ms, config)
    return cues, warnings


def canonical_input(video_id: str, segments: list[SourceSegment], target_lang: str = SUBTITLE_LANG,
                    builder_version: str = BUILDER_VERSION) -> str:
    """Stable canonical representation for hashing. Based on the INPUT transcript
    (ordered indexes, timings, normalized Persian text) + target language +
    builder version — so any change forces a new hash."""
    ordered = sorted(segments, key=lambda s: (s.segment_index, s.start_ms))
    payload = {
        "video_id": video_id,
        "target_lang": target_lang,
        "builder_version": builder_version,
        "segments": [
            {"i": s.segment_index, "s": _coerce_int_ms(s.start_ms), "e": _coerce_int_ms(s.end_ms),
             "t": normalize_text(s.translated_text_fa)}
            for s in ordered
        ],
    }
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def content_hash(video_id: str, segments: list[SourceSegment], target_lang: str = SUBTITLE_LANG,
                 builder_version: str = BUILDER_VERSION) -> str:
    canonical = canonical_input(video_id, segments, target_lang, builder_version)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Timestamp formatting + serialization
# ---------------------------------------------------------------------------

def _hhmmssmmm(ms: int, sep: str) -> str:
    ms = max(0, int(ms))
    hours, rem = divmod(ms, 3600_000)
    minutes, rem = divmod(rem, 60_000)
    seconds, millis = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d}{sep}{millis:03d}"


def format_vtt_timestamp(ms: int) -> str:
    return _hhmmssmmm(ms, ".")


def format_srt_timestamp(ms: int) -> str:
    return _hhmmssmmm(ms, ",")


def _escape_vtt_text(text: str) -> str:
    # Escape characters that WebVTT would treat as markup. Persian punctuation
    # is preserved as-is.
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def to_vtt(cues: list[Cue]) -> str:
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.append(str(cue.index))
        lines.append(f"{format_vtt_timestamp(cue.start_ms)} --> {format_vtt_timestamp(cue.end_ms)}")
        lines.append(_escape_vtt_text(cue.text))
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def to_srt(cues: list[Cue]) -> str:
    lines: list[str] = []
    for cue in cues:
        lines.append(str(cue.index))
        lines.append(f"{format_srt_timestamp(cue.start_ms)} --> {format_srt_timestamp(cue.end_ms)}")
        lines.append(cue.text)  # SRT is plain text; no markup escaping
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


# ---------------------------------------------------------------------------
# Validation + round-trip parsers
# ---------------------------------------------------------------------------

def validate_cues(cues: list[Cue], video_duration_ms: Optional[int], config: CueConfig = DEFAULT_CUE_CONFIG) -> None:
    if not cues:
        raise WorkerError(SUBTITLE_NO_CUES, dev_detail="empty cue list")
    previous_end = -1
    for i, cue in enumerate(cues, start=1):
        if cue.index != i:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue numbering gap at {i}")
        if not isinstance(cue.start_ms, int) or not isinstance(cue.end_ms, int):
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} non-integer timing")
        if cue.start_ms < 0 or cue.end_ms <= cue.start_ms:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} non-positive duration")
        if cue.end_ms - cue.start_ms < config.min_valid_cue_ms:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} shorter than min valid")
        if cue.start_ms < previous_end:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} overlaps previous")
        if not cue.text.strip():
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} empty text")
        if cue.text.count("\n") + 1 > config.max_lines:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} too many lines")
        if video_duration_ms is not None and cue.end_ms > video_duration_ms + config.epsilon_ms:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail=f"cue {i} beyond video duration")
        previous_end = cue.end_ms


_TS_VTT = re.compile(r"(\d{2}):(\d{2}):(\d{2})\.(\d{3})")
_TS_SRT = re.compile(r"(\d{2}):(\d{2}):(\d{2}),(\d{3})")


def _parse_ts(match) -> int:
    h, m, s, ms = (int(g) for g in match.groups())
    return ((h * 60 + m) * 60 + s) * 1000 + ms


def parse_vtt(text: str) -> list[Cue]:
    if not text.startswith("WEBVTT"):
        raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail="VTT missing header")
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[Cue] = []
    for block in blocks[1:]:  # skip header block
        rows = [r for r in block.split("\n") if r.strip()]
        if not rows:
            continue
        idx = 0
        index_val = len(cues) + 1
        if "-->" not in rows[0]:
            index_val = int(rows[0].strip())
            idx = 1
        m1 = _TS_VTT.search(rows[idx])
        arrow_parts = rows[idx].split("-->")
        m2 = _TS_VTT.search(arrow_parts[1]) if len(arrow_parts) > 1 else None
        if not m1 or not m2:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail="VTT bad timestamp line")
        body = "\n".join(rows[idx + 1:])
        cues.append(Cue(index_val, _parse_ts(m1), _parse_ts(m2), body))
    return cues


def parse_srt(text: str) -> list[Cue]:
    blocks = re.split(r"\n\s*\n", text.strip())
    cues: list[Cue] = []
    for block in blocks:
        rows = [r for r in block.split("\n") if r.strip()]
        if len(rows) < 2:
            continue
        index_val = int(rows[0].strip())
        m1 = _TS_SRT.search(rows[1])
        arrow_parts = rows[1].split("-->")
        m2 = _TS_SRT.search(arrow_parts[1]) if len(arrow_parts) > 1 else None
        if not m1 or not m2:
            raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail="SRT bad timestamp line")
        body = "\n".join(rows[2:])
        cues.append(Cue(index_val, _parse_ts(m1), _parse_ts(m2), body))
    return cues


def build_artifacts(video_id: str, segments: list[SourceSegment], video_duration_ms: Optional[int] = None,
                    config: CueConfig = DEFAULT_CUE_CONFIG) -> tuple[BuildResult, str, str]:
    """One call producing everything: cues, hash, VTT and SRT strings."""
    cues, warnings = build_cues(segments, video_duration_ms, config)
    vtt = to_vtt(cues)
    srt = to_srt(cues)
    # Round-trip guard: serialized output must parse back to identical timing.
    if [(c.start_ms, c.end_ms) for c in parse_vtt(vtt)] != [(c.start_ms, c.end_ms) for c in cues]:
        raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail="VTT round-trip mismatch")
    if [(c.start_ms, c.end_ms) for c in parse_srt(srt)] != [(c.start_ms, c.end_ms) for c in cues]:
        raise WorkerError(SUBTITLE_VALIDATION_FAILED, dev_detail="SRT round-trip mismatch")
    result = BuildResult(
        cues=cues, warnings=warnings, source_segment_count=len(segments),
        content_hash=content_hash(video_id, segments, SUBTITLE_LANG, BUILDER_VERSION),
        builder_version=BUILDER_VERSION,
    )
    return result, vtt, srt
