"""Unit tests for the pure insight logic (no models, no network, no DB)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import insights as I  # noqa: E402
from worker.app.insight_config import DEFAULT_INSIGHT_CONFIG, InsightConfig  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402


def seg(i, s, e, fa, src=""):
    return I.InsightSegment(i, s, e, fa, src)


SEGS = [
    seg(0, 0, 9500, "هوش مصنوعی در حال تغییر شیوه کار ماست", "AI is changing how we work"),
    seg(1, 9500, 20000, "ابزارهای جدید کارهای پیچیده را ساده‌تر می‌کنند", "New tools simplify complex tasks"),
    seg(2, 20000, 29900, "یادگیری این ابزارها یک مزیت رقابتی بزرگ است", "Learning these tools is a big advantage"),
]


def valid_payload():
    return {
        "short_summary": "این ویدیو درباره تاثیر هوش مصنوعی بر کار و اهمیت یادگیری ابزارهای جدید است.",
        "detailed_summary": "ویدیو توضیح می‌دهد که هوش مصنوعی شیوه کار را تغییر داده، ابزارهای جدید کارهای پیچیده را ساده می‌کنند و یادگیری آن‌ها مزیت رقابتی ایجاد می‌کند.",
        "key_takeaways": [
            {"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
            {"text": "یادگیری ابزارهای جدید مزیت رقابتی است", "segment_indexes": [2]},
        ],
        "chapters": [
            {"title": "تاثیر هوش مصنوعی بر کار", "description": "", "segment_indexes": [0, 1, 2]},
        ],
    }


class TestHashing(unittest.TestCase):
    def test_deterministic_and_sensitive(self):
        kw = dict(provider="local_transformers", model="qwen")
        h1 = I.content_hash("v1", SEGS, **kw)
        h2 = I.content_hash("v1", list(reversed(SEGS)), **kw)  # order-independent canonicalization
        self.assertEqual(h1, h2)
        changed = [seg(0, 0, 9500, "متن تغییر کرده"), *SEGS[1:]]
        self.assertNotEqual(h1, I.content_hash("v1", changed, **kw))
        self.assertNotEqual(h1, I.content_hash("v2", SEGS, **kw))
        self.assertNotEqual(h1, I.content_hash("v1", SEGS, provider="local_transformers", model="other-model"))
        self.assertNotEqual(h1, I.content_hash("v1", SEGS, **kw, prompt_version="ins-p999"))
        self.assertNotEqual(h1, I.content_hash("v1", SEGS, **kw, schema_version="ins-s999"))


class TestPrepareSegments(unittest.TestCase):
    def test_rejects_empty_and_incomplete(self):
        with self.assertRaises(WorkerError) as ctx:
            I.prepare_segments([])
        self.assertEqual(ctx.exception.code, "INSIGHT_TRANSCRIPT_MISSING")
        rows = [{"segment_index": 0, "start_ms": 0, "end_ms": 1000, "translated_text_fa": "  "}]
        with self.assertRaises(WorkerError) as ctx:
            I.prepare_segments(rows)
        self.assertEqual(ctx.exception.code, "INSIGHT_TRANSLATION_INCOMPLETE")

    def test_orders_chronologically(self):
        rows = [
            {"segment_index": 1, "start_ms": 5000, "end_ms": 9000, "translated_text_fa": "دوم"},
            {"segment_index": 0, "start_ms": 0, "end_ms": 5000, "translated_text_fa": "اول"},
        ]
        out = I.prepare_segments(rows)
        self.assertEqual([s.segment_index for s in out], [0, 1])


class TestChunking(unittest.TestCase):
    def test_direct_path_for_short_input(self):
        self.assertFalse(I.needs_hierarchical(SEGS))

    def test_chunks_never_split_or_drop_segments(self):
        cfg = InsightConfig(chunk_chars=120)
        many = [seg(i, i * 1000, (i + 1) * 1000, "جمله شماره " + "متن " * 10) for i in range(12)]
        chunks = I.plan_chunks(many, cfg)
        self.assertGreater(len(chunks), 1)
        flat = [s.segment_index for c in chunks for s in c]
        self.assertEqual(flat, list(range(12)))  # order + completeness (no truncation)
        # chronological boundaries
        for a, b in zip(chunks, chunks[1:]):
            self.assertLess(a[-1].segment_index, b[0].segment_index)

    def test_absurd_input_rejected(self):
        cfg = InsightConfig(max_total_input_chars=100)
        with self.assertRaises(WorkerError) as ctx:
            I.plan_chunks(SEGS, cfg)
        self.assertEqual(ctx.exception.code, "INSIGHT_TRANSCRIPT_TOO_LARGE")


class TestPersianCheck(unittest.TestCase):
    def test_persian_accepted_latin_terms_allowed(self):
        self.assertTrue(I.is_mostly_persian("یادگیری ابزار API در پایتون"))
        self.assertTrue(I.is_mostly_persian("خلاصه ویدیو"))

    def test_english_rejected(self):
        self.assertFalse(I.is_mostly_persian("This video is about AI tools"))
        self.assertFalse(I.is_mostly_persian(""))


class TestValidation(unittest.TestCase):
    def test_valid_payload_passes(self):
        result = I.validate_insight_payload(valid_payload(), SEGS, duration_ms=29923)
        self.assertEqual(result.language, "fa")
        self.assertEqual(len(result.takeaways), 2)
        self.assertEqual(len(result.chapters), 1)
        chapter = result.chapters[0]
        self.assertEqual(chapter.index, 0)
        self.assertEqual(chapter.start_ms, 0)      # derived from segment 0
        self.assertEqual(chapter.end_ms, 29900)    # derived from segment 2, under duration
        self.assertEqual(chapter.segment_indexes, [0, 1, 2])

    def test_missing_summary_rejected(self):
        payload = valid_payload(); payload["short_summary"] = "  "
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_INVALID_OUTPUT")

    def test_english_summary_rejected(self):
        payload = valid_payload(); payload["short_summary"] = "This video explains AI tools."
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_INVALID_OUTPUT")

    def test_unknown_segment_ref_rejected(self):
        payload = valid_payload(); payload["key_takeaways"][0]["segment_indexes"] = [42]
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_GROUNDING_FAILED")

    def test_empty_takeaways_rejected(self):
        payload = valid_payload(); payload["key_takeaways"] = []
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_INVALID_OUTPUT")

    def test_duplicate_takeaways_removed(self):
        payload = valid_payload()
        payload["key_takeaways"].append({"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد.", "segment_indexes": [0]})
        result = I.validate_insight_payload(payload, SEGS, duration_ms=29923)
        self.assertEqual(len(result.takeaways), 2)
        self.assertTrue(any("duplicate" in w for w in result.warnings))

    def test_chapter_segment_reuse_rejected(self):
        payload = valid_payload()
        payload["chapters"] = [
            {"title": "بخش اول", "segment_indexes": [0, 1]},
            {"title": "بخش دوم", "segment_indexes": [1, 2]},
        ]
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_CHAPTERS_INVALID")

    def test_chapter_count_cannot_exceed_segments(self):
        payload = valid_payload()
        payload["chapters"] = [{"title": f"بخش {i}", "segment_indexes": [i % 3]} for i in range(4)]
        with self.assertRaises(WorkerError) as ctx:
            I.validate_insight_payload(payload, SEGS)
        self.assertEqual(ctx.exception.code, "INSIGHT_CHAPTERS_INVALID")

    def test_two_chapters_chronological_no_overlap(self):
        payload = valid_payload()
        payload["chapters"] = [
            {"title": "مقدمه", "segment_indexes": [0]},
            {"title": "جمع‌بندی", "segment_indexes": [1, 2]},
        ]
        result = I.validate_insight_payload(payload, SEGS, duration_ms=29923)
        self.assertEqual([c.index for c in result.chapters], [0, 1])
        self.assertEqual(result.chapters[0].end_ms, 9500)
        self.assertEqual(result.chapters[1].start_ms, 9500)
        self.assertLessEqual(result.chapters[0].end_ms, result.chapters[1].start_ms)

    def test_chapter_end_clamped_to_duration(self):
        result = I.validate_insight_payload(valid_payload(), SEGS, duration_ms=25000)
        self.assertEqual(result.chapters[0].end_ms, 25000)

    def test_uncovered_segments_warn_but_pass(self):
        payload = valid_payload()
        payload["chapters"] = [{"title": "مقدمه", "segment_indexes": [0]}]
        result = I.validate_insight_payload(payload, SEGS, duration_ms=29923)
        self.assertTrue(any("not covered" in w for w in result.warnings))

    def test_persian_unicode_preserved(self):
        result = I.validate_insight_payload(valid_payload(), SEGS, duration_ms=29923)
        self.assertIn("هوش مصنوعی", result.short_summary)
        self.assertIn("«", "«نمونه»")  # sanity: persian punctuation intact in source strings


class TestChunkPayloadValidation(unittest.TestCase):
    def test_valid_chunk(self):
        chunk = SEGS[:2]
        payload = {"chunk_summary": "این بخش درباره تغییر شیوه کار است.",
                   "topics": [{"title": "تغییر شیوه کار", "segment_indexes": [0, 1]}]}
        out = I.validate_chunk_payload(payload, chunk)
        self.assertEqual(out["segment_indexes"], [0, 1])
        self.assertEqual(out["topics"][0]["segment_indexes"], [0, 1])

    def test_chunk_ref_outside_chunk_rejected(self):
        payload = {"chunk_summary": "خلاصه بخش.", "topics": [{"title": "عنوان", "segment_indexes": [2]}]}
        with self.assertRaises(WorkerError) as ctx:
            I.validate_chunk_payload(payload, SEGS[:2])
        self.assertEqual(ctx.exception.code, "INSIGHT_GROUNDING_FAILED")


if __name__ == "__main__":
    unittest.main(verbosity=2)
