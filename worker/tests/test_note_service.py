"""Tests for AI Living-Note orchestration (fake client + provider)."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import note_service as S  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402
from worker.app.note_config import NOTE_PROMPT_VERSION, NOTE_SCHEMA_VERSION  # noqa: E402
from worker.app.notes import note_content_hash, saved_answer_fingerprints  # noqa: E402

CFG = types.SimpleNamespace()

ROWS = [
    {"segment_index": 0, "start_ms": 0, "end_ms": 9500, "translated_text_fa": "هوش مصنوعی شیوه کار را تغییر می‌دهد"},
    {"segment_index": 1, "start_ms": 9500, "end_ms": 20000, "translated_text_fa": "ابزارهای جدید کارها را ساده می‌کنند"},
    {"segment_index": 2, "start_ms": 20000, "end_ms": 29900, "translated_text_fa": "یادگیری این ابزارها یک مزیت است"},
]
INSIGHT = {
    "status": "ready", "content_hash": "insight-hash-1",
    "short_summary": "ویدیو درباره تاثیر هوش مصنوعی بر کار است.",
    "detailed_summary": "هوش مصنوعی کارها را تغییر می‌دهد.",
    "key_takeaways": [{"text": "هوش مصنوعی شیوه کار را تغییر می‌دهد", "segment_indexes": [0]}],
}
CHAPTERS = [{"title": "هوش مصنوعی و کار", "source_segment_indexes": [0, 1, 2]}]


def good_payload():
    return {
        "overview": "این ویدیو نشان می‌دهد هوش مصنوعی شیوه کار را دگرگون می‌کند و یادگیری ابزارهای تازه مهم است.",
        "key_points": [{"text": "هوش مصنوعی کار را دگرگون می‌کند", "segment_indexes": [0]}],
        "action_items": [],
    }


class FakeProvider:
    name = "local_transformers"
    model_id = "fake-model"

    def __init__(self, outputs):
        self.outputs = list(outputs)
        self.calls = []
        self.corrections = []

    def complete_json(self, system, user, correction=None):
        self.calls.append((system[:32], bool(correction)))
        self.corrections.append(correction)
        if not self.outputs:
            raise WorkerError("NOTE_PROVIDER_UNAVAILABLE", dev_detail="no more fake outputs")
        return self.outputs.pop(0)

    def health_check(self):
        from worker.app.insight_provider import ProviderHealth
        return ProviderHealth(ok=True)


class FakeClient:
    def __init__(self, *, insight=INSIGHT, saved=None, existing_note=None, video=True):
        self.video = {"id": "vid1", "user_id": "owner1", "title": "نمونه", "original_filename": "c.mp4"} if video else None
        self.insight = dict(insight) if insight else None
        self.saved = saved or []
        self.existing_note = existing_note
        self.rows = ROWS
        self.rpc_calls = []

    def select_one(self, table, query):
        if table == "videos":
            return dict(self.video) if self.video else None
        if table == "video_insights":
            return dict(self.insight) if self.insight else None
        if table == "video_notes":
            return dict(self.existing_note) if self.existing_note else None
        return None

    def select_many(self, table, query):
        if table == "video_chapters":
            return [dict(c) for c in CHAPTERS]
        if table == "video_note_saved_answers":
            return [dict(a) for a in self.saved]
        if table == "transcript_segments":
            return [dict(r) for r in self.rows]
        return []

    def rpc(self, fn, params):
        self.rpc_calls.append((fn, params))
        return None


def run(client, provider, **kw):
    return S.generate_note_for_video(CFG, client, "vid1", "owner1", provider=provider, **kw)


class TestNoteOrchestration(unittest.TestCase):
    def test_generates_validates_persists(self):
        client = FakeClient()
        provider = FakeProvider([good_payload()])
        out = run(client, provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(out["key_point_count"], 1)
        self.assertNotIn("هوش", str(out))  # no note text in structural result
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_note_ai_status", "persist_video_note_ai"])
        persist = client.rpc_calls[1][1]
        self.assertEqual(persist["p_user_id"], "owner1")
        self.assertEqual(persist["p_prompt_version"], NOTE_PROMPT_VERSION)
        self.assertEqual(persist["p_schema_version"], NOTE_SCHEMA_VERSION)
        self.assertEqual(persist["p_source_insight_hash"], "insight-hash-1")

    def test_reuses_matching_ready_note(self):
        client = FakeClient()
        h = note_content_hash("vid1", "owner1", "insight-hash-1", saved_answer_fingerprints([]),
                              provider="local_transformers", model="fake-model")
        client.existing_note = {"ai_status": "ready", "ai_content_hash": h,
                                "ai_prompt_version": NOTE_PROMPT_VERSION, "ai_schema_version": NOTE_SCHEMA_VERSION,
                                "ai_generated_at": None}
        provider = FakeProvider([])  # would raise if called
        out = run(client, provider)
        self.assertEqual(out["status"], "reused")
        self.assertEqual(provider.calls, [])
        self.assertEqual(client.rpc_calls, [])  # pure no-op

    def test_stale_marked_when_hash_differs(self):
        client = FakeClient()
        client.existing_note = {"ai_status": "ready", "ai_content_hash": "oldhash",
                                "ai_prompt_version": NOTE_PROMPT_VERSION, "ai_schema_version": NOTE_SCHEMA_VERSION,
                                "ai_generated_at": None}
        provider = FakeProvider([good_payload()])
        run(client, provider)
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names, ["mark_video_note_ai_stale", "set_video_note_ai_status", "persist_video_note_ai"])

    def test_version_change_invalidates_reuse(self):
        client = FakeClient()
        h = note_content_hash("vid1", "owner1", "insight-hash-1", saved_answer_fingerprints([]),
                              provider="local_transformers", model="fake-model")
        client.existing_note = {"ai_status": "ready", "ai_content_hash": h,
                                "ai_prompt_version": "note-p0", "ai_schema_version": NOTE_SCHEMA_VERSION,
                                "ai_generated_at": None}
        provider = FakeProvider([good_payload()])
        out = run(client, provider)
        self.assertEqual(out["status"], "generated")

    def test_one_controlled_repair_then_success(self):
        client = FakeClient()
        provider = FakeProvider([{"overview": "bad english only output here"}, good_payload()])
        out = run(client, provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(len(provider.calls), 2)
        self.assertTrue(provider.calls[1][1])  # second call carried a correction

    def test_persistent_invalid_output_fails_once(self):
        client = FakeClient()
        provider = FakeProvider([{"overview": "english"}, {"overview": "english again"}])
        with self.assertRaises(WorkerError) as ctx:
            run(client, provider)
        self.assertEqual(ctx.exception.code, "NOTE_INVALID_OUTPUT")
        self.assertEqual(len(provider.calls), 2)  # exactly one repair
        names = [n for n, _ in client.rpc_calls]
        self.assertEqual(names, ["set_video_note_ai_status", "set_video_note_ai_status"])
        self.assertEqual(client.rpc_calls[1][1]["p_status"], "failed")

    def test_forced_regen_failure_never_touches_valid_ready(self):
        client = FakeClient()
        h = note_content_hash("vid1", "owner1", "insight-hash-1", saved_answer_fingerprints([]),
                              provider="local_transformers", model="fake-model")
        client.existing_note = {"ai_status": "ready", "ai_content_hash": h,
                                "ai_prompt_version": NOTE_PROMPT_VERSION, "ai_schema_version": NOTE_SCHEMA_VERSION,
                                "ai_generated_at": None}
        provider = FakeProvider([{"overview": "english"}, {"overview": "english"}])
        with self.assertRaises(WorkerError):
            run(client, provider, force=True)
        self.assertEqual(client.rpc_calls, [])  # valid ready row never flipped

    def test_insight_missing_fails_before_provider(self):
        client = FakeClient(insight={"status": "generating"})
        provider = FakeProvider([good_payload()])
        with self.assertRaises(WorkerError) as ctx:
            run(client, provider)
        self.assertEqual(ctx.exception.code, "NOTE_INSIGHT_MISSING")
        self.assertEqual(provider.calls, [])

    def test_no_source_material_fails(self):
        client = FakeClient(insight={"status": "ready", "content_hash": "h", "short_summary": "",
                                     "detailed_summary": "", "key_takeaways": []})
        provider = FakeProvider([good_payload()])
        with self.assertRaises(WorkerError) as ctx:
            run(client, provider)
        self.assertEqual(ctx.exception.code, "NOTE_NO_SOURCE_MATERIAL")

    def test_non_owner_denied(self):
        client = FakeClient(video=False)
        provider = FakeProvider([good_payload()])
        with self.assertRaises(WorkerError) as ctx:
            run(client, provider)
        self.assertEqual(ctx.exception.code, "NOTE_ACCESS_DENIED")

    def test_saved_answers_change_generation_hash(self):
        saved = [{"message_id": "m1", "question": "q", "answer": "یادگیری ابزارها مهم است",
                  "citations": [{"start_ms": 20000, "end_ms": 29900, "source_segment_indexes": [2]}]}]
        client = FakeClient(saved=saved)
        provider = FakeProvider([good_payload()])
        out = run(client, provider)
        self.assertEqual(out["status"], "generated")
        self.assertEqual(out["saved_answer_count"], 1)
        persist = client.rpc_calls[-1][1]
        self.assertEqual(persist["p_saved_answer_count"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
