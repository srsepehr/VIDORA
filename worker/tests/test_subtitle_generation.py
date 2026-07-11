"""Tests for server-side subtitle generation orchestration (fakes, no network)."""

import os
import sys
import types
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import subtitle_generation as G  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402


class FakeGenClient:
    def __init__(self, segments, duration_seconds=30, existing=None, upload_fails=False, exists=True):
        self.video = {"id": "vid1", "user_id": "owner1", "duration_seconds": duration_seconds, "status": "translating"}
        self._segments = segments
        self.artifacts = list(existing or [])  # rows: dict(format,status,content_hash,builder_version,storage_path,cue_count)
        self.uploads = []
        self.deletes = []
        self.upload_fails = upload_fails
        self._exists = exists

    def select_one(self, table, query):
        if table == "videos":
            return dict(self.video)
        return None

    def select_many(self, table, query):
        if table == "transcript_segments":
            return [dict(s) for s in self._segments]
        if table == "subtitle_artifacts":
            return [dict(a) for a in self.artifacts]
        return []

    def rpc(self, fn, params):
        if fn == "upsert_subtitle_artifact":
            fmt = params["p_format"]
            row = next((a for a in self.artifacts if a["format"] == fmt), None)
            if row is None:
                row = {"format": fmt}
                self.artifacts.append(row)
            status = params["p_status"]
            row["status"] = status
            row["validation_warnings"] = params["p_validation_warnings"]
            row["error_code"] = params["p_error_code"]
            if status == "ready":
                row["storage_path"] = params["p_storage_path"]
                row["content_hash"] = params["p_content_hash"]
                row["builder_version"] = params["p_builder_version"]
                row["cue_count"] = params["p_cue_count"]
            else:
                row.setdefault("content_hash", params["p_content_hash"])
                row.setdefault("storage_path", None)
                row.setdefault("builder_version", params["p_builder_version"])
                row.setdefault("cue_count", None)
            return row
        return None

    def upload_storage_object(self, bucket, key, data, content_type):
        if self.upload_fails:
            raise WorkerError("SUBTITLE_STORAGE_FAILED", dev_detail="forced")
        self.uploads.append((key, content_type, data))

    def delete_storage_object(self, bucket, key):
        self.deletes.append(key)

    def storage_object_exists(self, bucket, key):
        return self._exists


CFG = types.SimpleNamespace(results_bucket="vidora-video-results")

SEGS = [
    {"segment_index": 0, "start_ms": 0, "end_ms": 1500, "translated_text_fa": "سلام دنیا"},
    {"segment_index": 1, "start_ms": 1500, "end_ms": 3000, "translated_text_fa": "روز خوبی است"},
    {"segment_index": 2, "start_ms": 3000, "end_ms": 4500, "translated_text_fa": "خداحافظ"},
]


class TestGeneration(unittest.TestCase):
    def test_generates_ready_artifacts(self):
        client = FakeGenClient(SEGS)
        result = G.generate_subtitles_for_video(CFG, client, "vid1")
        self.assertEqual(result["status"], "generated")
        self.assertEqual(result["cue_count"], 3)
        self.assertEqual(len(client.uploads), 2)  # vtt + srt
        # both content types correct, UTF-8 Persian present
        cts = sorted(ct for _, ct, _ in client.uploads)
        self.assertEqual(cts, ["application/x-subrip", "text/vtt"])
        for _, _, data in client.uploads:
            self.assertIn("سلام".encode("utf-8"), data)
        ready = [a for a in client.artifacts if a["status"] == "ready"]
        self.assertEqual(len(ready), 2)
        self.assertTrue(all(a["content_hash"] == result["content_hash"] for a in ready))
        # path is owner-scoped and hash-addressed
        self.assertTrue(result["vtt_path"].startswith("owner1/videos/vid1/subtitles/"))
        self.assertTrue(result["vtt_path"].endswith("/fa.vtt"))

    def test_idempotent_reuse_when_hash_matches(self):
        client = FakeGenClient(SEGS)
        first = G.generate_subtitles_for_video(CFG, client, "vid1")
        client.uploads.clear()
        second = G.generate_subtitles_for_video(CFG, client, "vid1")
        self.assertEqual(second["status"], "reused")
        self.assertEqual(second["content_hash"], first["content_hash"])
        self.assertEqual(len(client.uploads), 0)  # no re-upload

    def test_force_regenerates(self):
        client = FakeGenClient(SEGS)
        G.generate_subtitles_for_video(CFG, client, "vid1")
        client.uploads.clear()
        forced = G.generate_subtitles_for_video(CFG, client, "vid1", force=True)
        self.assertEqual(forced["status"], "generated")
        self.assertEqual(len(client.uploads), 2)

    def test_incomplete_translation_rejected_no_upload(self):
        bad = [dict(SEGS[0]), {"segment_index": 1, "start_ms": 1500, "end_ms": 3000, "translated_text_fa": ""}]
        client = FakeGenClient(bad)
        with self.assertRaises(WorkerError) as ctx:
            G.generate_subtitles_for_video(CFG, client, "vid1")
        self.assertEqual(ctx.exception.code, "SUBTITLE_TRANSLATION_INCOMPLETE")
        self.assertEqual(len(client.uploads), 0)

    def test_upload_failure_cleans_and_marks_failed(self):
        client = FakeGenClient(SEGS, upload_fails=True)
        with self.assertRaises(WorkerError) as ctx:
            G.generate_subtitles_for_video(CFG, client, "vid1")
        self.assertEqual(ctx.exception.code, "SUBTITLE_STORAGE_FAILED")
        failed = [a for a in client.artifacts if a["status"] == "failed"]
        self.assertEqual(len(failed), 2)

    def test_supersede_deletes_old_hash_objects(self):
        existing = [
            {"format": "vtt", "status": "ready", "content_hash": "OLDHASH", "builder_version": "sub-v1",
             "storage_path": "owner1/videos/vid1/subtitles/OLDHASH/fa.vtt", "cue_count": 3},
            {"format": "srt", "status": "ready", "content_hash": "OLDHASH", "builder_version": "sub-v1",
             "storage_path": "owner1/videos/vid1/subtitles/OLDHASH/fa.srt", "cue_count": 3},
        ]
        client = FakeGenClient(SEGS, existing=existing)
        result = G.generate_subtitles_for_video(CFG, client, "vid1")
        self.assertEqual(result["status"], "generated")
        self.assertIn("owner1/videos/vid1/subtitles/OLDHASH/fa.vtt", client.deletes)
        self.assertIn("owner1/videos/vid1/subtitles/OLDHASH/fa.srt", client.deletes)


if __name__ == "__main__":
    unittest.main(verbosity=2)
