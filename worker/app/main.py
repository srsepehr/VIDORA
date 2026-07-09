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

log = logging.getLogger("vidora.worker")


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
        self.translation = OpenAICompatibleProvider(
            base_url=config.translation_base_url, api_key=config.translation_api_key,
            model=config.translation_model, max_retries=config.translation_max_retries,
        )
        self.providers = Providers(
            stt=self.stt, translation=self.translation,
            translation_provider_name=config.translation_provider,
            translation_model=config.translation_model,
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

    def _process(self, job):
        try:
            self.pipeline.process(job)
            log.info("job=%s completed translation phase", job.id)
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


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        config = load_config(require_translation=True)
    except WorkerError as err:
        log.error("configuration error: %s", err.to_log())
        sys.exit(2)

    worker = Worker(config)
    signal.signal(signal.SIGTERM, worker.request_stop)
    signal.signal(signal.SIGINT, worker.request_stop)
    worker.run()


if __name__ == "__main__":
    main()
