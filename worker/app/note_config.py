"""Versioned, non-secret configuration for the per-video Living Note.

Bumping NOTE_PROMPT_VERSION or NOTE_SCHEMA_VERSION changes the canonical
generation hash, so a previously generated AI note is treated as invalid and
regenerated. These MUST stay in sync with the frontend NOTE_SCHEMA_VERSION.
"""

from __future__ import annotations

from dataclasses import dataclass

# Bump when the note prompt wording changes in a way that affects output.
NOTE_PROMPT_VERSION = "note-p1"
# Bump when the persisted/validated note structure changes.
NOTE_SCHEMA_VERSION = "note-s1"

# The note synthesizer reuses the local insight/chat model — no new model load.
NOTE_PROVIDER = "local_transformers"
NOTE_MODEL = "Qwen/Qwen2.5-1.5B-Instruct"

NOTE_LANG = "fa"


@dataclass(frozen=True)
class NoteConfig:
    # Adaptive output bounds (validation guards, not forced quotas).
    max_key_points: int = 8
    max_action_items: int = 8
    # Near-duplicate detection threshold (normalized char overlap).
    duplicate_similarity: float = 0.85
    # Persian-ness guard among alphabetic characters (Latin terms still allowed).
    min_persian_ratio: float = 0.5
    # Hard ceiling on prompt evidence characters (conservative token proxy).
    max_input_chars: int = 24000
    # Local generation limits.
    max_new_tokens: int = 700
    generation_timeout_seconds: int = 600


DEFAULT_NOTE_CONFIG = NoteConfig()
