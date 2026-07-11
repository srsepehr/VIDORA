"""Tests for insight-generation orchestration (fake client + provider)."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import insight_generation as G  # noqa: E402
from worker.app.insight_config import InsightConfig, PROMPT_VERSION, SCHEMA_VERSION  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402

CFG = types.SimpleNamespace(insight_model="fake-model", stt_download_root=None)

ROWS = [
    {"segment_index": 0, "start_ms": 0, "end_ms": 9500,
     "source_text": "AI is changing how we work",
     "translated_text_fa": "هوش مصنوعی در حال تغییر شیوه کار ماست"},
    {"segment_index": 1, "start_ms": 9500, "end_ms": 20000,
     "source_text": "New tools simplify complex tasks",
     "translated_text_fa": "ابزارهای جدید کارهای پیچیده را ساده‌تر می‌کنند"},
    {"segment_index": 2, "start_ms": 20000, "end_ms": 29900,
     "source_text": "Learning these tools is an advantage",
     "translated_text_fa": "یادگیری این ابزارها یک مزیت رقابتی بزرگ است"},
]


def good_payload():
    return {
        "short_summary": "ویدیو درباره تاثیر هوش مصنوعی بر کار و اهمیت یادگیری ابزارهای جدید است.",
        "detailed_summary": "هوش مصنوعی شیوه کار را تغییر داده است، ابزارهای جدید کارها را ساده می‌کنند و یادگیری آن‌ها مزیت رقابتی می‌سازد.",
        "key_takeaways": [
            {"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]},
            {"text": "یادگیری ابزارهای جدید مزیت رقابتی است", "segment_indexes": [2]},
        ],
        "chapters": [{"title": "هوش مصنوعی و کار", "description": "", "segment_indexes": [0, 1, 2]}],
    }


class FakeProvider:
    name = "local_transformers"
    model_id = "fake-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []  # (system_prefix, has_correction)
        self.corrections = []

    def complete_json(self, system, user, correction=None):
        self.calls.append((system[:40], bool(correction)))
        self.corrections.append(correction)
        if not self.outputs:
            raise WorkerError("INSIGHT_PROVIDER_UNAVAILABLE", dev_detail="no more fake outputs")
        return self.outputs.pop(0)

    def health_check(self):
        from worker.app.insight_provider import ProviderHealth
        return ProviderHealth(ok=True)


class FakeClient:
    def __init__(self, rows=ROWS, existing_insight=None, chapters=None):
        self.video = {"id": "vid1", "user_id": "owner1", "title": "نمونه",
                      "original_filename": "clip.mp4", "duration_seconds": 29.923}
        self.rows = rows
        self.existing_insight = existing_insight
        self.chapters = chapters or []
        self.rpc_calls = []

    def select_one(self, table, query):
        if table == "videos":
            return dict(self.video)
        if table == "video_insights":
            return dict(self.existing_insight) if self.existing_insight else None
        return None

    def select_many(self, table, query):
        if table == "transcript_segments":
            return [dict(r) for r in self.rows]
        if table == "video_chapters":
            return [dict(c) for c in self.chapters]
        return []

    def rpc(self, fn, params):
        self.rpc_calls.append((fn, params))
        return None


class TestOrchestration(unittest.TestCase):
    def test_generates_validates_and_persists(self):
        client = FakeClient()
        provider = FakeProvider([good_payload()])
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(out["segment_count"], 3)
        self.assertEqual(out["takeaway_count"], 2)
        self.assertEqual(out["chapter_count"], 1)
        self.assertEqual(out["chapter_ranges_ms"], [[0, 29900]])
        # No generated content in the structural result.
        self.assertNotIn("هوش", str(out))
        names = [name for name, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_insight_status", "persist_video_insight"])
        persist = client.rpc_calls[1][1]
        self.assertEqual(persist["p_prompt_version"], PROMPT_VERSION)
        self.assertEqual(persist["p_schema_version"], SCHEMA_VERSION)
        self.assertEqual(len(persist["p_chapters"]), 1)
        self.assertEqual(persist["p_chapters"][0]["start_ms"], 0)
        self.assertEqual(persist["p_chapters"][0]["end_ms"], 29900)

    def test_reuses_matching_ready_result(self):
        client = FakeClient()
        provider = FakeProvider([])  # would raise if called
        from worker.app.insights import prepare_segments, content_hash
        segs = prepare_segments(ROWS)
        h = content_hash("vid1", segs, provider=provider.name, model=provider.model_id)
        client.existing_insight = {"id": "i1", "status": "ready", "content_hash": h,
                                   "prompt_version": PROMPT_VERSION, "schema_version": SCHEMA_VERSION}
        client.chapters = [{"start_ms": 0, "end_ms": 29900}]
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(out["status"], "reused")
        self.assertEqual(provider.calls, [])
        self.assertEqual(client.rpc_calls, [])  # pure no-op

    def test_stale_marked_when_hash_differs(self):
        client = FakeClient()
        client.existing_insight = {"id": "i1", "status": "ready", "content_hash": "oldhash",
                                   "prompt_version": PROMPT_VERSION, "schema_version": SCHEMA_VERSION}
        provider = FakeProvider([good_payload()])
        G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        names = [name for name, _ in client.rpc_calls]
        self.assertEqual(names, ["mark_video_insights_stale", "set_video_insight_status", "persist_video_insight"])

    def test_version_change_invalidates_reuse(self):
        client = FakeClient()
        from worker.app.insights import prepare_segments, content_hash
        segs = prepare_segments(ROWS)
        h = content_hash("vid1", segs, provider="local_transformers", model="fake-model")
        client.existing_insight = {"id": "i1", "status": "ready", "content_hash": h,
                                   "prompt_version": "ins-p0", "schema_version": SCHEMA_VERSION}
        provider = FakeProvider([good_payload()])
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(out["status"], "generated")

    def test_one_controlled_repair_then_success(self):
        client = FakeClient()
        provider = FakeProvider([{"short_summary": "bad english output only"}, good_payload()])
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(len(provider.calls), 2)
        self.assertTrue(provider.calls[1][1])  # second call carried a correction

    def test_repair_includes_rejected_payload_and_non_empty_schema(self):
        client = FakeClient()
        rejected = {
            "short_summary": "خلاصه کوتاه",
            "detailed_summary": "خلاصه کامل",
            "key_takeaways": [],
            "chapters": [{"title": "بخش اصلی", "segment_indexes": [0, 1, 2]}],
        }
        provider = FakeProvider([rejected, good_payload()])
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(out["status"], "generated")
        correction = provider.corrections[1]
        self.assertIn('"key_takeaways":[]', correction)
        self.assertIn('"key_takeaways":[{"text":"..."', correction)
        self.assertIn("MUST each contain at least one object", correction)
        self.assertNotIn(ROWS[0]["source_text"], correction)

    def test_persistent_invalid_output_fails_once(self):
        client = FakeClient()
        provider = FakeProvider([{"bad": 1}, {"bad": 2}])
        with self.assertRaises(WorkerError) as ctx:
            G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(ctx.exception.code, "INSIGHT_INVALID_OUTPUT")
        self.assertEqual(len(provider.calls), 2)  # exactly one repair, no infinite retry
        names = [name for name, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_insight_status", "set_video_insight_status"])
        self.assertEqual(client.rpc_calls[1][1]["p_status"], "failed")

    def test_forced_regen_failure_never_touches_valid_ready(self):
        client = FakeClient()
        from worker.app.insights import prepare_segments, content_hash
        segs = prepare_segments(ROWS)
        h = content_hash("vid1", segs, provider="local_transformers", model="fake-model")
        client.existing_insight = {"id": "i1", "status": "ready", "content_hash": h,
                                   "prompt_version": PROMPT_VERSION, "schema_version": SCHEMA_VERSION}
        provider = FakeProvider([{"bad": 1}, {"bad": 2}])
        with self.assertRaises(WorkerError):
            G.generate_insights_for_video(CFG, client, "vid1", provider=provider, force=True)
        # The still-valid ready row was never flipped to generating/failed.
        self.assertEqual(client.rpc_calls, [])

    def test_incomplete_translation_fails_before_provider(self):
        rows = [dict(ROWS[0]), {**ROWS[1], "translated_text_fa": ""}]
        client = FakeClient(rows=rows)
        provider = FakeProvider([good_payload()])
        with self.assertRaises(WorkerError) as ctx:
            G.generate_insights_for_video(CFG, client, "vid1", provider=provider)
        self.assertEqual(ctx.exception.code, "INSIGHT_TRANSLATION_INCOMPLETE")
        self.assertEqual(provider.calls, [])

    def test_hierarchical_path_chunks_then_synthesizes(self):
        many = [
            {"segment_index": i, "start_ms": i * 2000, "end_ms": (i + 1) * 2000,
             "source_text": "", "translated_text_fa": f"جمله شماره {i} " + "متن نمونه " * 12}
            for i in range(8)
        ]
        client = FakeClient(rows=many)
        client.video["duration_seconds"] = 16.0
        small = InsightConfig(max_direct_input_chars=300, chunk_chars=500)
        # Build fake chunk outputs matching plan_chunks
        from worker.app.insights import prepare_segments, plan_chunks
        segs = prepare_segments(many)
        chunks = plan_chunks(segs, small)
        chunk_outputs = [
            {"chunk_summary": f"خلاصه بخش {n}.",
             "topics": [{"title": f"موضوع {n}", "segment_indexes": [c[0].segment_index]}]}
            for n, c in enumerate(chunks, start=1)
        ]
        final = {
            "short_summary": "خلاصه نهایی ویدیو درباره متن نمونه است.",
            "detailed_summary": "این ویدیو مجموعه‌ای از جمله‌های نمونه را به ترتیب مرور می‌کند.",
            "key_takeaways": [{"text": "جمله‌های نمونه به ترتیب ارائه می‌شوند", "segment_indexes": [0]}],
            "chapters": [{"title": "کل ویدیو", "segment_indexes": list(range(8))}],
        }
        provider = FakeProvider(chunk_outputs + [final])
        out = G.generate_insights_for_video(CFG, client, "vid1", provider=provider, insight_config=small)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(len(provider.calls), len(chunks) + 1)
        self.assertEqual(out["chapter_count"], 1)
        self.assertEqual(out["chapter_ranges_ms"], [[0, 16000]])


if __name__ == "__main__":
    unittest.main(verbosity=2)
