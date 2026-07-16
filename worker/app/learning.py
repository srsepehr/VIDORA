"""Pure, deterministic logic for adaptive learning tools.

Two separated responsibilities, both grounded in the persisted transcript:

1. ASSESSMENT — decide whether a video is suitable for content practice,
   language practice, both, or neither. Deterministic guards run BEFORE and
   AFTER the model: incomplete/short transcripts are classified without any
   model call, and the model's self-reported suitability is clamped by real
   evidence (grounded teachable points, actual source-language volume). The
   final recommended mode is DERIVED from the clamped suitabilities — never
   taken from the model's own recommendation.

2. GENERATION — validate a structured flashcard/quiz payload: strict schema,
   grounding to real transcript segments (citation spans are computed here
   from real boundaries, never from model numbers), language items must quote
   phrases that actually appear in the source transcript, MCQ answers must be
   unique and unambiguous, near-duplicates are dropped, and item counts adapt
   to the material with ceilings but never minimum quotas. Zero items is an
   honest, valid outcome ("none" mode) — fabricating filler is a failure.

This module has no I/O and no heavy imports; orchestration lives in
learning_service.py.
"""

from __future__ import annotations

import difflib
import hashlib
import json
import re
from dataclasses import dataclass, field

from .errors import WorkerError
from .insights import is_mostly_persian, normalize_text
from .learning_config import (
    ASSESS_PROMPT_VERSION, ASSESS_SCHEMA_VERSION, CONTENT_KINDS,
    DEFAULT_LEARNING_CONFIG, GEN_PROMPT_VERSION, GEN_SCHEMA_VERSION,
    LEARNING_MODEL, LEARNING_PROVIDER, MODES, REASON_CODES, SUITABILITIES,
    LearningConfig,
)


@dataclass(frozen=True)
class LearningSegment:
    segment_index: int
    start_ms: int
    end_ms: int
    text_fa: str
    source_text: str


@dataclass(frozen=True)
class TranscriptStats:
    total_segments: int
    translated_segments: int
    fa_chars: int
    source_chars: int
    duration_ms: int

    @property
    def translation_ratio(self) -> float:
        return self.translated_segments / self.total_segments if self.total_segments else 0.0


@dataclass
class AssessmentResult:
    recommended_mode: str
    content_kind: str
    content_suitability: str
    language_suitability: str
    reason_code: str
    teachable_points: list[dict]
    source: str  # 'model' | 'deterministic'
    warnings: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class LearningItem:
    item_index: int
    item_type: str          # flashcard | multiple_choice
    learning_mode: str      # content | language
    front_text: str | None
    back_text: str | None
    question_text: str | None
    choices: list[str] | None
    correct_choice_index: int | None
    explanation: str | None
    segment_indexes: list[int]
    start_ms: int | None
    end_ms: int | None


@dataclass
class LearningSetResult:
    mode: str
    items: list[LearningItem]
    warnings: list[str] = field(default_factory=list)

    @property
    def flashcard_count(self) -> int:
        return sum(1 for i in self.items if i.item_type == "flashcard")

    @property
    def quiz_count(self) -> int:
        return sum(1 for i in self.items if i.item_type == "multiple_choice")


# ---------------------------------------------------------------------------
# Transcript preparation (tolerant: reports completeness instead of raising)
# ---------------------------------------------------------------------------

def prepare_learning_segments(rows: list[dict]) -> tuple[list[LearningSegment], TranscriptStats]:
    if not rows:
        raise WorkerError("LEARNING_TRANSCRIPT_MISSING", dev_detail="no transcript rows")
    segments: list[LearningSegment] = []
    translated = 0
    for row in rows:
        try:
            index = int(row["segment_index"])
            start = int(row["start_ms"])
            end = int(row["end_ms"])
        except (KeyError, TypeError, ValueError):
            continue
        if end <= start or start < 0:
            continue
        fa = normalize_text(row.get("translated_text_fa") or "")
        source = normalize_text(row.get("source_text") or "")
        if fa:
            translated += 1
        segments.append(LearningSegment(index, start, end, fa, source))
    if not segments:
        raise WorkerError("LEARNING_TRANSCRIPT_MISSING", dev_detail="no valid transcript rows")
    segments.sort(key=lambda s: (s.start_ms, s.segment_index))
    stats = TranscriptStats(
        total_segments=len(segments),
        translated_segments=translated,
        fa_chars=sum(len(s.text_fa) for s in segments),
        source_chars=sum(len(s.source_text) for s in segments),
        duration_ms=max(s.end_ms for s in segments),
    )
    return segments, stats


