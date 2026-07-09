"""Unit + integration tests for the worker (provider mocks, no network/models).

Covers Phase 20's required cases that do not need the real STT/translation
providers: SSRF + redirect blocking, ffprobe parsing, no-audio detection,
FFmpeg argument safety, transcription chunk offset + boundary dedup, translation
JSON parsing (missing/extra/duplicate/empty ids), incremental translation
persistence, transcript idempotency at the pipeline level, cancellation, retry
routing, and Persian Unicode preservation. Atomic claim / concurrent claim /
lease expiry / heartbeat / max-attempts are verified for real against Postgres
in run_queue_rpc_tests.sh.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import errors, media, ssrf, transcription, translation, config as configmod  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402


class TestErrorTaxonomy(unittest.TestCase):
    REQUIRED = [
        "WORKER_CONFIGURATION_MISSING", "WORKER_LEASE_FAILED", "WORKER_HEARTBEAT_FAILED",
        "SOURCE_OBJECT_MISSING", "SOURCE_DOWNLOAD_FAILED", "SOURCE_PRIVATE", "SOURCE_AUTH_REQUIRED",
        "SOURCE_TOO_LARGE", "SSRF_BLOCKED", "MEDIA_CORRUPT", "MEDIA_NO_AUDIO",
        "MEDIA_FORMAT_UNSUPPORTED", "VIDEO_TOO_LONG", "FFPROBE_FAILED", "AUDIO_EXTRACTION_FAILED",
        "STT_CONFIGURATION_MISSING", "STT_MODEL_LOAD_FAILED", "STT_PROVIDER_UNAVAILABLE",
        "STT_RATE_LIMITED", "STT_FAILED", "TRANSCRIPT_EMPTY", "TRANSLATION_CONFIGURATION_MISSING",
        "TRANSLATION_MODEL_UNAVAILABLE", "TRANSLATION_PROVIDER_UNAVAILABLE", "TRANSLATION_RATE_LIMITED",
        "TRANSLATION_INVALID_RESPONSE", "TRANSLATION_INCOMPLETE", "JOB_TIMEOUT", "JOB_CANCELLED",
        "INTERNAL_PROCESSING_ERROR",
    ]

    def test_all_required_codes_present(self):
        codes = set(errors.all_codes())
        for code in self.REQUIRED:
            self.assertIn(code, codes)

    def test_every_code_has_persian_message_and_stage(self):
        for code in errors.all_codes():
            spec = errors.spec_for(code)
            self.assertTrue(spec.message_fa.strip(), code)
            self.assertTrue(spec.stage, code)

    def test_worker_error_carries_correlation_and_hides_detail(self):
        err = WorkerError("STT_FAILED", dev_detail="raw provider stacktrace")
        self.assertEqual(err.code, "STT_FAILED")
        self.assertTrue(err.retryable)
        self.assertTrue(err.correlation_id)
        self.assertNotIn("stacktrace", err.message_fa)


class TestSSRF(unittest.TestCase):
    def _resolver(self, ip):
        return lambda host: [ip]

    def test_blocks_non_https(self):
        with self.assertRaises(WorkerError) as ctx:
            ssrf.assert_safe_public_url("http://example.com/a.mp4", resolver=self._resolver("93.184.216.34"))
        self.assertEqual(ctx.exception.code, "SSRF_BLOCKED")

    def test_blocks_credentials(self):
        with self.assertRaises(WorkerError):
            ssrf.assert_safe_public_url("https://user:pass@example.com/a.mp4", resolver=self._resolver("93.184.216.34"))

    def test_blocks_loopback_and_private_and_metadata(self):
        for host, ip in [
            ("localhost", "127.0.0.1"),
            ("internal.example.com", "10.0.0.5"),
            ("internal.example.com", "192.168.1.9"),
            ("internal.example.com", "172.16.3.3"),
            ("metadata.google.internal", "169.254.169.254"),
            ("evil.example.com", "169.254.169.254"),
        ]:
            with self.assertRaises(WorkerError) as ctx:
                ssrf.assert_safe_public_url(f"https://{host}/a.mp4", resolver=self._resolver(ip))
            self.assertEqual(ctx.exception.code, "SSRF_BLOCKED", (host, ip))

    def test_blocks_single_label_and_dot_local(self):
        for host in ["intranet", "db.local", "svc.internal"]:
            with self.assertRaises(WorkerError):
                ssrf.assert_safe_public_url(f"https://{host}/a.mp4", resolver=self._resolver("93.184.216.34"))

    def test_blocks_ip_literal_even_if_public(self):
        with self.assertRaises(WorkerError):
            ssrf.assert_safe_public_url("https://93.184.216.34/a.mp4", resolver=self._resolver("93.184.216.34"))

    def test_allows_public_hostname(self):
        url = ssrf.assert_safe_public_url("https://cdn.example.com/clip.mp4", resolver=self._resolver("93.184.216.34"))
        self.assertEqual(url, "https://cdn.example.com/clip.mp4")


class TestMedia(unittest.TestCase):
    GOOD = """
    {"format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "12.500", "size": "204800"},
     "streams": [
       {"codec_type": "video", "codec_name": "h264", "width": 1280, "height": 720, "avg_frame_rate": "30000/1001"},
       {"codec_type": "audio", "codec_name": "aac"}
     ]}
    """

    def test_parse_ffprobe(self):
        info = media.parse_ffprobe_json(self.GOOD)
        self.assertAlmostEqual(info.duration_seconds, 12.5, places=2)
        self.assertEqual(info.container, "mov")
        self.assertEqual(info.video_codec, "h264")
        self.assertEqual(info.audio_codec, "aac")
        self.assertEqual(info.audio_track_count, 1)
        self.assertEqual(info.width, 1280)
        self.assertAlmostEqual(info.frame_rate, 29.97, places=2)
        self.assertEqual(info.size_bytes, 204800)

    def test_validate_rejects_no_audio(self):
        raw = '{"format":{"format_name":"mp4","duration":"5"},"streams":[{"codec_type":"video","codec_name":"h264"}]}'
        info = media.parse_ffprobe_json(raw)
        with self.assertRaises(WorkerError) as ctx:
            media.validate_media(info, max_duration_seconds=900)
        self.assertEqual(ctx.exception.code, "MEDIA_NO_AUDIO")

    def test_validate_rejects_too_long(self):
        info = media.parse_ffprobe_json(self.GOOD)
        with self.assertRaises(WorkerError) as ctx:
            media.validate_media(info, max_duration_seconds=5)
        self.assertEqual(ctx.exception.code, "VIDEO_TOO_LONG")

    def test_validate_rejects_zero_duration(self):
        raw = '{"format":{"format_name":"mp4","duration":"0"},"streams":[{"codec_type":"audio","codec_name":"aac"}]}'
        info = media.parse_ffprobe_json(raw)
        with self.assertRaises(WorkerError) as ctx:
            media.validate_media(info, max_duration_seconds=900)
        self.assertEqual(ctx.exception.code, "MEDIA_CORRUPT")

    def test_ffmpeg_args_are_a_safe_array(self):
        cmd = media.audio_extract_command("/tmp/in put.mp4", "/tmp/out.wav")
        self.assertIsInstance(cmd, list)
        self.assertEqual(cmd[0], "ffmpeg")
        self.assertIn("-vn", cmd)          # no video re-encode
        self.assertIn("16000", cmd)        # 16 kHz
        self.assertIn("pcm_s16le", cmd)    # PCM
        self.assertIn("1", cmd)            # mono (-ac 1)
        # A path with a space stays a single argv element (no shell splitting).
        self.assertIn("/tmp/in put.mp4", cmd)

    def test_ffprobe_args_are_a_safe_array(self):
        cmd = media.ffprobe_command("/tmp/a;rm -rf b.mp4")
        self.assertEqual(cmd[0], "ffprobe")
        self.assertIn("/tmp/a;rm -rf b.mp4", cmd)  # dangerous chars stay inert in argv


class TestTranscriptionHelpers(unittest.TestCase):
    def test_offset_segments(self):
        segs = [transcription.TranscriptSegment(0, 1000, "a"), transcription.TranscriptSegment(1000, 2000, "b")]
        shifted = transcription.offset_segments(segs, 5000)
        self.assertEqual((shifted[0].start_ms, shifted[0].end_ms), (5000, 6000))
        self.assertEqual((shifted[1].start_ms, shifted[1].end_ms), (6000, 7000))

    def test_merge_dedup_overlap_boundary(self):
        chunk_a = [transcription.TranscriptSegment(0, 1000, "hello"), transcription.TranscriptSegment(1000, 2000, "world")]
        # Overlap: "world" repeated at the start of the next chunk within window.
        chunk_b = [transcription.TranscriptSegment(1900, 2000, "world"), transcription.TranscriptSegment(2000, 3000, "again")]
        merged = transcription.merge_chunk_segments([chunk_a, chunk_b], overlap_ms=500)
        texts = [s.text for s in merged]
        self.assertEqual(texts, ["hello", "world", "again"])

    def test_logprob_to_confidence(self):
        self.assertIsNone(transcription.logprob_to_confidence(None))
        self.assertEqual(transcription.logprob_to_confidence(0.0), 1.0)
        self.assertTrue(0.0 <= transcription.logprob_to_confidence(-1.0) <= 1.0)


class TestTranslationValidation(unittest.TestCase):
    def test_batches_respect_char_budget_and_context(self):
        segs = [translation.Segment(i, "x" * 100) for i in range(10)]
        batches = translation.build_batches(segs, max_chars=250, context_window=2)
        self.assertTrue(len(batches) > 1)
        # Each non-first batch carries preceding context, none exceeding window.
        for b in batches:
            self.assertLessEqual(len(b.context), 2)
        # Every segment appears exactly once across batches, in order.
        flat = [s.segment_index for b in batches for s in b.segments]
        self.assertEqual(flat, list(range(10)))

    def test_valid_payload(self):
        payload = {"segments": [{"id": 0, "translated_text_fa": "سلام"}, {"id": 1, "translated_text_fa": "دنیا"}]}
        out = translation.validate_translation_payload(payload, [0, 1])
        self.assertEqual(out, {0: "سلام", 1: "دنیا"})

    def test_missing_id(self):
        with self.assertRaises(WorkerError) as ctx:
            translation.validate_translation_payload({"segments": [{"id": 0, "translated_text_fa": "سلام"}]}, [0, 1])
        self.assertEqual(ctx.exception.code, "TRANSLATION_INCOMPLETE")

    def test_extra_id(self):
        payload = {"segments": [{"id": 0, "translated_text_fa": "a"}, {"id": 9, "translated_text_fa": "b"}]}
        with self.assertRaises(WorkerError) as ctx:
            translation.validate_translation_payload(payload, [0])
        self.assertEqual(ctx.exception.code, "TRANSLATION_INVALID_RESPONSE")

    def test_duplicate_id(self):
        payload = {"segments": [{"id": 0, "translated_text_fa": "a"}, {"id": 0, "translated_text_fa": "b"}]}
        with self.assertRaises(WorkerError) as ctx:
            translation.validate_translation_payload(payload, [0])
        self.assertEqual(ctx.exception.code, "TRANSLATION_INVALID_RESPONSE")

    def test_empty_translation(self):
        payload = {"segments": [{"id": 0, "translated_text_fa": "   "}]}
        with self.assertRaises(WorkerError) as ctx:
            translation.validate_translation_payload(payload, [0])
        self.assertEqual(ctx.exception.code, "TRANSLATION_INCOMPLETE")

    def test_extract_json_object_tolerates_fences(self):
        obj = translation.extract_json_object('```json\n{"segments": [{"id": 0, "translated_text_fa": "خوب"}]}\n```')
        self.assertEqual(obj["segments"][0]["translated_text_fa"], "خوب")

    def test_persian_unicode_preserved(self):
        payload = {"segments": [{"id": 0, "translated_text_fa": "زبانِ فارسی «نمونه» ۱۲۳"}]}
        out = translation.validate_translation_payload(payload, [0])
        self.assertEqual(out[0], "زبانِ فارسی «نمونه» ۱۲۳")


class TestTranslationProviderRetry(unittest.TestCase):
    def _provider(self):
        return translation.OpenAICompatibleProvider("https://api.example.com/v1", "key", "qwen-x")

    def test_retries_invalid_then_succeeds(self):
        provider = self._provider()
        calls = {"n": 0}

        def fake_call(messages):
            calls["n"] += 1
            if calls["n"] == 1:
                return "not json at all"
            return '{"segments":[{"id":0,"translated_text_fa":"سلام"},{"id":1,"translated_text_fa":"دنیا"}]}'

        with mock.patch.object(provider, "_call", side_effect=fake_call):
            out = provider.translate_batch(translation.Batch(segments=[translation.Segment(0, "hi"), translation.Segment(1, "world")]))
        self.assertEqual(out, {0: "سلام", 1: "دنیا"})
        self.assertEqual(calls["n"], 2)

    def test_non_retryable_incomplete_raises_after_retries(self):
        provider = translation.OpenAICompatibleProvider("https://api.example.com/v1", "key", "qwen-x", max_retries=2)

        with mock.patch.object(provider, "_call", return_value='{"segments":[]}'):
            with self.assertRaises(WorkerError) as ctx:
                provider.translate_batch(translation.Batch(segments=[translation.Segment(0, "hi")]))
        self.assertIn(ctx.exception.code, ("TRANSLATION_INCOMPLETE", "TRANSLATION_INVALID_RESPONSE"))


class TestConfig(unittest.TestCase):
    def test_missing_required_raises(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(WorkerError) as ctx:
                configmod.load_config()
            self.assertEqual(ctx.exception.code, "WORKER_CONFIGURATION_MISSING")

    def test_happy_path(self):
        env = {
            "SUPABASE_URL": "https://x.supabase.co",
            "SUPABASE_SERVICE_ROLE_KEY": "svc",
            "TRANSLATION_BASE_URL": "https://api.example.com/v1",
            "TRANSLATION_API_KEY": "k",
            "TRANSLATION_MODEL": "qwen-x",
            "STT_MODEL": "small",
        }
        with mock.patch.dict(os.environ, env, clear=True):
            cfg = configmod.load_config()
        self.assertEqual(cfg.supabase_url, "https://x.supabase.co")
        self.assertTrue(cfg.has_translation)
        self.assertEqual(cfg.stt_model, "small")


class TestLocalTranslation(unittest.TestCase):
    def test_flores_mapping(self):
        from worker.app.translation_local import flores_code
        self.assertEqual(flores_code("en"), "eng_Latn")
        self.assertEqual(flores_code("fa"), "pes_Arab")
        self.assertEqual(flores_code("EN"), "eng_Latn")
        self.assertEqual(flores_code("xx"), "eng_Latn")  # unknown -> english

    def test_nllb_translate_batch_with_mocked_model(self):
        from worker.app.translation_local import LocalNLLBTranslationProvider

        class FakeTok:
            src_lang = "eng_Latn"
            def convert_tokens_to_ids(self, t): return 250042
            def __call__(self, text, **kw): return {"input_ids": [[1, 2, 3]]}
            def batch_decode(self, tokens, skip_special_tokens=True): return ["سلام دنیا"]

        class FakeModel:
            def generate(self, **kw): return [[9, 9, 9]]

        p = LocalNLLBTranslationProvider()
        p._tokenizer = FakeTok()
        p._model = FakeModel()
        with mock.patch.object(p, "_ensure_model", return_value=None):
            out = p.translate_batch(translation.Batch(
                segments=[translation.Segment(0, "hi"), translation.Segment(1, "world")],
                source_language="en",
            ))
        self.assertEqual(out, {0: "سلام دنیا", 1: "سلام دنیا"})

    def test_nllb_rejects_empty_source(self):
        from worker.app.translation_local import LocalNLLBTranslationProvider

        class FakeTok:
            src_lang = "eng_Latn"
            def convert_tokens_to_ids(self, t): return 1
            def __call__(self, text, **kw): return {"input_ids": [[1]]}
            def batch_decode(self, tokens, skip_special_tokens=True): return [""]

        p = LocalNLLBTranslationProvider()
        p._tokenizer = FakeTok()
        p._model = type("M", (), {"generate": lambda self, **kw: [[1]]})()
        with mock.patch.object(p, "_ensure_model", return_value=None):
            with self.assertRaises(WorkerError) as ctx:
                p.translate_batch(translation.Batch(segments=[translation.Segment(0, "   ")], source_language="en"))
        self.assertEqual(ctx.exception.code, "TRANSLATION_INCOMPLETE")


class TestProviderSelection(unittest.TestCase):
    def _cfg(self, extra):
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "svc", **extra}
        with mock.patch.dict(os.environ, env, clear=True):
            return configmod.load_config()

    def test_defaults_to_local_nllb_without_key(self):
        from worker.app.main import build_translation_provider
        from worker.app.translation_local import LocalNLLBTranslationProvider
        cfg = self._cfg({})
        self.assertEqual(cfg.translation_provider, "local_nllb")
        self.assertTrue(cfg.has_translation)  # no external key required
        self.assertIsInstance(build_translation_provider(cfg), LocalNLLBTranslationProvider)

    def test_openai_compatible_when_selected(self):
        from worker.app.main import build_translation_provider
        cfg = self._cfg({
            "TRANSLATION_PROVIDER": "openai_compatible",
            "TRANSLATION_BASE_URL": "https://api.example.com/v1",
            "TRANSLATION_API_KEY": "k", "TRANSLATION_MODEL": "qwen-x",
        })
        self.assertEqual(cfg.translation_provider, "openai_compatible")
        self.assertEqual(type(build_translation_provider(cfg)).__name__, "OpenAICompatibleProvider")

    def test_openai_compatible_missing_key_raises(self):
        with self.assertRaises(WorkerError):
            self._cfg({"TRANSLATION_PROVIDER": "openai_compatible"})


class FakeQueue:
    def __init__(self, heartbeat_returns=None):
        self.calls = []
        self.stages = []
        self.upserts = []
        self.translations = []
        self.completed = None
        self.cancelled_job = None
        self._hb = heartbeat_returns or (lambda: (True, False))

    def heartbeat(self, job_id, current=None, total=None, percent=None):
        self.calls.append(("hb", percent))
        return self._hb()

    def advance_stage(self, job_id, stage, current=None, total=None, percent=None):
        self.stages.append(stage)
        return (True, False)

    def complete(self, job_id, video_status="translating"):
        self.completed = video_status
        return (True, False)

    def cancel(self, job_id):
        self.cancelled_job = job_id

    def upsert_segments(self, video_id, segments):
        self.upserts.append(segments)
        return len(segments)

    def update_translations(self, video_id, items, provider, model):
        self.translations.append((items, provider, model))
        return len(items)

    def set_media_metadata(self, video_id, duration, lang):
        self.calls.append(("meta", duration, lang))


class FakeClient:
    def __init__(self, video, transcript_rows):
        self.base_url = "https://x.supabase.co"
        self.key = "svc"
        self._video = video
        self._rows = transcript_rows

    def select_one(self, table, query):
        return dict(self._video)

    def select_many(self, table, query):
        return [dict(r) for r in self._rows]

    def storage_object_exists(self, bucket, key):
        return True

    def download_storage_object(self, bucket, key, dest, max_bytes):
        with open(dest, "wb") as f:
            f.write(b"x" * 32)
        return 32


class FakeSTT:
    def __init__(self, result):
        self._result = result

    def transcribe(self, audio_path, on_progress=None):
        if on_progress:
            on_progress(5.0, 10.0)
        return self._result

    def health_check(self):
        return transcription.ProviderHealth(ok=True)


class FakeTranslation:
    def __init__(self):
        self.batches = []

    def translate_batch(self, batch):
        self.batches.append([s.segment_index for s in batch.segments])
        return {s.segment_index: f"فارسی-{s.segment_index}" for s in batch.segments}

    def health_check(self):
        return translation.ProviderHealth(ok=True)


def _pipeline(fake_queue, fake_client, stt, tr, tmp):
    from worker.app.pipeline import Pipeline, Providers
    env = {
        "SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "svc",
        "TRANSLATION_BASE_URL": "https://api.example.com/v1", "TRANSLATION_API_KEY": "k",
        "TRANSLATION_MODEL": "qwen-x", "WORK_DIR": tmp,
    }
    with mock.patch.dict(os.environ, env, clear=True):
        cfg = configmod.load_config()
    providers = Providers(stt=stt, translation=tr, translation_provider_name="openai_compatible", translation_model="qwen-x")
    return Pipeline(cfg, fake_client, fake_queue, providers)


class TestPipeline(unittest.TestCase):
    def _media_info(self):
        return media.MediaInfo(12.5, "mp4", "h264", "aac", 1, 1280, 720, 30.0, 1000)

    def _patches(self):
        return [
            mock.patch("worker.app.pipeline.acquire_source", return_value=32),
            mock.patch("worker.app.pipeline.media.run_ffprobe", return_value=self._media_info()),
            mock.patch("worker.app.pipeline.media.validate_media", return_value=None),
            mock.patch("worker.app.pipeline.media.extract_audio", return_value=None),
        ]

    def test_full_flow_orders_stages_and_translates_all(self):
        import tempfile
        from worker.app.queue import ClaimedJob
        video = {"id": "v1", "source_type": "upload", "storage_key": "k", "source_url": None}
        # After transcription the worker persists 2 segments; the translation
        # read returns them untranslated.
        rows = [
            {"segment_index": 0, "source_text": "hello", "translated_text_fa": None},
            {"segment_index": 1, "source_text": "world", "translated_text_fa": None},
        ]
        q = FakeQueue()
        client = FakeClient(video, rows)
        stt = FakeSTT(transcription.TranscriptionResult("en", [
            transcription.TranscriptSegment(0, 1000, "hello", 0.9),
            transcription.TranscriptSegment(1000, 2000, "world", 0.8),
        ]))
        tr = FakeTranslation()
        import contextlib
        with tempfile.TemporaryDirectory() as tmp:
            p = _pipeline(q, client, stt, tr, tmp)
            with contextlib.ExitStack() as stack:
                for patch in self._patches():
                    stack.enter_context(patch)
                p.process(ClaimedJob("j1", "v1", "u1", "acquiring_source", 1, 3))

        self.assertEqual(q.stages, ["validating", "extracting_audio", "transcribing", "translating"])
        self.assertEqual(len(q.upserts[0]), 2)
        self.assertEqual(q.upserts[0][0]["source_language"], "en")
        # both segments translated
        translated_ids = sorted(i["segment_index"] for items, _, _ in q.translations for i in items)
        self.assertEqual(translated_ids, [0, 1])
        self.assertEqual(q.completed, "translating")

    def test_cancellation_stops_before_completion(self):
        import tempfile, contextlib
        from worker.app.queue import ClaimedJob
        from worker.app.pipeline import Cancelled
        video = {"id": "v1", "source_type": "upload", "storage_key": "k"}
        q = FakeQueue(heartbeat_returns=lambda: (False, True))  # cancelled immediately
        client = FakeClient(video, [])
        stt = FakeSTT(transcription.TranscriptionResult("en", [transcription.TranscriptSegment(0, 1, "x")]))
        with tempfile.TemporaryDirectory() as tmp:
            p = _pipeline(q, client, stt, FakeTranslation(), tmp)
            with contextlib.ExitStack() as stack:
                for patch in self._patches():
                    stack.enter_context(patch)
                with self.assertRaises(Cancelled):
                    p.process(ClaimedJob("j1", "v1", "u1", "acquiring_source", 1, 3))
        self.assertIsNone(q.completed)

    def test_translation_resumes_and_skips_already_translated(self):
        import tempfile, contextlib
        from worker.app.queue import ClaimedJob
        video = {"id": "v1", "source_type": "upload", "storage_key": "k"}
        # One already translated, one pending -> only the pending is translated.
        rows = [
            {"segment_index": 0, "source_text": "hello", "translated_text_fa": "سلام"},
            {"segment_index": 1, "source_text": "world", "translated_text_fa": ""},
        ]
        q = FakeQueue()
        client = FakeClient(video, rows)
        stt = FakeSTT(transcription.TranscriptionResult("en", [
            transcription.TranscriptSegment(0, 1000, "hello"),
            transcription.TranscriptSegment(1000, 2000, "world"),
        ]))
        tr = FakeTranslation()
        with tempfile.TemporaryDirectory() as tmp:
            p = _pipeline(q, client, stt, tr, tmp)
            with contextlib.ExitStack() as stack:
                for patch in self._patches():
                    stack.enter_context(patch)
                p.process(ClaimedJob("j1", "v1", "u1", "acquiring_source", 1, 3))
        # Only segment 1 was sent for translation.
        self.assertEqual(tr.batches, [[1]])
        self.assertEqual(q.completed, "translating")


class TestDrain(unittest.TestCase):
    def _worker(self):
        from worker.app.main import Worker
        env = {"SUPABASE_URL": "https://x.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "svc"}
        with mock.patch.dict(os.environ, env, clear=True):
            cfg = configmod.load_config()
        return Worker(cfg)

    def test_drain_processes_available_then_exits(self):
        from worker.app.queue import ClaimedJob
        worker = self._worker()

        class DrainQueue:
            def __init__(self):
                self.jobs = [ClaimedJob("j1", "v1", "u", "acquiring_source", 1, 3),
                             ClaimedJob("j2", "v2", "u", "acquiring_source", 1, 3)]
                self.reaped = 0
            def reap_expired(self):
                self.reaped += 1
                return 0
            def claim_next(self):
                return self.jobs.pop(0) if self.jobs else None

        processed = []
        worker.queue = DrainQueue()
        worker.pipeline = type("P", (), {"process": lambda self, job: processed.append(job.id)})()
        summary = worker.drain(max_jobs=5, max_seconds=30)
        self.assertEqual(processed, ["j1", "j2"])
        self.assertEqual(summary["processed"], 2)

    def test_drain_respects_max_jobs(self):
        from worker.app.queue import ClaimedJob
        worker = self._worker()

        class InfiniteQueue:
            def reap_expired(self): return 0
            def claim_next(self): return ClaimedJob("j", "v", "u", "acquiring_source", 1, 3)

        worker.queue = InfiniteQueue()
        worker.pipeline = type("P", (), {"process": lambda self, job: None})()
        summary = worker.drain(max_jobs=2, max_seconds=30)
        self.assertEqual(summary["processed"], 2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
