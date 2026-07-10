"""Centralized subtitle cue thresholds and builder version.

All numeric constants that shape cue timing and layout live here (never
scattered as magic numbers). Bumping BUILDER_VERSION changes the canonical
content hash, so a builder change forces regeneration of artifacts.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bump when the builder's output for the same input would change.
BUILDER_VERSION = "sub-v1"

# HTML <track> / metadata language for Persian playback. NOT the NLLB code
# (pes_Arab) — browsers expect a BCP-47 tag.
SUBTITLE_LANG = "fa"
SUBTITLE_LABEL = "فارسی"


@dataclass(frozen=True)
class CueConfig:
    max_lines: int = 2
    # Persian subtitle line length target (characters per line).
    max_chars_per_line: int = 42
    # Reading comfort bounds.
    min_cue_ms: int = 1000
    max_cue_ms: int = 7000
    # Target maximum reading speed (characters per second). Violations produce a
    # warning, never text deletion.
    max_chars_per_second: float = 21.0
    # Adjacent fragments closer than this gap may be merged.
    merge_gap_ms: int = 240
    # A merged cue must not exceed this duration.
    merge_max_ms: int = 6000
    # Minimum separation kept between cues to guarantee no overlap.
    min_gap_ms: int = 1
    # Any single cue shorter than this after timing is a hard defect.
    min_valid_cue_ms: int = 40
    # Tiny float slop (ms) tolerated/trimmed when comparing timestamps.
    epsilon_ms: int = 2

    @property
    def max_chars_per_cue(self) -> int:
        return self.max_lines * self.max_chars_per_line


DEFAULT_CUE_CONFIG = CueConfig()

# Persian sentence/clause boundary characters, preferred split points in order.
SENTENCE_BOUNDARIES = "؟?!.…"
CLAUSE_BOUNDARIES = "،؛:;,"
