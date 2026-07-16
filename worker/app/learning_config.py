"""Versioned, non-secret configuration for adaptive learning tools.

Two independent version pairs exist because assessment and generation are
separate responsibilities: bumping the assessment versions invalidates stored
learning profiles; bumping the generation versions invalidates learning sets.
These MUST stay in sync with the frontend LEARNING_*_SCHEMA_VERSION guards.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

# Assessment (suitability profile).
ASSESS_PROMPT_VERSION = "lrn-a1"
ASSESS_SCHEMA_VERSION = "lrn-as1"
# Generation (flashcards + quiz).
GEN_PROMPT_VERSION = "lrn-g1"
GEN_SCHEMA_VERSION = "lrn-gs1"

# The learning tools reuse the already-baked local model — no new model load.
LEARNING_PROVIDER = "local_transformers"
LEARNING_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"

MODES = ("content", "language", "both")
SUITABILITIES = ("high", "medium", "low", "none")
CONTENT_KINDS = ("conceptual", "procedural", "factual", "opinion",
                 "narrative", "entertainment", "promotional", "mixed")
REASON_CODES = (
    "MEANINGFUL_CONCEPTS", "USEFUL_LANGUAGE", "MEANINGFUL_CONCEPTS_AND_LANGUAGE",
    "TOO_SHORT", "LOW_INFORMATION", "ENTERTAINMENT_ONLY",
    "INCOMPLETE_TRANSCRIPT", "NARRATIVE_ONLY", "PROMOTIONAL_ONLY",
)


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


@dataclass(frozen=True)
class LearningConfig:
    # --- deterministic assessment guards ------------------------------------
    # Below this fraction of translated segments the video is classified
    # (none / INCOMPLETE_TRANSCRIPT) without any model call.
    min_translation_ratio: float = 0.9
    # Below this many Persian characters the video is deterministically
    # too short for meaningful practice (none / TOO_SHORT).
    min_fa_chars: int = 60
    # 'high' content suitability requires at least this many grounded
    # teachable points; 'high' language suitability requires at least this
    # much source-language text.
    min_points_for_high_content: int = 2
    min_source_chars_for_high_language: int = 200
    min_source_chars_for_language: int = 40

    # --- adaptive item-count caps (ceilings, never quotas) -------------------
    max_flashcards: int = 8
    max_quiz: int = 7
    # Short videos get small ceilings: below short_fa_chars the caps shrink to
    # the short_* values (a 30-second clip should never yield 8 cards).
    short_fa_chars: int = 800
    short_max_flashcards: int = 3
    short_max_quiz: int = 2

    # --- multiple-choice validation ------------------------------------------
    min_choices: int = 3
    max_choices: int = 4

    # Near-duplicate detection threshold (normalized char overlap).
    duplicate_similarity: float = 0.85
    # Persian-ness guard for Persian-facing fields.
    min_persian_ratio: float = 0.45

    # --- prompt input budget --------------------------------------------------
    max_input_chars: int = 24000

    # --- generation limits ----------------------------------------------------
    max_new_tokens_assess: int = 500
    max_new_tokens_generate: int = 1100
    # Guard against rapid forced re-runs of the same video (seconds).
    min_rerun_interval_seconds: int = 20


def load_learning_config() -> LearningConfig:
    return LearningConfig(
        min_rerun_interval_seconds=_int("LEARNING_MIN_RERUN_SECONDS", 20),
        max_flashcards=_int("LEARNING_MAX_FLASHCARDS", 8),
        max_quiz=_int("LEARNING_MAX_QUIZ", 7),
    )


DEFAULT_LEARNING_CONFIG = LearningConfig()
