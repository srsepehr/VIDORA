"""Insight provider abstraction + local CPU implementation.

``VideoInsightProvider`` is a structured-JSON chat completion seam: database,
Modal, and UI code never couple to a specific model. The first implementation
runs a small open instruction model locally via transformers on CPU —
zero-cost, no API key, no external call at inference time.

Model choice (configurable via INSIGHT_MODEL): Qwen/Qwen2.5-1.5B-Instruct —
Apache-2.0, ungated (no HF token needed), multilingual including Persian, and
the smallest practical instruct model for grounded Persian summarization on
CPU. NLLB is a translation-only seq2seq model and is deliberately NOT used for
summarization. Heavy imports are lazy so unit tests and import-safety checks
never load torch/transformers.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from .errors import (
    WorkerError,
    INSIGHT_MODEL_LOAD_FAILED,
    INSIGHT_PROVIDER_UNAVAILABLE,
    INSIGHT_INVALID_OUTPUT,
)
from .insight_config import DEFAULT_INSIGHT_CONFIG
from .translation import extract_json_object  # tested JSON extraction (code-fence tolerant)

PROVIDER_NAME = "local_transformers"


@dataclass
class ProviderHealth:
    ok: bool
    detail: str = ""


class VideoInsightProvider(Protocol):
    name: str
    model_id: str

    def complete_json(self, system: str, user: str, correction: Optional[str] = None) -> dict: ...
    def health_check(self) -> ProviderHealth: ...


class LocalTransformersInsightProvider:
    """Small local instruct model on CPU (greedy decoding for stability)."""

    name = PROVIDER_NAME

    def __init__(self, model_id: str = "Qwen/Qwen2.5-1.5B-Instruct",
                 download_root: Optional[str] = "/models",
                 max_new_tokens: int = DEFAULT_INSIGHT_CONFIG.max_new_tokens):
        self.model_id = model_id
        self.download_root = download_root
        self.max_new_tokens = max_new_tokens
        self._tokenizer = None
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            from transformers import AutoModelForCausalLM, AutoTokenizer  # lazy heavy import
        except ImportError as exc:
            raise WorkerError(INSIGHT_MODEL_LOAD_FAILED, dev_detail=f"transformers import: {exc}", retryable=False)
        try:
            kwargs = {"cache_dir": self.download_root} if self.download_root else {}
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_id, **kwargs)
            self._model = AutoModelForCausalLM.from_pretrained(self.model_id, **kwargs)
            self._model.eval()
        except Exception as exc:
            raise WorkerError(INSIGHT_MODEL_LOAD_FAILED, dev_detail=f"model load: {exc}")

    def _chat(self, messages: list[dict]) -> str:
        self._ensure_model()
        try:
            import torch  # lazy

            prompt = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )
            inputs = self._tokenizer(prompt, return_tensors="pt")
            with torch.no_grad():
                output = self._model.generate(
                    **inputs,
                    max_new_tokens=self.max_new_tokens,
                    do_sample=False,
                    temperature=None,
                    top_p=None,
                    top_k=None,
                    pad_token_id=self._tokenizer.eos_token_id,
                )
            generated = output[0][inputs["input_ids"].shape[1]:]
            return self._tokenizer.decode(generated, skip_special_tokens=True)
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError(INSIGHT_PROVIDER_UNAVAILABLE, dev_detail=f"generate: {exc}")

    def complete_json(self, system: str, user: str, correction: Optional[str] = None) -> dict:
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]
        if correction:
            messages.append({"role": "user", "content": correction})
        text = self._chat(messages)
        try:
            return extract_json_object(text)
        except WorkerError as err:
            # Normalize the extraction failure onto the insight taxonomy.
            raise WorkerError(INSIGHT_INVALID_OUTPUT, dev_detail=f"json extraction: {err.dev_detail}")

    def health_check(self) -> ProviderHealth:
        try:
            self._ensure_model()
            return ProviderHealth(ok=True, detail=f"{self.model_id} ready (cpu)")
        except WorkerError as err:
            return ProviderHealth(ok=False, detail=err.code)
