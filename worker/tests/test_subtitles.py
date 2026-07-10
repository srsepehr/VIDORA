"""Unit tests for the deterministic subtitle builder (no AI deps)."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from worker.app import subtitles as S  # noqa: E402
from worker.app.subtitle_config import DEFAULT_CUE_CONFIG, CueConfig, BUILDER_VERSION  # noqa: E402
from worker.app.errors import WorkerError  # noqa: E402


def seg(i, s, e, t):
    return S.SourceSegment(i, s, e, t)


class TestHashing(unittest.TestCase):
    def test_deterministic_and_input_sensitive(self):
        segs = [seg(0, 0, 1000, "سلام"), seg(1, 1000, 2000, "دنیا")]
        h1 = S.content_hash("v1", segs)
        h2 = S.content_hash("v1", [seg(1, 1000, 2000, "دنیا"), seg(0, 0, 1000, "سلام")])  # order-independent
        self.assertEqual(h1, h2)
        # A changed translation -> different hash.
        self.assertNotEqual(h1, S.content_hash("v1", [seg(0, 0, 1000, "سلام."), seg(1, 1000, 2000, "دنیا")]))
        # A changed timestamp -> different hash.
        self.assertNotEqual(h1, S.content_hash("v1", [seg(0, 0, 1100, "سلام"), seg(1, 1100, 2000, "دنیا")]))
        # A different video -> different hash.
        self.assertNotEqual(h1, S.content_hash("v2", segs))

    def test_builder_version_in_hash(self):
        segs = [seg(0, 0, 1000, "سلام")]
        self.assertNotEqual(
            S.content_hash("v1", segs, builder_version="sub-v1"),
            S.content_hash("v1", segs, builder_version="sub-v2"),
        )


class TestBuildBasics(unittest.TestCase):
    def test_three_short_segments_one_cue_each(self):
        segs = [seg(0, 0, 1200, "سلام دنیا"), seg(1, 1200, 2600, "این یک آزمایش است"), seg(2, 2600, 4000, "خداحافظ")]
        cues, warnings = S.build_cues(segs, video_duration_ms=4000)
        self.assertEqual(len(cues), 3)
        self.assertEqual([c.index for c in cues], [1, 2, 3])
        self.assertEqual(cues[0].source_indexes, [0])
        self.assertTrue(all(c.end_ms > c.start_ms for c in cues))

    def test_empty_translation_rejected(self):
        with self.assertRaises(WorkerError) as ctx:
            S.build_cues([seg(0, 0, 1000, "  ")])
        self.assertEqual(ctx.exception.code, "SUBTITLE_TRANSLATION_INCOMPLETE")

    def test_no_segments_rejected(self):
        with self.assertRaises(WorkerError) as ctx:
            S.build_cues([])
        self.assertEqual(ctx.exception.code, "SUBTITLE_TRANSCRIPT_MISSING")

    def test_determinism_byte_identical(self):
        segs = [seg(0, 0, 1500, "یک جمله نمونه"), seg(1, 1500, 3000, "جمله دوم")]
        r1, v1, s1 = S.build_artifacts("v1", segs, 3000)
        r2, v2, s2 = S.build_artifacts("v1", segs, 3000)
        self.assertEqual(v1, v2)
        self.assertEqual(s1, s2)
        self.assertEqual(r1.content_hash, r2.content_hash)


class TestTimestamps(unittest.TestCase):
    def test_sorting_out_of_order(self):
        segs = [seg(1, 2000, 3000, "دو"), seg(0, 0, 1000, "یک")]
        cues, _ = S.build_cues(segs, 3000)
        self.assertTrue(cues[0].start_ms < cues[1].start_ms)

    def test_negative_clamped(self):
        cues, _ = S.build_cues([seg(0, -500, 1000, "سلام")], 1000)
        self.assertEqual(cues[0].start_ms, 0)

    def test_clamp_to_duration(self):
        cues, _ = S.build_cues([seg(0, 0, 99000, "سلام")], 5000)
        self.assertLessEqual(cues[-1].end_ms, 5000)

    def test_overlap_repaired(self):
        segs = [seg(0, 0, 2500, "یک"), seg(1, 2000, 4000, "دو")]
        cues, _ = S.build_cues(segs, 4000)
        self.assertLessEqual(cues[0].end_ms, cues[1].start_ms)

    def test_unrepairable_overlap_fails(self):
        # Second starts before first even could exist meaningfully.
        segs = [seg(0, 1000, 5000, "یک"), seg(1, 1000, 1000, "دو")]
        with self.assertRaises(WorkerError) as ctx:
            S.build_cues(segs, 5000)
        self.assertEqual(ctx.exception.code, "SUBTITLE_TIMESTAMP_INVALID")

    def test_non_numeric_timestamp_fails(self):
        with self.assertRaises(WorkerError) as ctx:
            S.build_cues([seg(0, "x", 1000, "سلام")])
        self.assertEqual(ctx.exception.code, "SUBTITLE_TIMESTAMP_INVALID")

    def test_zero_length_repaired_with_room(self):
        cues, _ = S.build_cues([seg(0, 0, 0, "سلام"), seg(1, 3000, 4000, "دنیا")], 4000)
        self.assertGreater(cues[0].end_ms, cues[0].start_ms)


class TestLayout(unittest.TestCase):
    def test_wrap_two_lines_no_midword(self):
        text = "کلمه " * 20
        wrapped = S.wrap_two_lines(text.strip(), 42)
        self.assertLessEqual(wrapped.count("\n"), 1)
        for line in wrapped.split("\n"):
            self.assertFalse(line.startswith(" ") or line.endswith(" "))
        # No word was cut: rejoining by whitespace equals the flattened source.
        self.assertEqual(wrapped.replace("\n", " ").split(), text.split())

    def test_long_text_splits_into_multiple_cues(self):
        long_fa = "این یک جمله بسیار طولانی است که باید به چند بخش تقسیم شود چون بیش از حد مجاز کاراکتر دارد و باید خوانا بماند و همچنان کامل بماند بدون حذف"
        cues, warnings = S.build_cues([seg(0, 0, 8000, long_fa)], 8000)
        self.assertGreater(len(cues), 1)
        # All text preserved across cues, in order, no loss.
        joined = " ".join(S._flatten(c.text) for c in cues)
        self.assertEqual(joined.split(), S._flatten(long_fa).split())
        # Chronological, non-overlapping, positive durations.
        for a, b in zip(cues, cues[1:]):
            self.assertLessEqual(a.end_ms, b.start_ms)
        self.assertTrue(all(c.end_ms > c.start_ms for c in cues))

    def test_no_midword_split_across_cues(self):
        long_fa = "کلمه‌ای " * 40
        cues, _ = S.build_cues([seg(0, 0, 9000, long_fa.strip())], 9000)
        for c in cues:
            for line in c.text.split("\n"):
                self.assertNotIn("  ", line)
        joined = " ".join(S._flatten(c.text) for c in cues)
        self.assertEqual(joined.split(), long_fa.split())

    def test_proportional_split_timing_monotonic(self):
        long_fa = "بخش اول طولانی. " * 6
        cues, _ = S.build_cues([seg(0, 1000, 7000, long_fa.strip())], 7000)
        self.assertEqual(cues[0].start_ms, 1000)
        self.assertEqual(cues[-1].end_ms, 7000)
        for a, b in zip(cues, cues[1:]):
            self.assertEqual(a.end_ms, b.start_ms) if False else self.assertLessEqual(a.end_ms, b.start_ms)


class TestMerge(unittest.TestCase):
    def test_short_adjacent_merge(self):
        cfg = DEFAULT_CUE_CONFIG
        segs = [seg(0, 0, 400, "بله"), seg(1, 450, 900, "درست است")]
        cues, _ = S.build_cues(segs, 2000, cfg)
        self.assertEqual(len(cues), 1)
        self.assertEqual(sorted(cues[0].source_indexes), [0, 1])

    def test_no_merge_across_sentence_boundary(self):
        segs = [seg(0, 0, 400, "تمام شد."), seg(1, 450, 900, "بعدی")]
        cues, _ = S.build_cues(segs, 2000)
        self.assertEqual(len(cues), 2)

    def test_no_merge_when_gap_large(self):
        segs = [seg(0, 0, 400, "یک"), seg(1, 3000, 3400, "دو")]
        cues, _ = S.build_cues(segs, 4000)
        self.assertEqual(len(cues), 2)


class TestSerialization(unittest.TestCase):
    def _cues(self):
        return S.build_cues([seg(0, 0, 1500, "سلام دنیا"), seg(1, 1500, 3200, "روز خوبی است")], 3200)[0]

    def test_vtt_header_and_format(self):
        vtt = S.to_vtt(self._cues())
        self.assertTrue(vtt.startswith("WEBVTT\n\n"))
        self.assertIn(" --> ", vtt)
        self.assertRegex(vtt, r"\d{2}:\d{2}:\d{2}\.\d{3} --> \d{2}:\d{2}:\d{2}\.\d{3}")
        self.assertTrue(vtt.endswith("\n"))

    def test_srt_numbering_and_format(self):
        srt = S.to_srt(self._cues())
        self.assertTrue(srt.startswith("1\n"))
        self.assertRegex(srt, r"\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}")
        self.assertTrue(srt.endswith("\n"))

    def test_timestamp_formatting(self):
        self.assertEqual(S.format_vtt_timestamp(3_661_234), "01:01:01.234")
        self.assertEqual(S.format_srt_timestamp(3_661_234), "01:01:01,234")
        self.assertEqual(S.format_vtt_timestamp(0), "00:00:00.000")

    def test_vtt_escapes_markup(self):
        cue = S.Cue(1, 0, 1000, "a < b & c > d")
        vtt = S.to_vtt([cue])
        self.assertIn("&lt;", vtt)
        self.assertIn("&amp;", vtt)
        self.assertIn("&gt;", vtt)

    def test_persian_unicode_roundtrip(self):
        cues = self._cues()
        vtt = S.to_vtt(cues)
        srt = S.to_srt(cues)
        self.assertIn("سلام دنیا", vtt)
        self.assertIn("روز خوبی است", srt)
        # Round-trip parse preserves timing.
        self.assertEqual([(c.start_ms, c.end_ms) for c in S.parse_vtt(vtt)], [(c.start_ms, c.end_ms) for c in cues])
        self.assertEqual([(c.start_ms, c.end_ms) for c in S.parse_srt(srt)], [(c.start_ms, c.end_ms) for c in cues])

    def test_build_artifacts_roundtrip_guard(self):
        result, vtt, srt = S.build_artifacts("v1", [seg(0, 0, 1500, "سلام"), seg(1, 1500, 3000, "دنیا")], 3000)
        self.assertEqual(result.builder_version, BUILDER_VERSION)
        self.assertEqual(result.source_segment_count, 2)
        self.assertTrue(vtt.startswith("WEBVTT"))
        self.assertEqual(len(result.content_hash), 64)


class TestValidation(unittest.TestCase):
    def test_validate_rejects_overlap(self):
        cues = [S.Cue(1, 0, 2000, "a"), S.Cue(2, 1000, 3000, "b")]
        with self.assertRaises(WorkerError):
            S.validate_cues(cues, None)

    def test_validate_rejects_beyond_duration(self):
        with self.assertRaises(WorkerError):
            S.validate_cues([S.Cue(1, 0, 6000, "a")], 5000)

    def test_validate_accepts_good(self):
        S.validate_cues([S.Cue(1, 0, 1500, "a"), S.Cue(2, 1500, 3000, "b")], 3000)


if __name__ == "__main__":
    unittest.main(verbosity=2)
