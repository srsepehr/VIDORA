import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import chat_index as C
from worker.app.errors import WorkerError


ROWS = [
    {"id": "s0", "segment_index": 0, "start_ms": 0, "end_ms": 9000,
     "source_text": "A minimum viable product helps us learn quickly.",
     "translated_text_fa": "محصول اولیه به ما کمک می‌کند سریع یاد بگیریم."},
    {"id": "s1", "segment_index": 1, "start_ms": 9000, "end_ms": 19000,
     "source_text": "Talk to users before adding features.",
     "translated_text_fa": "پیش از افزودن قابلیت‌ها با کاربران صحبت کنید."},
    {"id": "s2", "segment_index": 2, "start_ms": 19000, "end_ms": 29000,
     "source_text": "Measure behavior and iterate.",
     "translated_text_fa": "رفتار را اندازه بگیرید و محصول را بهبود دهید."},
]


class ChatCoreTests(unittest.TestCase):
    def setUp(self):
        self.segments = C.prepare_chat_segments(ROWS)

    def test_short_video_is_one_stable_chunk(self):
        a = C.build_chat_chunks(self.segments, 1800)
        b = C.build_chat_chunks(self.segments, 1800)
        self.assertEqual(a, b)
        self.assertEqual(len(a), 1)
        self.assertEqual(a[0].segment_indexes, [0, 1, 2])
        self.assertEqual((a[0].start_ms, a[0].end_ms), (0, 29000))

    def test_long_input_makes_chronological_chunks_without_loss(self):
        chunks = C.build_chat_chunks(self.segments, 90)
        self.assertGreater(len(chunks), 1)
        self.assertEqual([x for chunk in chunks for x in chunk.segment_indexes], [0, 1, 2])
        self.assertEqual([c.chunk_index for c in chunks], list(range(len(chunks))))

    def test_incomplete_translation_rejected(self):
        with self.assertRaises(WorkerError) as ctx:
            C.prepare_chat_segments([{**ROWS[0], "translated_text_fa": ""}])
        self.assertEqual(ctx.exception.code, "CHAT_TRANSLATION_INCOMPLETE")

    def test_hash_is_stable_and_changes_with_transcript(self):
        first = C.canonical_index_hash("v1", self.segments)
        self.assertEqual(first, C.canonical_index_hash("v1", self.segments))
        changed = C.prepare_chat_segments([{**ROWS[0], "translated_text_fa": "متن تغییر کرد"}, *ROWS[1:]])
        self.assertNotEqual(first, C.canonical_index_hash("v1", changed))

    def test_hash_changes_with_chunk_configuration(self):
        self.assertNotEqual(C.canonical_index_hash("v1", self.segments, target_chars=100),
                            C.canonical_index_hash("v1", self.segments, target_chars=200))

    def test_lexical_retrieval_supports_english_term(self):
        chunk = {"text_fa": "محصول اولیه", "source_text": "minimum viable product MVP"}
        self.assertGreater(C.lexical_score("MVP چیست؟", chunk), 0)

    def test_merge_retrieval_is_stable_and_deduplicated(self):
        semantic = [{"id": "a", "chunk_index": 1, "score": .8}, {"id": "b", "chunk_index": 0, "score": .8}]
        lexical = [{"id": "a", "chunk_index": 1, "score": .9}]
        out = C.merge_retrieval(semantic, lexical, 5)
        self.assertEqual([r["id"] for r in out], ["a", "b"])

    def _evidence(self):
        return [{"id": "c0", "chunk_index": 0, "start_ms": 0, "end_ms": 29000,
                 "source_segment_indexes": [0, 1, 2], "text_fa": "x", "source_text": ""}]

    def test_grounded_answer_maps_server_timestamps(self):
        payload = {"answer": "گوینده بر گفت‌وگو با کاربران تأکید می‌کند.", "not_in_video": False,
                   "citations": [{"segment_indexes": [1]}], "suggested_followups": []}
        out = C.validate_chat_payload(payload, self._evidence(), ROWS)
        self.assertEqual(out["citations"][0]["start_ms"], 9000)
        self.assertEqual(out["citations"][0]["end_ms"], 19000)

    def test_arbitrary_model_timestamp_is_ignored(self):
        payload = {"answer": "این پاسخ از متن ویدیو پشتیبانی می‌شود.", "not_in_video": False,
                   "citations": [{"segment_indexes": [0], "start_ms": 999999}], "suggested_followups": []}
        out = C.validate_chat_payload(payload, self._evidence(), ROWS)
        self.assertEqual(out["citations"][0]["start_ms"], 0)

    def test_cross_evidence_reference_rejected(self):
        evidence = [{**self._evidence()[0], "source_segment_indexes": [0]}]
        payload = {"answer": "پاسخ فارسی کافی است.", "not_in_video": False,
                   "citations": [{"segment_indexes": [2]}]}
        with self.assertRaises(WorkerError) as ctx:
            C.validate_chat_payload(payload, evidence, ROWS)
        self.assertEqual(ctx.exception.code, "CHAT_GROUNDING_FAILED")

    def test_duplicate_citations_removed(self):
        payload = {"answer": "پاسخ فارسی کافی و روشن است.", "not_in_video": False,
                   "citations": [{"segment_indexes": [0]}, {"segment_indexes": [0]}]}
        out = C.validate_chat_payload(payload, self._evidence(), ROWS)
        self.assertEqual(len(out["citations"]), 1)

    def test_grounded_answer_requires_citation(self):
        with self.assertRaises(WorkerError):
            C.validate_chat_payload({"answer": "پاسخ فارسی روشن است.", "not_in_video": False,
                                     "citations": []}, self._evidence(), ROWS)

    def test_not_in_video_has_no_citations(self):
        out = C.validate_chat_payload({"answer": "این موضوع در متن ویدیو نیست.", "not_in_video": True,
                                       "citations": [{"segment_indexes": [0]}]}, self._evidence(), ROWS)
        self.assertTrue(out["not_in_video"])
        self.assertEqual(out["citations"], [])

    def test_followups_are_bounded(self):
        payload = {"answer": "پاسخ فارسی روشن و مستند است.", "not_in_video": False,
                   "citations": [{"segment_indexes": [0]}],
                   "suggested_followups": ["یک", "دو", "سه", "چهار"]}
        self.assertEqual(len(C.validate_chat_payload(payload, self._evidence(), ROWS)["suggested_followups"]), 3)


if __name__ == "__main__":
    unittest.main(verbosity=2)
