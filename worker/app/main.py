"""Worker entrypoint: readiness, poll/claim loop, reaping, graceful shutdown.

The loop claims one job at a time, runs the pipeline, and finalizes it. On
SIGTERM/SIGINT it stops claiming new work, lets the in-flight job finish (its
lease keeps it owned), and exits; if a job cannot finish, the reaper re-queues
it after the lease expires. Errors are classified and routed through
fail_video_job so retryable failures re-queue and permanent ones surface a
Persian message.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time

from . import __version__
from .config import Config, load_config
from .errors import WorkerError, INTERNAL_PROCESSING_ERROR
from .health import HealthState, start_health_server
from .pipeline import Cancelled, LostLease, Pipeline, Providers
from .queue import Queue
from .supabase import SupabaseClient
from .transcription import FasterWhisperProvider
from .translation import OpenAICompatibleProvider
from .translation_local import LocalNLLBTranslationProvider

log = logging.getLogger("vidora.worker")


def build_translation_provider(config: Config):
    """Runtime-selectable translation adapter (self-hosted vs hosted)."""
    if config.translation_provider == "local_nllb":
        return LocalNLLBTranslationProvider(
            model_name=config.nllb_model, target_lang=config.nllb_target_lang,
            download_root=config.stt_download_root,
        )
    return OpenAICompatibleProvider(
        base_url=config.translation_base_url, api_key=config.translation_api_key,
        model=config.translation_model, max_retries=config.translation_max_retries,
    )


class Worker:
    def __init__(self, config: Config):
        self.config = config
        self.client = SupabaseClient(config.supabase_url, config.service_role_key)
        self.queue = Queue(self.client, config.worker_id, config.lease_seconds)
        self.stt = FasterWhisperProvider(
            model_size=config.stt_model, device=config.stt_device,
            compute_type=config.stt_compute_type, beam_size=config.stt_beam_size,
            download_root=config.stt_download_root,
        )
        self.translation = build_translation_provider(config)
        if getattr(self.translation, "IS_DEVELOPMENT_PROVIDER", False):
            log.warning(
                "TEMPORARY development translation provider active (%s); fluency is NOT production quality",
                config.translation_provider,
            )
        self.providers = Providers(
            stt=self.stt, translation=self.translation,
            translation_provider_name=config.translation_provider,
            translation_model=(config.nllb_model if config.translation_provider == "local_nllb" else config.translation_model),
        )
        self.pipeline = Pipeline(config, self.client, self.queue, self.providers)
        self._stop = False
        self._last_reap = 0.0

    def request_stop(self, *_):
        log.info("shutdown requested; will stop claiming new jobs")
        self._stop = True

    def _dependency_checks(self) -> dict:
        return {
            "queue": {"ok": self.client.ping()},
            "database": {"ok": self.client.ping()},
        }

    def run(self):
        os.makedirs(self.config.work_dir, exist_ok=True)
        state = HealthState(self.config.worker_id, commit=os.environ.get("GIT_COMMIT", ""))
        state.checks = self._dependency_checks
        state.started = True
        start_health_server(self.config.health_host, self.config.health_port, state)
        log.info("worker %s v%s started (model=%s)", self.config.worker_id, __version__, self.config.stt_model)

        # Warm the STT model once so the first job doesn't pay the load cost.
        health = self.stt.health_check()
        log.info("stt health: ok=%s detail=%s", health.ok, health.detail)

        while not self._stop:
            self._maybe_reap()
            try:
                job = self.queue.claim_next()
            except WorkerError as err:
                log.warning("claim failed: %s", err.to_log())
                self._sleep(self.config.poll_interval_seconds)
                continue

            if job is None:
                state.claiming = False
                self._sleep(self.config.poll_interval_seconds)
                continue

            state.claiming = True
            log.info("claimed job=%s video=%s attempt=%s", job.id, job.video_id, job.attempt)
            self._process(job)

        log.info("worker stopped cleanly")

    def drain(self, max_jobs: int = 5, max_seconds: float = 1500.0) -> dict:
        """Process currently-available jobs, then return — the event-triggered,
        scale-to-zero execution model (no always-on polling). Reaps expired
        leases first, then claims and processes one job at a time until the
        queue is empty or a bound is hit. Concurrency is 1 by construction."""
        os.makedirs(self.config.work_dir, exist_ok=True)
        deadline = time.time() + max_seconds
        reaped = self.queue.reap_expired()
        processed = 0
        completed_video_ids: list[str] = []
        while processed < max_jobs and time.time() < deadline and not self._stop:
            job = self.queue.claim_next()
            if job is None:
                break
            log.info("drain claimed job=%s video=%s attempt=%s", job.id, job.video_id, job.attempt)
            if self._process(job):
                completed_video_ids.append(job.video_id)
            processed += 1
        summary = {"reaped": reaped, "processed": processed, "video_ids": completed_video_ids}
        log.info("drain complete: %s", summary)
        return summary

    def _process(self, job) -> bool:
        """Returns True when the job completed its phase successfully (used to
        trigger best-effort post-processing like insight generation)."""
        try:
            self.pipeline.process(job)
            log.info("job=%s completed translation phase", job.id)
            return True
        except Cancelled:
            self.queue.cancel(job.id)
            log.info("job=%s cancelled by user", job.id)
        except LostLease:
            log.warning("job=%s lease lost; leaving for reaper", job.id)
        except WorkerError as err:
            log.warning("job=%s failed: %s", job.id, err.to_log())
            requeued, failed = self.queue.fail(job.id, err.code, err.dev_detail, err.message_fa, err.retryable)
            log.info("job=%s fail routed requeued=%s failed=%s", job.id, requeued, failed)
        except Exception as exc:  # unexpected: classify as internal, retryable
            err = WorkerError(INTERNAL_PROCESSING_ERROR, dev_detail=repr(exc))
            log.exception("job=%s unexpected error", job.id)
            self.queue.fail(job.id, err.code, err.dev_detail, err.message_fa, err.retryable)
        return False

    def _maybe_reap(self):
        now = time.time()
        if now - self._last_reap < self.config.reap_interval_seconds:
            return
        self._last_reap = now
        try:
            n = self.queue.reap_expired()
            if n:
                log.info("reaped %s expired job(s)", n)
        except WorkerError as err:
            log.warning("reap failed: %s", err.to_log())

    def _sleep(self, seconds: float):
        # Interruptible sleep so shutdown is prompt.
        end = time.time() + seconds
        while time.time() < end and not self._stop:
            time.sleep(0.2)


def _configure_logging():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def run_drain(max_jobs: int = 5, max_seconds: float = 1500.0) -> dict:
    """Load config, build the worker, warm the STT model, drain available jobs,
    and return a summary. This is the entry the event-triggered / scale-to-zero
    runtime (e.g. Modal) invokes — it does not poll forever."""
    _configure_logging()
    config = load_config(require_translation=True)
    worker = Worker(config)
    health = worker.stt.health_check()
    log.info("stt health: ok=%s detail=%s", health.ok, health.detail)
    return worker.drain(max_jobs=max_jobs, max_seconds=max_seconds)


def main():
    _configure_logging()
    try:
        config = load_config(require_translation=True)
    except WorkerError as err:
        log.error("configuration error: %s", err.to_log())
        sys.exit(2)

    # --drain runs once and exits (event-triggered runtimes); default is the
    # always-on polling loop (persistent-container runtimes like a VPS).
    if "--drain" in sys.argv:
        _configure_logging()
        summary = Worker(config).drain()
        log.info("drain result: %s", summary)
        return

    worker = Worker(config)
    signal.signal(signal.SIGTERM, worker.request_stop)
    signal.signal(signal.SIGINT, worker.request_stop)
    worker.run()


if __name__ == "__main__":
    main()
