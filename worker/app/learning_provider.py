"""Learning provider abstractions + local CPU implementation.

``VideoLearningProfileProvider`` (assessment) and ``VideoLearningSetProvider``
(generation) are the same structured-JSON completion seam used by insights,
chat, and notes. Both reuse the already-baked local Qwen model — no new model,
no API key, no external inference call; this wrapper only re-maps provider or
model failures onto the learning taxonomy so the learning paths surface stable
LEARNING_* codes. Heavy imports stay lazy via the insight provider.
"""

from __future__ import annotations

from typing import Optional, Protocol

from .errors import WorkerError
from .insight_provider import LocalTransformersInsightProvider, ProviderHealth
from .learning_config import DEFAULT_LEARNING_CONFIG, LEARNING_MODEL, LEARNING_PROVIDER

_INSIGHT_TO_LEARNING = {
    "INSIGHT_MODEL_LOAD_FAILED": "LEARNING_PROVIDER_UNAVAILABLE",
    "INSIGHT_PROVIDER_UNAVAILABLE": "LEARNING_PROVIDER_UNAVAILABLE",
    "INSIGHT_INVALID_OUTPUT": "LEARNING_INVALID_OUTPUT",
}


class VideoLearningProfileProvider(Protocol):
    name: str
    model_id: str

    def complete_json(self, system: str, user: str, correction: Optional[str] = None) -> dict: ...
    def health_check(self) -> ProviderHealth: ...


# Generation shares the same seam; a separate alias keeps the two provider
# responsibilities distinct at call sites and in future implementations.
VideoLearningSetProvider = VideoLearningProfileProvider


class LocalTransformersLearningProvider:
    """Wraps the local model, re-mapping failures to LEARNING_* codes."""

    name = LEARNING_PROVIDER

    def __init__(self, model_id: str = LEARNING_MODEL, download_root: Optional[str] = "/models",
                 max_new_tokens: int = DEFAULT_LEARNING_CONFIG.max_new_tokens_generate):
        self.model_id = model_id
        self._inner = LocalTransformersInsightProvider(
            model_id=model_id, download_root=download_root, max_new_tokens=max_new_tokens)

    def _remap(self, err: WorkerError) -> WorkerError:
        mapped = _INSIGHT_TO_LEARNING.get(err.code)
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