# ---------------------------------------------------------------------------
# Deterministic pre-assessment (classified states without a model call)
# ---------------------------------------------------------------------------

def deterministic_preassessment(stats: TranscriptStats,
                                config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> AssessmentResult | None:
    """Classify videos the transcript alone already decides. Returns None when
    the model is genuinely needed."""
    if stats.translation_ratio < config.min_translation_ratio:
        return AssessmentResult(
            recommended_mode="none", content_kind="mixed",
            content_suitability="none", language_suitability="none",
            reason_code="INCOMPLETE_TRANSCRIPT", teachable_points=[],
            source="deterministic",
            warnings=[f"translation ratio {stats.translation_ratio:.2f} below threshold"])
    if stats.fa_chars < config.min_fa_chars:
        return AssessmentResult(
            recommended_mode="none", content_kind="mixed",
            content_suitability="none", language_suitability="none",
            reason_code="TOO_SHORT", teachable_points=[], source="deterministic",
            warnings=[f"fa chars {stats.fa_chars} below threshold"])
    return None


# ---------------------------------------------------------------------------
# Canonical hashes (idempotency)
# ---------------------------------------------------------------------------

def assessment_hash(video_id: str, segments: list[LearningSegment], *,
                    provider: str = LEARNING_PROVIDER, model: str = LEARNING_MODEL,
                    prompt_version: str = ASSESS_PROMPT_VERSION,
                    schema_version: str = ASSESS_SCHEMA_VERSION) -> str:
    payload = {
        "video_id": video_id, "provider": provider, "model": model,
        "prompt_version": prompt_version, "schema_version": schema_version,
        "segments": [{"i": s.segment_index, "s": s.start_ms, "e": s.end_ms,
                      "fa": s.text_fa, "src": s.source_text} for s in segments],
    }
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def generation_hash(assess_hash: str, mode: str, *,
                    provider: str = LEARNING_PROVIDER, model: str = LEARNING_MODEL,
                    prompt_version: str = GEN_PROMPT_VERSION,
                    schema_version: str = GEN_SCHEMA_VERSION) -> str:
    payload = {
        "assessment_hash": assess_hash, "mode": mode, "provider": provider,
        "model": model, "prompt_version": prompt_version, "schema_version": schema_version,
    }
    return hashlib.sha256(json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# ---------------------------------------------------------------------------
# Assessment validation + deterministic clamping
# ---------------------------------------------------------------------------

_SUIT_ORDER = {"none": 0, "low": 1, "medium": 2, "high": 3}


def _clamp_suitability(value: str, ceiling: str) -> str:
    return value if _SUIT_ORDER[value] <= _SUIT_ORDER[ceiling] else ceiling


def _refs_from(raw, real: set[int]) -> list[int]:
    refs: list[int] = []
    if isinstance(raw, list):
        for item in raw:
            try:
                idx = int(item)
            except (TypeError, ValueError):
                continue
            if idx in real:
                refs.append(idx)
    return sorted(set(refs))


def derive_recommended_mode(content_suitability: str, language_suitability: str) -> str:
    """The recommendation is DERIVED from evidence-clamped suitabilities —
    'high'/'medium' recommend practice; 'low' remains user-selectable but is
    never the default recommendation."""
    content_ok = _SUIT_ORDER[content_suitability] >= _SUIT_ORDER["medium"]
    language_ok = _SUIT_ORDER[language_suitability] >= _SUIT_ORDER["medium"]
    if content_ok and language_ok:
        return "both"
    if content_ok:
        return "content"
    if language_ok:
        return "language"
    return "none"


def validate_assessment_payload(payload: dict, segments: list[LearningSegment],
                                stats: TranscriptStats,
                                config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> AssessmentResult:
    if not isinstance(payload, dict):
        raise WorkerError("LEARNING_INVALID_OUTPUT", dev_detail="assessment payload not an object")
    warnings: list[str] = []

    kind = str(payload.get("content_kind") or "").strip().lower()
    if kind not in CONTENT_KINDS:
        raise WorkerError("LEARNING_INVALID_OUTPUT", dev_detail=f"invalid content_kind {kind!r}")
    content_suit = str(payload.get("content_suitability") or "").strip().lower()
    language_suit = str(payload.get("language_suitability") or "").strip().lower()
    if content_suit not in SUITABILITIES or language_suit not in SUITABILITIES:
        raise WorkerError("LEARNING_INVALID_OUTPUT", dev_detail="invalid suitability value")

    # Ground teachable points to real segments; ungrounded points are dropped.
    real = {s.segment_index for s in segments}
    points: list[dict] = []
    for raw in payload.get("teachable_points") or []:
        if not isinstance(raw, dict):
            continue
        text = normalize_text(raw.get("text") or "")
        refs = _refs_from(raw.get("segment_indexes"), real)
        if text and refs and is_mostly_persian(text, config.min_persian_ratio):
            points.append({"text": text, "segment_indexes": refs})
        elif text:
            warnings.append("dropped ungrounded or non-Persian teachable point")

    # Deterministic clamps: the model cannot claim more than the evidence.
    if len(points) < config.min_points_for_high_content:
        clamped = _clamp_suitability(content_suit, "medium" if points else "low")
        if clamped != content_suit:
            warnings.append(f"content suitability clamped {content_suit}->{clamped} "
                            f"({len(points)} grounded points)")
            content_suit = clamped
    if stats.source_chars < config.min_source_chars_for_language:
        if language_suit != "none":
            warnings.append(f"language suitability clamped {language_suit}->none "
                            f"({stats.source_chars} source chars)")
            language_suit = "none"
    elif stats.source_chars < config.min_source_chars_for_high_language:
        clamped = _clamp_suitability(language_suit, "medium")
        if clamped != language_suit:
            warnings.append(f"language suitability clamped {language_suit}->{clamped}")
            language_suit = clamped

    # Opinion/entertainment guard: opinion content is at most medium for
    # content practice (framed as the speaker's position, never a hard fact
    # bank); pure entertainment content is at most low.
    if kind == "opinion":
        content_suit = _clamp_suitability(content_suit, "medium")
    if kind in ("entertainment", "promotional"):
        clamped = _clamp_suitability(content_suit, "low")
        if clamped != content_suit:
            warnings.append(f"content suitability clamped for {kind} content")
            content_suit = clamped

    mode = derive_recommended_mode(content_suit, language_suit)
    reason = str(payload.get("reason_code") or "").strip().upper()
    if reason not in REASON_CODES:
        reason = _default_reason(mode, kind)

    return AssessmentResult(
        recommended_mode=mode, content_kind=kind,
        content_suitability=content_suit, language_suitability=language_suit,
        reason_code=reason, teachable_points=points, source="model", warnings=warnings)


def _default_reason(mode: str, kind: str) -> str:
    if mode == "both":
        return "MEANINGFUL_CONCEPTS_AND_LANGUAGE"
    if mode == "content":
        return "MEANINGFUL_CONCEPTS"
    if mode == "language":
        return "USEFUL_LANGUAGE"
    if kind in ("entertainment", "promotional"):
        return "ENTERTAINMENT_ONLY"
    if kind == "narrative":
        return "NARRATIVE_ONLY"
    return "LOW_INFORMATION"


def supported_modes(profile: dict) -> list[str]:
    """Modes the server will accept a generation request for. The editorial
    policy overrides the automatic assessment; under 'auto', any non-'none'
    suitability keeps the mode user-selectable even when not recommended."""
    policy = (profile.get("editorial_policy") or "auto").lower()
    if policy == "disabled":
        return []
    if policy in ("content", "language", "both"):
        return {"content": ["content"], "language": ["language"],
                "both": ["content", "language", "both"]}[policy]
    modes: list[str] = []
    content_ok = (profile.get("content_suitability") or "none") != "none"
    language_ok = (profile.get("language_suitability") or "none") != "none"
    if content_ok:
        modes.append("content")
    if language_ok:
        modes.append("language")
    if content_ok and language_ok:
        modes.append("both")
    return modes


# ---------------------------------------------------------------------------
# Prompt payload builders
# ---------------------------------------------------------------------------

def build_assessment_message(segments: list[LearningSegment], stats: TranscriptStats, *,
                             title: str = "",
                             config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> str:
    lines = []
    if title:
        lines.append(f"عنوان ویدیو: {normalize_text(title)}")
    lines.append(f"مدت ویدیو: {stats.duration_ms // 1000} ثانیه — {stats.total_segments} بخش")
    lines.append("\nمتن ویدیو (شماره بخش، متن فارسی، متن اصلی):")
    used = sum(len(line) for line in lines)
    for s in segments:
        entry = f"[{s.segment_index}] فارسی: {s.text_fa}"
        if s.source_text:
            entry += f" | اصلی: {s.source_text}"
        if used + len(entry) > config.max_input_chars:
            break
        lines.append(entry)
        used += len(entry)
    return "\n".join(lines)


def build_generation_message(mode: str, segments: list[LearningSegment],
                             teachable_points: list[dict], caps: tuple[int, int], *,
                             title: str = "",
                             config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> str:
    max_cards, max_quiz = caps
    lines = []
    if title:
        lines.append(f"عنوان ویدیو: {normalize_text(title)}")
    lines.append(f"حالت تمرین: {mode}")
    lines.append(f"حداکثر فلش‌کارت: {max_cards} — حداکثر سؤال چهارگزینه‌ای: {max_quiz}")
    lines.append("تعداد را با محتوای واقعی تنظیم کن؛ کمتر بهتر از تکراری یا سطحی است.")
    if teachable_points:
        lines.append("\nنکات قابل یادگیری شناسایی‌شده:")
        for point in teachable_points:
            lines.append(f"- {point['text']} [بخش‌ها: {point['segment_indexes']}]")
    lines.append("\nمتن ویدیو (شماره بخش، متن فارسی، متن اصلی):")
    used = sum(len(line) for line in lines)
    for s in segments:
        entry = f"[{s.segment_index}] فارسی: {s.text_fa}"
        if s.source_text:
            entry += f" | اصلی: {s.source_text}"
        if used + len(entry) > config.max_input_chars:
            break
        lines.append(entry)
        used += len(entry)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Adaptive item-count ceilings
# ---------------------------------------------------------------------------

def scaled_caps(stats: TranscriptStats,
                config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> tuple[int, int]:
    """(max_flashcards, max_quiz) ceilings scaled to real material size.
    Ceilings only — a valid set may be far smaller, and never padded."""
    if stats.fa_chars < config.short_fa_chars:
        return config.short_max_flashcards, config.short_max_quiz
    return config.max_flashcards, config.max_quiz


# ---------------------------------------------------------------------------
# Learning-set validation (strict, grounded, deduplicated, adaptive)
# ---------------------------------------------------------------------------

_LATIN = re.compile(r"[A-Za-z]")
_ALL_OF_THE_ABOVE = ("all of the above", "همه موارد", "همه گزینه‌ها", "هیچ‌کدام", "none of the above")


def _norm_for_similarity(text: str) -> str:
    return normalize_text(text).replace("ي", "ی").replace("ك", "ک").replace("‌", " ").lower()


def _near_duplicate(text: str, kept: list[str], threshold: float) -> bool:
    norm = _norm_for_similarity(text)
    return any(norm == other or difflib.SequenceMatcher(None, norm, other).ratio() >= threshold
               for other in kept)


def _span_for(refs: list[int], segment_map: dict[int, LearningSegment]) -> tuple[int | None, int | None]:
    valid = [r for r in refs if r in segment_map]
    if not valid:
        return None, None
    return (min(segment_map[r].start_ms for r in valid),
            max(segment_map[r].end_ms for r in valid))


def _phrase_in_source(front: str, refs: list[int], segment_map: dict[int, LearningSegment]) -> bool:
    """Language items must quote language that actually appears in the video."""
    needle = re.sub(r"\s+", " ", front).strip().lower()
    if not needle:
        return False
    haystack = " ".join(segment_map[r].source_text for r in refs if r in segment_map)
    return needle in re.sub(r"\s+", " ", haystack).lower()


def validate_learning_set_payload(payload: dict, mode: str, segments: list[LearningSegment],
                                  stats: TranscriptStats,
                                  config: LearningConfig = DEFAULT_LEARNING_CONFIG) -> LearningSetResult:
    if not isinstance(payload, dict):
        raise WorkerError("LEARNING_INVALID_OUTPUT", dev_detail="set payload not an object")
    if mode not in MODES:
        raise WorkerError("LEARNING_MODE_UNSUPPORTED", dev_detail=f"mode {mode!r}")
    segment_map = {s.segment_index: s for s in segments}
    real = set(segment_map)
    max_cards, max_quiz = scaled_caps(stats, config)
    warnings: list[str] = []
    items: list[LearningItem] = []
    kept_front_norms: list[str] = []
    kept_question_norms: list[str] = []

    allowed_item_modes = {"content": ("content",), "language": ("language",),
                          "both": ("content", "language")}[mode]

    # --- flashcards -----------------------------------------------------------
    for raw in payload.get("flashcards") or []:
        if sum(1 for i in items if i.item_type == "flashcard") >= max_cards:
            warnings.append("flashcard ceiling reached; extra cards dropped")
            break
        if not isinstance(raw, dict):
            continue
        item_mode = str(raw.get("learning_mode") or ("language" if mode == "language" else "content")).lower()
        if item_mode not in allowed_item_modes:
            warnings.append(f"dropped flashcard with mode {item_mode!r} outside {mode!r}")
            continue
        front = normalize_text(raw.get("front") or raw.get("front_text") or "")
        back = normalize_text(raw.get("back") or raw.get("back_text") or "")
        refs = _refs_from(raw.get("segment_indexes"), real)
        if not front or not back:
            warnings.append("dropped flashcard with empty side")
            continue
        if not refs:
            warnings.append("dropped ungrounded flashcard")
            continue
        # Backs are Persian-facing in every mode; content fronts are Persian,
        # language fronts must quote real source-language text from the cited
        # segments (vocabulary is never invented).
        if not is_mostly_persian(back, config.min_persian_ratio):
            warnings.append("dropped flashcard with non-Persian back")
            continue
        if item_mode == "content" and not is_mostly_persian(front, config.min_persian_ratio):
            warnings.append("dropped content flashcard with non-Persian front")
            continue
        if item_mode == "language":
            if not _LATIN.search(front):
                warnings.append("dropped language flashcard without source-language front")
                continue
            if not _phrase_in_source(front, refs, segment_map):
                warnings.append("dropped language flashcard whose phrase is not in the transcript")
                continue
        if _near_duplicate(front, kept_front_norms, config.duplicate_similarity):
            warnings.append("dropped near-duplicate flashcard")
            continue
        start_ms, end_ms = _span_for(refs, segment_map)
        items.append(LearningItem(
            item_index=len(items), item_type="flashcard", learning_mode=item_mode,
            front_text=front, back_text=back, question_text=None, choices=None,
            correct_choice_index=None, explanation=None,
            segment_indexes=refs, start_ms=start_ms, end_ms=end_ms))
        kept_front_norms.append(_norm_for_similarity(front))

    # --- multiple-choice quiz --------------------------------------------------
    for raw in payload.get("quiz") or []:
        if sum(1 for i in items if i.item_type == "multiple_choice") >= max_quiz:
            warnings.append("quiz ceiling reached; extra questions dropped")
            break
        if not isinstance(raw, dict):
            continue
        item_mode = str(raw.get("learning_mode") or ("language" if mode == "language" else "content")).lower()
        if item_mode not in allowed_item_modes:
            warnings.append(f"dropped quiz item with mode {item_mode!r} outside {mode!r}")
            continue
        question = normalize_text(raw.get("question") or raw.get("question_text") or "")
        explanation = normalize_text(raw.get("explanation") or "")
        refs = _refs_from(raw.get("segment_indexes"), real)
        raw_choices = raw.get("choices")
        if not question or not explanation or not refs or not isinstance(raw_choices, list):
            warnings.append("dropped incomplete quiz item")
            continue
        choices = [normalize_text(str(c)) for c in raw_choices if normalize_text(str(c))]
        if not (config.min_choices <= len(choices) <= config.max_choices):
            warnings.append(f"dropped quiz item with {len(choices)} choices")
            continue
        # One uniquely correct answer: choices must be distinct and none may be
        # an "all/none of the above" catch-all.
        norms = [_norm_for_similarity(c) for c in choices]
        if len(set(norms)) != len(norms):
            warnings.append("dropped quiz item with duplicate choices")
            continue
        if any(marker in norm for norm in norms for marker in _ALL_OF_THE_ABOVE):
            warnings.append("dropped quiz item with catch-all choice")
            continue
        try:
            correct = int(raw.get("correct_choice_index"))
        except (TypeError, ValueError):
            warnings.append("dropped quiz item without a correct index")
            continue
        if not (0 <= correct < len(choices)):
            warnings.append("dropped quiz item with out-of-range correct index")
            continue
        if not is_mostly_persian(question, config.min_persian_ratio) and item_mode == "content":
            warnings.append("dropped content quiz item with non-Persian question")
            continue
        if not is_mostly_persian(explanation, config.min_persian_ratio):
            warnings.append("dropped quiz item with non-Persian explanation")
            continue
        if _near_duplicate(question, kept_question_norms, config.duplicate_similarity):
            warnings.append("dropped near-duplicate quiz question")
            continue
        start_ms, end_ms = _span_for(refs, segment_map)
        items.append(LearningItem(
            item_index=len(items), item_type="multiple_choice", learning_mode=item_mode,
            front_text=None, back_text=None, question_text=question,
            choices=choices, correct_choice_index=correct, explanation=explanation,
            segment_indexes=refs, start_ms=start_ms, end_ms=end_ms))
        kept_question_norms.append(_norm_for_similarity(question))

    if not items:
        raise WorkerError("LEARNING_INSUFFICIENT_CONTENT",
                          dev_detail="no valid grounded items after validation")
    return LearningSetResult(mode=mode, items=items, warnings=warnings)


def items_to_rpc(result: LearningSetResult) -> list[dict]:
    """Serialize items to the jsonb shape persisted by persist_video_learning_set."""
    return [
        {
            "item_index": item.item_index,
            "item_type": item.item_type,
            "learning_mode": item.learning_mode,
            "front_text": item.front_text,
            "back_text": item.back_text,
            "question_text": item.question_text,
            "choices": item.choices,
            "correct_choice_index": item.correct_choice_index,
            "explanation": item.explanation,
            "source_segment_indexes": item.segment_indexes,
            "start_ms": item.start_ms,
            "end_ms": item.end_ms,
        }
        for item in result.items
    ]


def assessment_to_rpc(result: AssessmentResult) -> dict:
    return {
        "p_recommended_mode": result.recommended_mode,
        "p_content_kind": result.content_kind,
        "p_content_suitability": result.content_suitability,
        "p_language_suitability": result.language_suitability,
        "p_reason_code": result.reason_code,
        "p_teachable_points": result.teachable_points,
        "p_assessment_source": result.source,
    }
