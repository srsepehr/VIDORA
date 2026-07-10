"""Single-job pipeline orchestration.

Runs one claimed job through: acquire → validate (ffprobe) → extract audio
(FFmpeg) → transcribe → persist source segments → translate → persist Persian
translations → complete-phase. Every stage is idempotent (transcript upsert and
translation update are keyed by segment_index), so a retried job never
duplicates rows and already-translated segments are skipped. Heartbeats extend
the lease and surface cancellation between and within stages.
"""

from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass

from .config import Config
from .errors import (
    WorkerError,
    STAGE_VALIDATING,
    STAGE_EXTRACTING,
    STAGE_TRANSCRIBING,
    STAGE_TRANSLATING,
    STAGE_SUBTITLES,
)

log = logging.getLogger("vidora.worker.pipeline")
from . import media
from .queue import ClaimedJob, Queue
from .storage import acquire_source
from .supabase import SupabaseClient
from .transcription import SpeechToTextProvider, TranscriptSegment
from .translation import Segment as TSegment, TranslationProvider, build_batches


class Cancelled(Exception):
    """Raised when the video was cancelled mid-flight."""


class LostLease(Exception):
    """Raised when this worker no longer owns the job (reaper will requeue)."""


@dataclass
class Providers:
    stt: SpeechToTextProvider
    translation: TranslationProvider
    translation_provider_name: str
    translation_model: str


