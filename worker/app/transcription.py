"""Speech-to-text provider abstraction + faster-whisper implementation.

faster-whisper is self-hosted (CTranslate2), so there is no API key and no
per-request cost — only CPU/RAM and a one-time model download that is cached in
the image or a persistent volume. The model is loaded once per process, never
per job. Chunk-merge helpers are pure functions for deterministic testing;
faster-whisper itself already emits absolute timestamps for a whole file, so
manual chunking is only needed for audio longer than the model handles well.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Optional, Protocol

from .errors import (
    WorkerError,
    STT_MODEL_LOAD_FAILED,
    STT_FAILED,
    TRANSCRIPT_EMPTY,
)


@dataclass
class TranscriptSegment:
    start_ms: int
    end_ms: int
    text: str
    confidence: Optional[float] = None


@dataclass
class TranscriptionResult:
    language: str
    segments: list[TranscriptSegment]


@dataclass
class ProviderHealth:
    ok: bool
    detail: str = ""


def logprob_to_confidence(avg_logprob: Optional[float]) -> Optional[float]:
    if avg_logprob is None:
        return None
    return round(max(0.0, min(1.0, math.exp(avg_logprob))), 4)


def offset_segments(segments: list[TranscriptSegment], offset_ms: int) -> list[TranscriptSegment]:
    """Shift chunk-relative timestamps to absolute positions in the full audio."""
    return [
        TranscriptSegment(s.start_ms + offset_ms, s.end_ms + offset_ms, s.text, s.confidence)
        for s in segments
    ]


def merge_chunk_segments(chunks: list[list[TranscriptSegment]], overlap_ms: int = 500) -> list[TranscriptSegment]:
    """Concatenate per-chunk (already absolute-offset) segments, dropping
    duplicates created by the overlap window: a later segment that starts within
    ``overlap_ms`` of the previous segment's end and repeats its text is skipped.
    """
    merged: list[TranscriptSegment] = []
    for chunk in chunks:
        for seg in chunk:
            if merged:
                prev = merged[-1]
                same_text = seg.text.strip() == prev.text.strip()
                within_overlap = seg.start_ms <= prev.end_ms + overlap_ms
                if same_text and within_overlap:
                    continue
                # Exact-duplicate boundary segment (same span) -> skip.
                if seg.start_ms == prev.start_ms and seg.end_ms == prev.end_ms:
                    continue
            merged.append(seg)
    # Re-sort defensively and renumber implicitly by caller.
    merged.sort(key=lambda s: (s.start_ms, s.end_ms))
    return merged


class SpeechToTextProvider(Protocol):
    def transcribe(self, audio_path: str, on_progress: Optional[Callable[[float, float], None]] = None) -> TranscriptionResult: ...
    def health_check(self) -> ProviderHealth: ...


class FasterWhisperProvider:
    """CPU faster-whisper. Heavy imports are lazy so unit tests need no model."""

    def __init__(self, model_size: str = "small", device: str = "cpu",
                 compute_type: str = "int8", beam_size: int = 5, download_root: str = "/models"):
        self.model_size = model_size
        self.device = device
        self.compute_type = compute_type
        self.beam_size = beam_size
        self.download_root = download_root
        self._model = None

    def _ensure_model(self):
        if self._model is not None:
            return self._model
        try:
            from faster_whisper import WhisperModel  # lazy heavy import
        except ImportError as exc:
            raise WorkerError(STT_MODEL_LOAD_FAILED, dev_detail=f"faster_whisper import: {exc}", retryable=False)
        try:
            self._model = WhisperModel(
                self.model_size, device=self.device, compute_type=self.compute_type,
                download_root=self.download_root,
            )
        except Exception as exc:  # model download / init failure
            raise WorkerError(STT_MODEL_LOAD_FAILED, dev_detail=f"model load: {exc}")
        return self._model

    def transcribe(self, audio_path: str, on_progress: Optional[Callable[[float, float], None]] = None) -> TranscriptionResult:
        model = self._ensure_model()
        try:
            segments_iter, info = model.transcribe(audio_path, beam_size=self.beam_size, vad_filter=True)
        except Exception as exc:
            raise WorkerError(STT_FAILED, dev_detail=f"transcribe: {exc}")

        total = float(getattr(info, "duration", 0.0) or 0.0)
        out: list[TranscriptSegment] = []
        try:
            for seg in segments_iter:  # streaming generator
                out.append(TranscriptSegment(
                    start_ms=int(round(seg.start * 1000)),
                    end_ms=int(round(seg.end * 1000)),
                    text=(seg.text or "").strip(),
                    confidence=logprob_to_confidence(getattr(seg, "avg_logprob", None)),
                ))
                if on_progress and total > 0:
                    on_progress(min(seg.end, total), total)
        except Exception as exc:
            raise WorkerError(STT_FAILED, dev_detail=f"decode: {exc}")

        out = [s for s in out if s.text]
        if not out:
            raise WorkerError(TRANSCRIPT_EMPTY, dev_detail="no speech segments")
        return TranscriptionResult(language=getattr(info, "language", "") or "", segments=out)

    def health_check(self) -> ProviderHealth:
        try:
            self._ensure_model()
            return ProviderHealth(ok=True, detail=f"faster-whisper {self.model_size}/{self.compute_type} ready")
        except WorkerError as err:
            return ProviderHealth(ok=False, detail=err.code)
