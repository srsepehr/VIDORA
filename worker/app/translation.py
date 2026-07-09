"""Translation provider abstraction + OpenAI-compatible implementation.

Provider-agnostic by design: any host that exposes an OpenAI-compatible
``/chat/completions`` endpoint (DashScope-International, Together, DeepInfra,
Novita, OpenRouter, Fireworks, SiliconFlow, a self-hosted vLLM, …) is selected
purely through TRANSLATION_BASE_URL / TRANSLATION_MODEL / TRANSLATION_API_KEY.
That keeps the exact Qwen model a configuration choice, never hard-coded.

Batching preserves context and order; every response is strictly validated so a
malformed or incomplete batch retries instead of silently corrupting output.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Protocol

from . import http_client
from .errors import (
    WorkerError,
    TRANSLATION_INCOMPLETE,
    TRANSLATION_INVALID_RESPONSE,
    TRANSLATION_PROVIDER_UNAVAILABLE,
    TRANSLATION_RATE_LIMITED,
    TRANSLATION_MODEL_UNAVAILABLE,
)
from .prompts import TRANSLATION_SYSTEM_PROMPT


@dataclass
class Segment:
    segment_index: int
    source_text: str


@dataclass
class ProviderHealth:
    ok: bool
    detail: str = ""


@dataclass
class Batch:
    segments: list[Segment]
    context: list[Segment] = field(default_factory=list)
    source_language: str = ""  # ISO-639-1 from STT; used by MT adapters


def build_batches(segments: list[Segment], max_chars: int, context_window: int = 3) -> list[Batch]:
    """Group segments so each batch's source text stays under ``max_chars``,
    attaching up to ``context_window`` preceding segments as read-only context."""
    batches: list[Batch] = []
    current: list[Segment] = []
    size = 0
    for seg in segments:
        seg_len = len(seg.source_text) + 16  # small per-item JSON overhead
        if current and size + seg_len > max_chars:
            batches.append(_finalize_batch(current, segments, context_window))
            current = []
            size = 0
        current.append(seg)
        size += seg_len
    if current:
        batches.append(_finalize_batch(current, segments, context_window))
    return batches


def _finalize_batch(current: list[Segment], all_segments: list[Segment], window: int) -> Batch:
    first_index_pos = all_segments.index(current[0])
    ctx_start = max(0, first_index_pos - window)
    context = all_segments[ctx_start:first_index_pos]
    return Batch(segments=list(current), context=list(context))


def validate_translation_payload(payload: dict, requested_ids: list[int]) -> dict[int, str]:
    """Validate a parsed model response against the requested ids. Raises
    WorkerError on any structural problem. Returns {segment_index: fa_text}."""
    if not isinstance(payload, dict) or not isinstance(payload.get("segments"), list):
        raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail="missing segments array")

    requested = set(requested_ids)
    seen: dict[int, str] = {}
    for item in payload["segments"]:
        if not isinstance(item, dict) or "id" not in item or "translated_text_fa" not in item:
            raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail="malformed segment item")
        try:
            sid = int(item["id"])
        except (TypeError, ValueError):
            raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail=f"non-int id {item.get('id')!r}")
        text = item["translated_text_fa"]
        if not isinstance(text, str) or not text.strip():
            raise WorkerError(TRANSLATION_INCOMPLETE, dev_detail=f"empty translation for id {sid}")
        if sid not in requested:
            raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail=f"unexpected id {sid}")
        if sid in seen:
            raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail=f"duplicate id {sid}")
        seen[sid] = text.strip()

    missing = requested - set(seen)
    if missing:
        raise WorkerError(TRANSLATION_INCOMPLETE, dev_detail=f"missing ids {sorted(missing)}")
    return seen


def extract_json_object(text: str) -> dict:
    """Parse a JSON object from a model reply, tolerating stray code fences."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail="no JSON object in reply")
    try:
        return json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError as exc:
        raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail=f"json parse error: {exc}")


def build_user_message(batch: Batch) -> str:
    return json.dumps(
        {
            "context": [{"id": s.segment_index, "source_text": s.source_text} for s in batch.context],
            "segments": [{"id": s.segment_index, "source_text": s.source_text} for s in batch.segments],
        },
        ensure_ascii=False,
    )


class TranslationProvider(Protocol):
    def translate_batch(self, batch: Batch) -> dict[int, str]: ...
    def health_check(self) -> ProviderHealth: ...


class OpenAICompatibleProvider:
    def __init__(self, base_url: str, api_key: str, model: str, *, max_retries: int = 3, timeout: float = 120.0):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.max_retries = max_retries
        self.timeout = timeout

    def _endpoint(self) -> str:
        # Accept both a bare host and a full /v1 base.
        base = self.base_url
        if base.endswith("/chat/completions"):
            return base
        if base.endswith("/v1"):
            return base + "/chat/completions"
        return base + "/v1/chat/completions"

    def _call(self, messages: list[dict]) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        resp = http_client.post_json(
            self._endpoint(),
            payload,
            headers={"Authorization": f"Bearer {self.api_key}"},
            timeout=self.timeout,
        )
        if resp.status == 429:
            raise WorkerError(TRANSLATION_RATE_LIMITED, dev_detail="429 from translation provider")
        if resp.status in (400, 404) and b"model" in resp.body.lower():
            raise WorkerError(TRANSLATION_MODEL_UNAVAILABLE, dev_detail=f"{resp.status}: model not found")
        if not resp.ok:
            raise WorkerError(
                TRANSLATION_PROVIDER_UNAVAILABLE,
                dev_detail=f"http {resp.status}: {resp.body[:200]!r}",
                retryable=resp.status >= 500 or resp.status == 408,
            )
        try:
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, ValueError) as exc:
            raise WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail=f"unexpected response shape: {exc}")

    def translate_batch(self, batch: Batch) -> dict[int, str]:
        requested_ids = [s.segment_index for s in batch.segments]
        messages = [
            {"role": "system", "content": TRANSLATION_SYSTEM_PROMPT},
            {"role": "user", "content": build_user_message(batch)},
        ]
        last: WorkerError | None = None
        for attempt in range(self.max_retries):
            try:
                content = self._call(messages)
                payload = extract_json_object(content)
                return validate_translation_payload(payload, requested_ids)
            except WorkerError as err:
                last = err
                if not err.retryable:
                    raise
                # Nudge the model on structural retries.
                messages.append({"role": "user", "content": "Your previous reply was invalid JSON or incomplete. Return ONLY the required JSON object with every requested id."})
        raise last or WorkerError(TRANSLATION_INVALID_RESPONSE, dev_detail="exhausted retries")

    def health_check(self) -> ProviderHealth:
        try:
            result = self.translate_batch(Batch(segments=[Segment(0, "hello")]))
            return ProviderHealth(ok=bool(result.get(0)), detail="translate probe ok")
        except WorkerError as err:
            return ProviderHealth(ok=False, detail=err.code)