class Pipeline:
    def __init__(self, config: Config, client: SupabaseClient, queue: Queue, providers: Providers):
        self.config = config
        self.client = client
        self.queue = queue
        self.providers = providers

    # --- heartbeat / cancellation helper --------------------------------
    def _beat(self, job_id: str, *, current=None, total=None, percent=None) -> None:
        ok, cancelled = self.queue.heartbeat(job_id, current=current, total=total, percent=percent)
        if cancelled:
            raise Cancelled()
        if not ok:
            raise LostLease()

    def _advance(self, job_id: str, stage: str, *, current=None, total=None, percent=None) -> None:
        ok, cancelled = self.queue.advance_stage(job_id, stage, current=current, total=total, percent=percent)
        if cancelled:
            raise Cancelled()
        if not ok:
            raise LostLease()

    # --- main entry ------------------------------------------------------
    def process(self, job: ClaimedJob) -> None:
        workdir = os.path.join(self.config.work_dir, job.id)
        os.makedirs(workdir, exist_ok=True)
        try:
            self._run_stages(job, workdir)
        finally:
            shutil.rmtree(workdir, ignore_errors=True)

    def _run_stages(self, job: ClaimedJob, workdir: str) -> None:
        video = self.client.select_one("videos", f"id=eq.{job.video_id}&select=*")
        if not video:
            raise WorkerError("SOURCE_OBJECT_MISSING", dev_detail="video row vanished")

        # 1) acquire (video already at acquiring_source from claim)
        self._beat(job.id)
        source_path = os.path.join(workdir, "source.bin")
        bytes_written = acquire_source(self.config, self.client, video, source_path)
        self._beat(job.id, current=bytes_written, total=bytes_written, percent=100)

        # 2) validate with ffprobe
        self._advance(job.id, STAGE_VALIDATING)
        info = media.run_ffprobe(source_path)
        media.validate_media(info, max_duration_seconds=self.config.max_duration_seconds)
        self.queue.set_media_metadata(job.video_id, int(round(info.duration_seconds)), None)

        # 3) extract normalized audio
        self._advance(job.id, STAGE_EXTRACTING, percent=0)
        audio_path = os.path.join(workdir, "audio.wav")
        media.extract_audio(source_path, audio_path)
        self._beat(job.id, percent=100)

        # 4) transcribe
        self._advance(job.id, STAGE_TRANSCRIBING, percent=0)

        def on_stt_progress(done_s: float, total_s: float) -> None:
            pct = int(min(100, (done_s / total_s) * 100)) if total_s else 0
            # Heartbeat also enforces cancellation during the long decode.
            self._beat(job.id, current=int(done_s * 1000), total=int(total_s * 1000), percent=pct)

        result = self.providers.stt.transcribe(audio_path, on_progress=on_stt_progress)
        segments = _reindex(result.segments)
        self.queue.upsert_segments(job.video_id, [
            {
                "segment_index": i,
                "start_ms": s.start_ms,
                "end_ms": s.end_ms,
                "source_text": s.text,
                "confidence": s.confidence,
                "source_language": result.language,
            }
            for i, s in enumerate(segments)
        ])
        self.queue.set_media_metadata(job.video_id, int(round(info.duration_seconds)), result.language)
        self._beat(job.id, current=len(segments), total=len(segments), percent=100)

        # 5) translate every segment into Persian (incremental + idempotent)
        self._advance(job.id, STAGE_TRANSLATING, percent=0)
        self._translate_all(job)

        # Completeness guard: never finish the phase while any segment is still
        # untranslated. A miss fails retryably instead of marking a partial job
        # done.
        remaining = [
            r for r in self.client.select_many(
                "transcript_segments", f"video_id=eq.{job.video_id}&select=segment_index,translated_text_fa")
            if not (r.get("translated_text_fa") or "").strip()
        ]
        if remaining:
            raise WorkerError(
                "TRANSLATION_INCOMPLETE",
                dev_detail=f"{len(remaining)} segment(s) untranslated at completion",
            )

        # 6) soft subtitles (best-effort). A failure here must NOT fail the job
        # or the transcript/translation — it only records a failed artifact so
        # the review page stays usable. Uses the stdlib builder, no AI models.
        self._advance(job.id, STAGE_SUBTITLES, percent=0)
        try:
            from .subtitle_generation import generate_subtitles_for_video
            sub = generate_subtitles_for_video(self.config, self.client, job.video_id)
            log.info("job=%s subtitles: %s", job.id, sub.get("status"))
        except Cancelled:
            raise
        except WorkerError as err:
            log.warning("job=%s subtitle generation failed (non-fatal): %s", job.id, err.to_log())
        except Exception as exc:  # never let subtitles fail the whole job
            log.warning("job=%s subtitle generation errored (non-fatal): %r", job.id, exc)

        # 7) phase complete: video ends at 'translating' with full transcript.
        ok, cancelled = self.queue.complete(job.id, video_status=STAGE_TRANSLATING)
        if cancelled:
            raise Cancelled()
        if not ok:
            raise LostLease()

    def _translate_all(self, job: ClaimedJob) -> None:
        # Read the persisted transcript and translate only rows still missing a
        # Persian value — retries resume instead of re-translating.
        all_rows = self.client.select_many(
            "transcript_segments",
            f"video_id=eq.{job.video_id}&select=segment_index,source_text,translated_text_fa,source_language&order=segment_index.asc",
        )
        pending = [TSegment(r["segment_index"], r["source_text"]) for r in all_rows if not (r.get("translated_text_fa") or "").strip()]
        total = len(pending)
        if total == 0:
            self._beat(job.id, current=0, total=0, percent=100)
            return

        source_language = next((r.get("source_language") for r in all_rows if r.get("source_language")), "")
        batches = build_batches(pending, self.config.translation_batch_chars)
        for batch in batches:
            batch.source_language = source_language or ""
        done = 0
        for batch in batches:
            self._beat(job.id)  # cancellation check between batches
            mapping = self.providers.translation.translate_batch(batch)
            items = [{"segment_index": sid, "translated_text_fa": text} for sid, text in mapping.items()]
            self.queue.update_translations(
                job.video_id, items,
                self.providers.translation_provider_name, self.providers.translation_model,
            )
            done += len(batch.segments)
            pct = int(min(100, (done / total) * 100))
            self._beat(job.id, current=done, total=total, percent=pct)


def _reindex(segments: list[TranscriptSegment]) -> list[TranscriptSegment]:
    """Ensure strictly increasing 0-based ordering by start time."""
    return sorted(segments, key=lambda s: (s.start_ms, s.end_ms))
