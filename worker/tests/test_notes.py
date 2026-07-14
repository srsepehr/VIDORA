"""Tests for the pure Living-Note logic (hash, validation, grounding)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import notes as N  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402
from worker.app.note_config import NOTE_PROMPT_VERSION  # noqa: E402

ROWS = [
    {"segment_index": 0, "start_ms": 0, "end_ms": 9500, "translated_text_fa": "هوش مصنوعی شیوه کار را تغییر می‌دهد"},
    {"segment_index": 1, "start_ms": 9500, "end_ms": 20000, "translated_text_fa": "ابزارهای جدید کارها را ساده می‌کنند"},
    {"segment_index": 2, "start_ms": 20000, "end_ms": 29900, "translated_text_fa": "یادگیری این ابزارها یک مزیت است"},
]

INSIGHT = {
    "status": "ready", "content_hash": "insight-hash-1",
    "short_summary": "ویدیو درباره تاثیر هوش مصنوعی بر کار است.",
    "detailed_summary": "هوش مصنوعی کارها را تغییر می‌دهد و یادگیری ابزارها مزیت می‌سازد.",
    "key_takeaways": [
        {"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
        {"text": "یادگیری ابزارها مزیت است", "segment_indexes": [2]},
    ],
}
CHAPTERS = [{"title": "هوش مصنوعی و کار", "source_segment_indexes": [0, 1, 2]}]
SAVED = [{
    "message_id": "m1", "question": "مهم‌ترین نکته چیست؟", "answer": "یادگیری ابزارهای جدید.",
    "citations": [{"start_ms": 20000, "end_ms": 29900, "source_segment_indexes": [2]}],
}]


def good_payload():
    return {
        "overview": "این ویدیو نشان می‌دهد هوش مصنوعی شیوه کار را دگرگون می‌کند و یادگیری ابزارهای تازه یک مزیت مهم است.",
        "key_points": [
            {"text": "هوش مصنوعی کار را دگرگون می‌کند", "segment_indexes": [0]},
            {"text": "یادگیری ابزارهای جدید مزیت می‌سازد", "segment_indexes": [2]},
        ],
        "action_items": [{"text": "ابزارهای جدید هوش مصنوعی را یاد بگیرید", "segment_indexes": [2]}],
    }


class TestSourceAssembly(unittest.TestCase):
    def test_prepare_segments_maps_and_skips_invalid(self):
        rows = ROWS + [{"segment_index": 3, "start_ms": 5, "end_ms": 5, "translated_text_fa": "x"}]
        seg_map = N.prepare_note_segments(rows)
        self.assertEqual(sorted(seg_map), [0, 1, 2])  # zero-length seg 3 dropped
        self.assertEqual(seg_map[0].start_ms, 0)

    def test_collect_allowed_refs_is_union_within_transcript(self):
        seg_map = N.prepare_note_segments(ROWS)
        refs = N.collect_allowed_refs(INSIGHT, CHAPTERS, SAVED, seg_map)
        self.assertEqual(refs, [0, 1, 2])

    def test_collect_allowed_refs_excludes_missing_segments(self):
        seg_map = N.prepare_note_segments(ROWS[:1])  # only segment 0 exists
        refs = N.collect_allowed_refs(INSIGHT, CHAPTERS, SAVED, seg_map)
        self.assertEqual(refs, [0])

    def test_has_source_material(self):
        self.assertTrue(N.has_source_material(INSIGHT, []))
        self.assertTrue(N.has_source_material({}, SAVED))
        self.assertFalse(N.has_source_material({}, []))
        self.assertFalse(N.has_source_material({"short_summary": "", "key_takeaways": []}, []))


class TestHash(unittest.TestCase):
    def test_saved_fingerprints_are_order_independent(self):
        a = N.saved_answer_fingerprints(SAVED)
        two = SAVED + [{"message_id": "m2", "question": "q", "answer": "پاسخ دوم", "citations": []}]
        b = N.saved_answer_fingerprints(list(reversed(two)))
        c = N.saved_answer_fingerprints(two)
        self.assertEqual(b, c)
        self.assertNotEqual(a, c)

    def test_content_hash_changes_with_inputs_and_version(self):
        fps = N.saved_answer_fingerprints(SAVED)
        base = N.note_content_hash("v1", "u1", "insight-hash-1", fps)
        self.assertEqual(base, N.note_content_hash("v1", "u1", "insight-hash-1", fps))  # stable
        self.assertNotEqual(base, N.note_content_hash("v1", "u1", "insight-hash-2", fps))
        self.assertNotEqual(base, N.note_content_hash("v1", "u2", "insight-hash-1", fps))
        self.assertNotEqual(base, N.note_content_hash("v1", "u1", "insight-hash-1", fps, prompt_version="note-pX"))
        self.assertNotEqual(base, N.note_content_hash("v1", "u1", "insight-hash-1", []))


class TestPrompt(unittest.TestCase):
    def test_user_message_lists_indexes_and_material(self):
        seg_map = N.prepare_note_segments(ROWS)
        refs = N.collect_allowed_refs(INSIGHT, CHAPTERS, SAVED, seg_map)
        msg = N.build_note_user_message(INSIGHT, CHAPTERS, SAVED, refs, seg_map, title="نمونه")
        self.assertIn("خلاصه کوتاه موجود", msg)
        self.assertIn("پرسش و پاسخ‌های ذخیره‌شده", msg)
        self.assertIn("[بخش‌ها:", msg)
        self.assertIn("[2]", msg)  # grounding text for a referenced segment

    def test_user_message_respects_char_budget(self):
        seg_map = N.prepare_note_segments(ROWS)
        refs = N.collect_allowed_refs(INSIGHT, CHAPTERS, SAVED, seg_map)
        from worker.app.note_config import NoteConfig
        tiny = NoteConfig(max_input_chars=10)
        msg = N.build_note_user_message(INSIGHT, CHAPTERS, SAVED, refs, seg_map, config=tiny)
        # The grounding-text section is budget-limited but summaries still appear.
        self.assertIn("خلاصه کوتاه موجود", msg)


class TestValidation(unittest.TestCase):
    def setUp(self):
        self.seg_map = N.prepare_note_segments(ROWS)
        self.refs = N.collect_allowed_refs(INSIGHT, CHAPTERS, SAVED, self.seg_map)

    def test_valid_payload_grounds_citations(self):
        result = N.validate_note_payload(good_payload(), self.refs, self.seg_map)
        self.assertGreaterEqual(len(result.overview), 20)
        self.assertEqual(len(result.key_points), 2)
        self.assertEqual(len(result.action_items), 1)
        # Citation maps to real segment boundaries, not model numbers.
        cite = result.key_points[1].citations[0]
        self.assertEqual(cite.segment_indexes, [2])
        self.assertEqual((cite.start_ms, cite.end_ms), (20000, 29900))

    def test_overview_not_persian_rejected(self):
        payload = good_payload()
        payload["overview"] = "this overview is entirely english text only here"
        with self.assertRaises(WorkerError) as ctx:
            N.validate_note_payload(payload, self.refs, self.seg_map)
        self.assertEqual(ctx.exception.code, "NOTE_INVALID_OUTPUT")

    def test_no_valid_key_points_rejected(self):
        payload = good_payload()
        payload["key_points"] = [{"text": "only english point", "segment_indexes": [0]}]
        with self.assertRaises(WorkerError) as ctx:
            N.validate_note_payload(payload, self.refs, self.seg_map)
        self.assertEqual(ctx.exception.code, "NOTE_INVALID_OUTPUT")

    def test_invalid_refs_are_dropped_not_fabricated(self):
        payload = good_payload()
        payload["key_points"][0]["segment_indexes"] = [99]  # not a real segment
        result = N.validate_note_payload(payload, self.refs, self.seg_map)
        self.assertEqual(result.key_points[0].citations, [])  # no seek, never fabricated

    def test_action_items_optional(self):
        payload = good_payload()
        payload["action_items"] = []
        result = N.validate_note_payload(payload, self.refs, self.seg_map)
        self.assertEqual(result.action_items, [])

    def test_near_duplicate_points_deduped(self):
        payload = good_payload()
        payload["key_points"].append({"text": "هوش مصنوعی کار را دگرگون می‌کند", "segment_indexes": [0]})
        result = N.validate_note_payload(payload, self.refs, self.seg_map)
        self.assertEqual(len(result.key_points), 2)  # duplicate dropped
        self.assertTrue(result.warnings)

    def test_rpc_serialization_shape(self):
        result = N.validate_note_payload(good_payload(), self.refs, self.seg_map)
        rpc = N.result_to_rpc_items(result.key_points)
        self.assertEqual(rpc[1]["citations"][0]["source_segment_indexes"], [2])
        self.assertIn("text", rpc[0])
        # PROMPT_VERSION is imported to assert the module wiring stays intact.
        self.assertTrue(NOTE_PROMPT_VERSION)


if __name__ == "__main__":
    unittest.main(verbosity=2)
