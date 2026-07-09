"""Self-hosted translation adapter (Meta NLLB-200 on CPU).

Zero external API, no key, no per-request cost, no rate limits — the default for
the private zero-cost phase. Runs the distilled NLLB-200 model locally (CPU) via
transformers. Heavy imports are lazy so the rest of the worker and its unit tests
never require torch/transformers. Implements the same TranslationProvider
interface as the hosted adapter, so switching to a paid LLM for the public phase
is a config change only.
"""

from __future__ import annotations

from .errors import (
    WorkerError,
    TRANSLATION_MODEL_UNAVAILABLE,
    TRANSLATION_PROVIDER_UNAVAILABLE,
    TRANSLATION_INCOMPLETE,
)
from .translation import Batch, ProviderHealth

# Minimal ISO-639-1 -> FLORES-200 code map for the languages we expect from STT.
# Unknown languages fall back to English source (NLLB still translates).
_FLORES = {
    "en": "eng_Latn", "fa": "pes_Arab", "ar": "arb_Arab", "fr": "fra_Latn",
    "de": "deu_Latn", "es": "spa_Latn", "it": "ita_Latn", "pt": "por_Latn",
    "ru": "rus_Cyrl", "tr": "tur_Latn", "hi": "hin_Deva", "ur": "urd_Arab",
    "zh": "zho_Hans", "ja": "jpn_Jpan", "ko": "kor_Hang", "nl": "nld_Latn",
}


def flores_code(iso639_1: str) -> str:
    return _FLORES.get((iso639_1 or "").lower(), "eng_Latn")


class LocalNLLBTranslationProvider:
    def __init__(self, model_name: str = "facebook/nllb-200-distilled-600M",
                 target_lang: str = "pes_Arab", download_root: str | None = None,
                 max_new_tokens: int = 512):
        self.model_name = model_name
        self.target_lang = target_lang
        self.download_root = download_root
        self.max_new_tokens = max_new_tokens
        self._tokenizer = None
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return
        try:
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer  # lazy heavy import
        except ImportError as exc:
            raise WorkerError(TRANSLATION_MODEL_UNAVAILABLE, dev_detail=f"transformers import: {exc}", retryable=False)
        try:
            kwargs = {"cache_dir": self.download_root} if self.download_root else {}
            self._tokenizer = AutoTokenizer.from_pretrained(self.model_name, **kwargs)
            self._model = AutoModelForSeq2SeqLM.from_pretrained(self.model_name, **kwargs)
        except Exception as exc:
            raise WorkerError(TRANSLATION_MODEL_UNAVAILABLE, dev_detail=f"nllb load: {exc}")

    def translate_batch(self, batch: Batch) -> dict[int, str]:
        self._ensure_model()
        src = flores_code(batch.source_language)
        try:
            self._tokenizer.src_lang = src
            bos = self._tokenizer.convert_tokens_to_ids(self.target_lang)
            out: dict[int, str] = {}
            for seg in batch.segments:
                text = (seg.source_text or "").strip()
                if not text:
                    raise WorkerError(TRANSLATION_INCOMPLETE, dev_detail=f"empty source seg {seg.segment_index}")
                inputs = self._tokenizer(text, return_tensors="pt", truncation=True, max_length=1024)
                tokens = self._model.generate(
                    **inputs, forced_bos_token_id=bos, max_new_tokens=self.max_new_tokens,
                )
                fa = self._tokenizer.batch_decode(tokens, skip_special_tokens=True)[0].strip()
                if not fa:
                    raise WorkerError(TRANSLATION_INCOMPLETE, dev_detail=f"empty output seg {seg.segment_index}")
                out[seg.segment_index] = fa
            return out
        except WorkerError:
            raise
        except Exception as exc:
            raise WorkerError(TRANSLATION_PROVIDER_UNAVAILABLE, dev_detail=f"nllb generate: {exc}")

    def health_check(self) -> ProviderHealth:
        try:
            self._ensure_model()
            return ProviderHealth(ok=True, detail=f"nllb {self.model_name} ready")
        except WorkerError as err:
            return ProviderHealth(ok=False, detail=err.code)
