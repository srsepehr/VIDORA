"""Centralized configuration and versioning for video-insight generation.

All numeric thresholds and both content-affecting versions live here. Bumping
PROMPT_VERSION or SCHEMA_VERSION changes the canonical content hash, which
invalidates previously generated insights and triggers regeneration.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bump when the prompt wording/instructions change in a way that affects output.
PROMPT_VERSION = "ins-p2"
# Bump when the persisted/validated output structure changes.
SCHEMA_VERSION = "ins-s1"

INSIGHT_LANG = "fa"


@dataclass(frozen=True)
class InsightConfig:
    # Deterministic size accounting (chars as a conservative token proxy).
    # Inputs above this are processed hierarchically (chunk -> synthesize).
    max_direct_input_chars: int = 6000
    # Per-chunk budget for the hierarchical path; never splits a segment.
    chunk_chars: int = 4500
    # Hard ceiling: refuse absurd inputs instead of silently truncating.
    max_total_input_chars: int = 400_000

    # Adaptive output bounds (validation guards, not forced quotas).
    max_takeaways: int = 10
    max_chapters: int = 12
    # A chapter may never contain zero segments and count can't exceed segments.
    # Near-duplicate takeaway detection threshold (normalized char overlap).
    duplicate_similarity: float = 0.85

    # Persian-ness guard: among alphabetic characters, at least this fraction
    # must be Arabic-script (Persian). Latin technical terms remain allowed.
    min_persian_ratio: float = 0.5

    # Generation limits for the local model.
    max_new_tokens: int = 900
    generation_timeout_seconds: int = 600


DEFAULT_INSIGHT_CONFIG = InsightConfig()
