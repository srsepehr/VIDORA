"""Tests for adaptive-learning orchestration (fake client + provider)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import learning_service as S  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402
from worker.app.learning import assessment_hash, generation_hash, prepare_learning_segments  # noqa: E402
from worker.app.learning_config import (  # noqa: E402
    ASSESS_PROMPT_VERSION, ASSESS_SCHEMA_VERSION, GEN_PROMPT_VERSION, GEN_SCHEMA_VERSION,
)

ROWS = [
    {"segment_index": i, "start_ms": i * 10000, "end_ms": (i + 1) * 10000,
     "source_text": f"artificial intelligence changes how we work part {i}",
     "translated_text_fa": f"هوش مصنوعی شیوه کار را تغییر می‌دهد و یادگیری ابزارها مزیت است {i}"}
    for i in range(3)
]


def good_assessment():
    return {
        "content_kind": "conceptual", "content_suitability": "high",
        "language_suitability": "high", "reason_code": "MEANINGFUL_CONCEPTS_AND_LANGUAGE",
        "teachable_points": [
            {"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
            {"text": "یادگیری ابزارها مزیت است", "segment_indexes": [2]},
        ],
    }


def good_set():
    return {
        "flashcards": [
            {"learning_mode": "content", "front": "هوش مصنوعی چه تاثیری دارد؟",
             "back": "شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
        ],
        "quiz": [
            {"learning_mode": "content", "question": "طبق ویدیو مزیت چیست؟",
             "choices": ["یادگیری ابزارها", "خرید سخت‌افزار", "استخدام بیشتر"],
             "correct_choice_index": 0,
             "explanation": "ویدیو یادگیری ابزارها را مزیت می‌داند.",
             "segment_indexes": [2]},
        ],
    }


class FakeProvider:
    name = "local_transformers"
    model_id = "fake-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []

    def complete_json(self, system, user, correction=None):
        self.calls.append((system[:24], bool(correction)))
        if not self.outputs:
            raise WorkerError("LEARNING_PROVIDER_UNAVAILABLE", dev_detail="no more fake outputs")
        return self.outputs.pop(0)

    def health_check(self):
        from worker.app.insight_provider import ProviderHealth
        return ProviderHealth(ok=True)


class FakeClient:
    def __init__(self, rows=ROWS, profile=None, learning_set=None):
        self.video = {"id": "vid1", "user_id": "owner1", "title": "نمونه", "original_filename": "c.mp4"}
        self.rows = rows
        self.profile = profile
        self.learning_set = learning_set
        self.rpc_calls = []

    def select_one(self, table, query):
        if table == "videos":
            return dict(self.video)
        if table == "video_learning_profiles":
            return dict(self.profile) if self.profile else None
        if table == "video_learning_sets":
            return dict(self.learning_set) if self.learning_set else None
        return None

    def select_many(self, table, query):
        if table == "transcript_segments":
            return [dict(r) for r in self.rows]
        return []

    def rpc(self, fn, params):
        self.rpc_calls.append((fn, params))
        # Mirror profile persistence so generate() sees the fresh profile.
        if fn == "persist_video_learning_profile":
            self.profile = {
                "id": "p1", "status": "ready",
                "recommended_mode": params["p_recommended_mode"],
                "content_kind": params["p_content_kind"],
                "content_suitability": params["p_content_suitability"],
                "language_suitability": params["p_language_suitability"],
                "reason_code": params["p_reason_code"],
                "teachable_points": params["p_teachable_points"],
                "content_hash": params["p_content_hash"],
                "prompt_version": params["p_prompt_version"],
                "schema_version": params["p_schema_version"],
                "editorial_policy": "auto", "assessed_at": None,
            }
        return None


def current_hash(provider_name="local_transformers", model="fake-model"):
    segments, _ = prepare_learning_segments(ROWS)
    return assessment_hash("vid1", segments, provider=provider_name, model=model)


def ready_profile(**over):
    base = {
        "id": "p1", "status": "ready", "recommended_mode": "both",
        "content_kind": "conceptual", "content_suitability": "high",
        "language_suitability": "high", "reason_code": "MEANINGFUL_CONCEPTS_AND_LANGUAGE",
        "teachable_points": good_assessment()["teachable_points"],
        "content_hash": current_hash(), "prompt_version": ASSESS_PROMPT_VERSION,
        "schema_version": ASSESS_SCHEMA_VERSION, "editorial_policy": "auto", "assessed_at": None,
    }
    base.update(over)
    return base


class TestAssessment(unittest.TestCase):
    def test_assess_persists_model_result(self):
        client = FakeClient()
        provider = FakeProvider([good_assessment()])
        out = S.assess_video_for(client, "vid1", provider=provider)
        self.assertEqual(out["status"], "assessed")
        self.assertEqual(out["recommended_mode"], "both")
        self.assertEqual(out["assessment_source"], "model")
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_learning_profile_status", "persist_video_learning_profile"])
        self.assertNotIn("هوش", str(out))  # structural output only

    def test_assess_reuses_matching_profile(self):
        client = FakeClient(profile=ready_profile())
        provider = FakeProvider([])  # would raise if called
        out = S.assess_video_for(client, "vid1", provider=provider)
        self.assertEqual(out["status"], "reused")
        self.assertEqual(provider.calls, [])
        self.assertEqual(client.rpc_calls, [])

    def test_assess_hash_change_marks_stale_then_replaces(self):
        client = FakeClient(profile=ready_profile(content_hash="oldhash"))
        provider = FakeProvider([good_assessment()])
        S.assess_video_for(client, "vid1", provider=provider)
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names[0], "mark_video_learning_stale")
        self.assertIn("persist_video_learning_profile", names)

    def test_deterministic_none_persists_without_model(self):
        rows = [dict(r, translated_text_fa="") for r in ROWS]
        client = FakeClient(rows=rows)
        provider = FakeProvider([])  # never called
        out = S.assess_video_for(client, "vid1", provider=provider)
        self.assertEqual(out["recommended_mode"], "none")
        self.assertEqual(out["assessment_source"], "deterministic")
        self.assertEqual(provider.calls, [])
        persist = dict(client.rpc_calls)["persist_video_learning_profile"]
        self.assertEqual(persist["p_reason_code"], "INCOMPLETE_TRANSCRIPT")

    def test_assess_failure_recorded_without_erasing(self):
        client = FakeClient()
        provider = FakeProvider([{"content_kind": "amazing"}, {"content_kind": "still bad"}])
        with self.assertRaises(WorkerError):
            S.assess_video_for(client, "vid1", provider=provider)
        self.assertEqual(len(provider.calls), 2)  # exactly one repair
        self.assertEqual(client.rpc_calls[-1][1]["p_status"], "failed")

    def test_forced_rerun_rate_limited(self):
        from datetime import datetime, timezone
        client = FakeClient(profile=ready_profile(assessed_at=datetime.now(timezone.utc).isoformat()))
        provider = FakeProvider([good_assessment()])
        with self.assertRaises(WorkerError) as ctx:
            S.assess_video_for(client, "vid1", provider=provider, force=True)
        self.assertEqual(ctx.exception.code, "LEARNING_RATE_LIMITED")


class TestGeneration(unittest.TestCase):
    def test_generate_persists_set(self):
        client = FakeClient(profile=ready_profile())
        provider = FakeProvider([good_set()])
        out = S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(out["flashcard_count"], 1)
        self.assertEqual(out["quiz_count"], 1)
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_learning_set_status", "persist_video_learning_set"])
        persist = client.rpc_calls[-1][1]
        self.assertEqual(persist["p_prompt_version"], GEN_PROMPT_VERSION)
        self.assertEqual(persist["p_schema_version"], GEN_SCHEMA_VERSION)
        self.assertEqual(persist["p_profile_hash"], current_hash())

    def test_generate_reuses_matching_set(self):
        gen_hash = generation_hash(current_hash(), "content",
                                   provider="local_transformers", model="fake-model")
        client = FakeClient(profile=ready_profile(), learning_set={
            "id": "s1", "status": "ready", "content_hash": gen_hash,
            "prompt_version": GEN_PROMPT_VERSION, "schema_version": GEN_SCHEMA_VERSION,
            "flashcard_count": 1, "quiz_count": 1, "generated_at": None})
        provider = FakeProvider([])
        out = S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(out["status"], "reused")
        self.assertEqual(provider.calls, [])
        self.assertEqual(client.rpc_calls, [])

    def test_generate_reassesses_stale_profile_first(self):
        client = FakeClient(profile=ready_profile(content_hash="oldhash"))
        provider = FakeProvider([good_assessment(), good_set()])
        out = S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(out["status"], "generated")
        names = [n for n, _ in client.rpc_calls]
        self.assertIn("persist_video_learning_profile", names)
        self.assertIn("persist_video_learning_set", names)

    def test_unsupported_mode_rejected_not_fabricated(self):
        client = FakeClient(profile=ready_profile(language_suitability="none", recommended_mode="content"))
        provider = FakeProvider([good_set()])
        with self.assertRaises(WorkerError) as ctx:
            S.generate_learning_set_for(client, "vid1", "language", provider=provider)
        self.assertEqual(ctx.exception.code, "LEARNING_MODE_UNSUPPORTED")
        self.assertEqual(provider.calls, [])

    def test_none_recommendation_returns_not_recommended(self):
        client = FakeClient(profile=ready_profile(
            content_suitability="none", language_suitability="none", recommended_mode="none"))
        provider = FakeProvider([good_set()])
        with self.assertRaises(WorkerError) as ctx:
            S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(ctx.exception.code, "LEARNING_NOT_RECOMMENDED")

    def test_editorial_disabled_blocks_generation(self):
        client = FakeClient(profile=ready_profile(editorial_policy="disabled"))
        provider = FakeProvider([good_set()])
        with self.assertRaises(WorkerError) as ctx:
            S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(ctx.exception.code, "LEARNING_MODE_UNSUPPORTED")
        self.assertEqual(provider.calls, [])

    def test_editorial_override_allows_low_mode(self):
        client = FakeClient(profile=ready_profile(
            content_suitability="none", language_suitability="none",
            recommended_mode="none", editorial_policy="content"))
        provider = FakeProvider([good_set()])
        out = S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(out["status"], "generated")

    def test_one_controlled_repair_then_success(self):
        client = FakeClient(profile=ready_profile())
        provider = FakeProvider([{"flashcards": [], "quiz": []}, good_set()])
        out = S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(len(provider.calls), 2)
        self.assertTrue(provider.calls[1][1])

    def test_insufficient_content_is_a_stable_failure(self):
        client = FakeClient(profile=ready_profile())
        provider = FakeProvider([{"flashcards": [], "quiz": []}, {"flashcards": [], "quiz": []}])
        with self.assertRaises(WorkerError) as ctx:
            S.generate_learning_set_for(client, "vid1", "content", provider=provider)
        self.assertEqual(ctx.exception.code, "LEARNING_INSUFFICIENT_CONTENT")
        self.assertEqual(client.rpc_calls[-1][1]["p_status"], "failed")

    def test_forced_regen_failure_never_touches_valid_ready(self):
        gen_hash = generation_hash(current_hash(), "content",
                                   provider="local_transformers", model="fake-model")
        client = FakeClient(profile=ready_profile(), learning_set={
            "id": "s1", "status": "ready", "content_hash": gen_hash,
            "prompt_version": GEN_PROMPT_VERSION, "schema_version": GEN_SCHEMA_VERSION,
            "flashcard_count": 1, "quiz_count": 1, "generated_at": None})
        provider = FakeProvider([{"flashcards": [], "quiz": []}, {"flashcards": [], "quiz": []}])
        with self.assertRaises(WorkerError):
            S.generate_learning_set_for(client, "vid1", "content", provider=provider, force=True)
        # The still-valid ready set was never flipped to generating/failed.
        self.assertEqual(client.rpc_calls, [])

    def test_unknown_mode_rejected(self):
        client = FakeClient(profile=ready_profile())
        with self.assertRaises(WorkerError) as ctx:
            S.generate_learning_set_for(client, "vid1", "quizzes", provider=FakeProvider([]))
        self.assertEqual(ctx.exception.code, "LEARNING_MODE_UNSUPPORTED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
