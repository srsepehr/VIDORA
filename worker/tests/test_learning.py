"""Tests for the pure adaptive-learning logic (guards, hashes, validation)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import learning as L  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402
from worker.app.learning_config import LearningConfig  # noqa: E402

FA = "هوش مصنوعی شیوه کار را تغییر می‌دهد و یادگیری ابزارهای جدید یک مزیت رقابتی است"


def rows(n=3, fa=True, source=True, fa_text=FA):
    return [
        {"segment_index": i, "start_ms": i * 10000, "end_ms": (i + 1) * 10000,
         "source_text": f"artificial intelligence changes how we work part {i}" if source else "",
         "translated_text_fa": f"{fa_text} {i}" if fa else ""}
        for i in range(n)
    ]


def good_assessment():
    return {
        "content_kind": "conceptual",
        "content_suitability": "high",
        "language_suitability": "high",
        "reason_code": "MEANINGFUL_CONCEPTS_AND_LANGUAGE",
        "teachable_points": [
            {"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
            {"text": "یادگیری ابزارهای جدید مزیت رقابتی است", "segment_indexes": [2]},
        ],
    }


def good_set():
    return {
        "flashcards": [
            {"learning_mode": "content", "front": "هوش مصنوعی چه تاثیری بر کار دارد؟",
             "back": "شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
            {"learning_mode": "language", "front": "artificial intelligence",
             "back": "هوش مصنوعی", "segment_indexes": [0]},
        ],
        "quiz": [
            {"learning_mode": "content", "question": "طبق ویدیو، مزیت رقابتی چیست؟",
             "choices": ["یادگیری ابزارهای جدید", "خرید سخت‌افزار قوی", "استخدام بیشتر"],
             "correct_choice_index": 0,
             "explanation": "ویدیو یادگیری ابزارهای جدید را مزیت رقابتی می‌داند.",
             "segment_indexes": [2]},
        ],
    }


class TestPreparation(unittest.TestCase):
    def test_prepare_reports_completeness(self):
        mixed = rows(4)
        mixed[3]["translated_text_fa"] = ""
        segments, stats = L.prepare_learning_segments(mixed)
        self.assertEqual(stats.total_segments, 4)
        self.assertEqual(stats.translated_segments, 3)
        self.assertEqual(stats.duration_ms, 40000)
        self.assertEqual(len(segments), 4)  # tolerant, no raise

    def test_empty_transcript_raises(self):
        with self.assertRaises(WorkerError) as ctx:
            L.prepare_learning_segments([])
        self.assertEqual(ctx.exception.code, "LEARNING_TRANSCRIPT_MISSING")


class TestDeterministicGuards(unittest.TestCase):
    def test_incomplete_translation_classified_without_model(self):
        segments, stats = L.prepare_learning_segments(rows(4, fa=False))
        result = L.deterministic_preassessment(stats)
        self.assertIsNotNone(result)
        self.assertEqual(result.recommended_mode, "none")
        self.assertEqual(result.reason_code, "INCOMPLETE_TRANSCRIPT")
        self.assertEqual(result.source, "deterministic")

    def test_too_short_classified_without_model(self):
        segments, stats = L.prepare_learning_segments(rows(1, fa_text="سلام"))
        result = L.deterministic_preassessment(stats)
        self.assertIsNotNone(result)
        self.assertEqual(result.reason_code, "TOO_SHORT")

    def test_useful_video_needs_the_model(self):
        segments, stats = L.prepare_learning_segments(rows(3))
        self.assertIsNone(L.deterministic_preassessment(stats))


class TestHashes(unittest.TestCase):
    def test_assessment_hash_stable_and_sensitive(self):
        segments, _ = L.prepare_learning_segments(rows(3))
        base = L.assessment_hash("v1", segments)
        self.assertEqual(base, L.assessment_hash("v1", segments))
        segments2, _ = L.prepare_learning_segments(rows(4))
        self.assertNotEqual(base, L.assessment_hash("v1", segments2))
        self.assertNotEqual(base, L.assessment_hash("v2", segments))
        self.assertNotEqual(base, L.assessment_hash("v1", segments, prompt_version="lrn-aX"))

    def test_generation_hash_depends_on_mode_and_versions(self):
        base = L.generation_hash("assess-hash", "content")
        self.assertEqual(base, L.generation_hash("assess-hash", "content"))
        self.assertNotEqual(base, L.generation_hash("assess-hash", "language"))
        self.assertNotEqual(base, L.generation_hash("other-hash", "content"))
        self.assertNotEqual(base, L.generation_hash("assess-hash", "content", prompt_version="lrn-gX"))


class TestAssessmentValidation(unittest.TestCase):
    def setUp(self):
        self.segments, self.stats = L.prepare_learning_segments(rows(3))

    def test_valid_assessment_grounds_points(self):
        result = L.validate_assessment_payload(good_assessment(), self.segments, self.stats)
        self.assertEqual(result.recommended_mode, "both")
        self.assertEqual(len(result.teachable_points), 2)
        self.assertEqual(result.source, "model")

    def test_recommendation_is_derived_not_trusted(self):
        payload = good_assessment()
        payload["recommended_mode"] = "none"  # the model's own vote is ignored
        result = L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(result.recommended_mode, "both")

    def test_high_content_clamped_without_grounded_points(self):
        payload = good_assessment()
        payload["teachable_points"] = [
            {"text": "نکته‌ای بدون مرجع معتبر", "segment_indexes": [99]}]
        result = L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(result.content_suitability, "low")
        self.assertEqual(result.teachable_points, [])
        self.assertTrue(result.warnings)

    def test_language_clamped_without_source_text(self):
        segments, stats = L.prepare_learning_segments(rows(3, source=False))
        result = L.validate_assessment_payload(good_assessment(), segments, stats)
        self.assertEqual(result.language_suitability, "none")

    def test_entertainment_content_clamped_to_low(self):
        payload = good_assessment()
        payload["content_kind"] = "entertainment"
        result = L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(result.content_suitability, "low")
        # Language practice can still be recommended for an entertainment video.
        self.assertEqual(result.recommended_mode, "language")

    def test_opinion_content_capped_at_medium(self):
        payload = good_assessment()
        payload["content_kind"] = "opinion"
        result = L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(result.content_suitability, "medium")

    def test_low_everything_derives_none(self):
        payload = good_assessment()
        payload["content_suitability"] = "low"
        payload["language_suitability"] = "low"
        result = L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(result.recommended_mode, "none")

    def test_invalid_enum_rejected(self):
        payload = good_assessment()
        payload["content_kind"] = "amazing"
        with self.assertRaises(WorkerError) as ctx:
            L.validate_assessment_payload(payload, self.segments, self.stats)
        self.assertEqual(ctx.exception.code, "LEARNING_INVALID_OUTPUT")


class TestSupportedModes(unittest.TestCase):
    def test_auto_policy_follows_suitabilities(self):
        profile = {"editorial_policy": "auto", "content_suitability": "medium",
                   "language_suitability": "none"}
        self.assertEqual(L.supported_modes(profile), ["content"])
        profile["language_suitability"] = "low"  # low stays user-selectable
        self.assertEqual(L.supported_modes(profile), ["content", "language", "both"])

    def test_disabled_policy_offers_nothing(self):
        profile = {"editorial_policy": "disabled", "content_suitability": "high",
                   "language_suitability": "high"}
        self.assertEqual(L.supported_modes(profile), [])

    def test_explicit_editorial_policy_overrides(self):
        profile = {"editorial_policy": "language", "content_suitability": "high",
                   "language_suitability": "none"}
        self.assertEqual(L.supported_modes(profile), ["language"])


class TestSetValidation(unittest.TestCase):
    def setUp(self):
        self.segments, self.stats = L.prepare_learning_segments(rows(3))

    def test_valid_set_grounds_citations_server_side(self):
        result = L.validate_learning_set_payload(good_set(), "both", self.segments, self.stats)
        self.assertEqual(result.flashcard_count, 2)
        self.assertEqual(result.quiz_count, 1)
        quiz = [i for i in result.items if i.item_type == "multiple_choice"][0]
        # Citation span derived from real segment boundaries, not model numbers.
        self.assertEqual((quiz.start_ms, quiz.end_ms), (20000, 30000))

    def test_language_phrase_must_appear_in_transcript(self):
        payload = good_set()
        payload["flashcards"][1]["front"] = "supercalifragilistic"  # invented vocabulary
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.flashcard_count, 1)
        self.assertTrue(any("not in the transcript" in w for w in result.warnings))

    def test_ungrounded_item_dropped(self):
        payload = good_set()
        payload["quiz"][0]["segment_indexes"] = [99]
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.quiz_count, 0)

    def test_mode_scoping_drops_out_of_mode_items(self):
        result = L.validate_learning_set_payload(good_set(), "content", self.segments, self.stats)
        self.assertEqual(result.flashcard_count, 1)  # the language card is dropped
        self.assertTrue(all(i.learning_mode == "content" for i in result.items))

    def test_duplicate_choices_rejected(self):
        payload = good_set()
        payload["quiz"][0]["choices"] = ["یادگیری ابزارهای جدید", "یادگیری ابزارهای جدید", "استخدام"]
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.quiz_count, 0)

    def test_catch_all_choice_rejected(self):
        payload = good_set()
        payload["quiz"][0]["choices"] = ["یادگیری ابزارها", "همه موارد", "استخدام"]
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.quiz_count, 0)

    def test_out_of_range_correct_index_rejected(self):
        payload = good_set()
        payload["quiz"][0]["correct_choice_index"] = 9
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.quiz_count, 0)

    def test_near_duplicate_flashcards_deduped(self):
        payload = good_set()
        payload["flashcards"].append(dict(payload["flashcards"][0]))
        result = L.validate_learning_set_payload(payload, "both", self.segments, self.stats)
        self.assertEqual(result.flashcard_count, 2)

    def test_short_video_ceilings_apply(self):
        segments, stats = L.prepare_learning_segments(rows(2, fa_text="جمله کوتاه اما مفید"))
        self.assertLess(stats.fa_chars, 800)
        payload = {"flashcards": [
            {"learning_mode": "content", "front": f"سؤال شماره {i} درباره مفهوم", "back": "پاسخ فارسی",
             "segment_indexes": [0]} for i in range(6)], "quiz": []}
        result = L.validate_learning_set_payload(payload, "content", segments, stats)
        self.assertLessEqual(result.flashcard_count, 3)  # short-video ceiling

    def test_no_forced_minimum_single_item_is_valid(self):
        payload = {"flashcards": [good_set()["flashcards"][0]], "quiz": []}
        result = L.validate_learning_set_payload(payload, "content", self.segments, self.stats)
        self.assertEqual(result.flashcard_count, 1)
        self.assertEqual(result.quiz_count, 0)

    def test_nothing_valid_raises_insufficient(self):
        payload = {"flashcards": [], "quiz": []}
        with self.assertRaises(WorkerError) as ctx:
            L.validate_learning_set_payload(payload, "content", self.segments, self.stats)
        self.assertEqual(ctx.exception.code, "LEARNING_INSUFFICIENT_CONTENT")

    def test_rpc_serialization_shape(self):
        result = L.validate_learning_set_payload(good_set(), "both", self.segments, self.stats)
        items = L.items_to_rpc(result)
        self.assertEqual(items[0]["item_index"], 0)
        quiz = [i for i in items if i["item_type"] == "multiple_choice"][0]
        self.assertEqual(quiz["correct_choice_index"], 0)
        self.assertEqual(quiz["source_segment_indexes"], [2])


if __name__ == "__main__":
    unittest.main(verbosity=2)
