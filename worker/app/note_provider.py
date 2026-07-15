"""Note provider abstraction + local CPU implementation.

``VideoNoteProvider`` is the same structured-JSON completion seam used for
insights and chat. The note synthesizer reuses the already-baked local Qwen
model (no new model, no API key, no external inference call); this wrapper only
re-maps provider/model failures onto the note error taxonomy so the note path
surfaces stable NOTE_* codes. Heavy imports stay lazy via the insight provider.
"""

from __future__ import annotations

from typing import Optional, Protocol

from .errors import WorkerError
from .insight_provider import LocalTransformersInsightProvider, ProviderHealth
from .note_config import DEFAULT_NOTE_CONFIG, NOTE_MODEL, NOTE_PROVIDER

_INSIGHT_TO_NOTE = {
    "INSIGHT_MODEL_LOAD_FAILED": "NOTE_PROVIDER_UNAVAILABLE",
    "INSIGHT_PROVIDER_UNAVAILABLE": "NOTE_PROVIDER_UNAVAILABLE",
    "INSIGHT_INVALID_OUTPUT": "NOTE_INVALID_OUTPUT",
}


class VideoNoteProvider(Protocol):
    name: str
    model_id: str

    def complete_json(self, system: str, user: str, correction: Optional[str] = None) -> dict: ...
    def health_check(self) -> ProviderHealth: ...


class LocalTransformersNoteProvider:
    """Wraps the local insight model, re-mapping failures to NOTE_* codes."""

    name = NOTE_PROVIDER

    def __init__(self, model_id: str = NOTE_MODEL, download_root: Optional[str] = "/models",
                 max_new_tokens: int = DEFAULT_NOTE_CONFIG.max_new_tokens):
        self.model_id = model_id
        self._inner = LocalTransformersInsightProvider(
            model_id=model_id, download_root=download_root, max_new_tokens=max_new_tokens)

    def _remap(self, err: WorkerError) -> WorkerError:
        mapped = _INSIGHT_TO_NOTE.get(err.code)
        if not mapped:
            return err
        return WorkerError(mapped, dev_detail=err.dev_detail, retryable=err.retryable)

    def complete_json(self, system: str, user: str, correction: Optional[str] = None) -> dict:
        try:
            return self._inner.complete_json(system, user, correction)
        except WorkerError as err:
            raise self._remap(err) from None

    def health_check(self) -> ProviderHealth:
        try:
            health = self._inner.health_check()
            return ProviderHealth(ok=health.ok, detail=health.detail)
        except WorkerError as err:
            return ProviderHealth(ok=False, detail=self._remap(err).code)
