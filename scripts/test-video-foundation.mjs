import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vidora-video-tests-"));

function compileTs(source, targetName) {
  const input = fs.readFileSync(path.join(root, source), "utf8");
  const js = ts.transpileModule(input, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      esModuleInterop: true,
    },
  }).outputText.replace(/from "\.\/([^"]+)"/g, 'from "./$1.mjs"');
  const out = path.join(tmp, targetName);
  fs.writeFileSync(out, js);
  return out;
}

compileTs("src/lib/app-error.ts", "app-error.mjs");
compileTs("src/lib/env-core.ts", "env-core.mjs");
fs.writeFileSync(path.join(tmp, "env.mjs"), `export function getBrowserEnv() { return { supabaseUrl: "https://test.supabase.co", supabaseAnonKey: "anon-test", appUrl: "http://localhost" }; }`);
compileTs("src/lib/auth.ts", "auth.mjs");
compileTs("src/lib/user-data.ts", "user-data.mjs");
compileTs("src/lib/subscription-access.ts", "subscription-access.mjs");
compileTs("src/lib/access-policy.ts", "access-policy.mjs");
compileTs("src/lib/video-config.ts", "video-config.mjs");
compileTs("src/lib/video-sources.ts", "video-sources.mjs");
compileTs("src/lib/video-storage.ts", "video-storage.mjs");
compileTs("src/lib/video-service.ts", "video-service.mjs");
compileTs("src/lib/transcript-review.ts", "transcript-review.mjs");
compileTs("src/lib/subtitle-review.ts", "subtitle-review.mjs");
compileTs("src/lib/insight-review.ts", "insight-review.mjs");
compileTs("src/lib/video-chat.ts", "video-chat.mjs");
compileTs("src/lib/note-review.ts", "note-review.mjs");

const load = (name) => import(pathToFileURL(path.join(tmp, name)));
const videoConfig = await load("video-config.mjs");
const videoSources = await load("video-sources.mjs");
const videoStorage = await load("video-storage.mjs");
const videoService = await load("video-service.mjs");
const accessPolicy = await load("access-policy.mjs");
const transcriptReview = await load("transcript-review.mjs");
const subtitleReview = await load("subtitle-review.mjs");
const insightReview = await load("insight-review.mjs");
const videoChat = await load("video-chat.mjs");
const noteReview = await load("note-review.mjs");

// ---------------------------------------------------------------------------
// Upload config + file validation
// ---------------------------------------------------------------------------

test("upload config uses the env override and falls back to 500 MB", () => {
  assert.equal(videoConfig.resolveVideoUploadConfig("250").maxUploadSizeMb, 250);
  assert.equal(videoConfig.resolveVideoUploadConfig("250").maxUploadSizeBytes, 250 * 1024 * 1024);
  assert.equal(videoConfig.resolveVideoUploadConfig(undefined).maxUploadSizeMb, 500);
  assert.equal(videoConfig.resolveVideoUploadConfig("nope").maxUploadSizeMb, 500);
  assert.equal(videoConfig.resolveVideoUploadConfig("-5").maxUploadSizeMb, 500);
});

test("file validation rejects empty, unsupported, and oversized files with Persian errors", () => {
  const mb = 1024 * 1024;
  assert.throws(
    () => videoService.validateVideoFile({ name: "a.mp4", size: 0, type: "video/mp4" }),
    (error) => error.code === "FILE_EMPTY" && /خالی/.test(error.messageFa),
  );
  assert.throws(
    () => videoService.validateVideoFile({ name: "a.mkv", size: mb, type: "video/x-matroska" }),
    (error) => error.code === "FILE_TYPE_UNSUPPORTED" && /پشتیبانی نمی‌شود/.test(error.messageFa),
  );
  assert.throws(
    () => videoService.validateVideoFile({ name: "a.exe", size: mb, type: "" }),
    (error) => error.code === "FILE_TYPE_UNSUPPORTED",
  );
  // Extension spoofing: mp4 extension with a non-video MIME type is refused.
  assert.throws(
    () => videoService.validateVideoFile({ name: "a.mp4", size: mb, type: "application/x-msdownload" }),
    (error) => error.code === "FILE_TYPE_UNSUPPORTED",
  );
  assert.throws(
    () => videoService.validateVideoFile({ name: "big.mp4", size: 501 * mb, type: "video/mp4" }),
    (error) => error.code === "FILE_TOO_LARGE" && /حجم فایل/.test(error.messageFa),
  );
  assert.doesNotThrow(() => videoService.validateVideoFile({ name: "ok.webm", size: 12 * mb, type: "video/webm" }));
  assert.doesNotThrow(() => videoService.validateVideoFile({ name: "ok.mov", size: 12 * mb, type: "video/quicktime" }));
});

// ---------------------------------------------------------------------------
// Storage keys — ownership prefix and traversal safety
// ---------------------------------------------------------------------------

test("storage keys are rooted at the owner id and never contain user filenames", () => {
  const userId = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
  const videoId = "0f8fad5b-d9cb-469f-a555-e8a706f7c1a4";
  const key = videoStorage.buildSourceStorageKey(userId, videoId, "..\\..\\etc\\passwd نسخه نهایی.mp4");
  assert.match(key, new RegExp(`^${userId}/videos/${videoId}/source/[a-z0-9]+\\.mp4$`));
  assert.ok(!key.includes(".."));
  assert.ok(!key.includes("passwd"));
});

test("unsafe id segments and extensions cannot reach the storage path", () => {
  assert.throws(() => videoStorage.buildSourceStorageKey("../victim", "vid-1", "a.mp4"), (e) => e.code === "STORAGE_UPLOAD_FAILED");
  assert.throws(() => videoStorage.buildSourceStorageKey("user/../../victim", "vid-1", "a.mp4"), (e) => e.code === "STORAGE_UPLOAD_FAILED");
  assert.throws(() => videoStorage.buildSourceStorageKey("user1", "vid/../2", "a.mp4"), (e) => e.code === "STORAGE_UPLOAD_FAILED");
  assert.throws(() => videoStorage.buildSourceStorageKey("", "vid-1", "a.mp4"), (e) => e.code === "STORAGE_UPLOAD_FAILED");
  const odd = videoStorage.buildSourceStorageKey("user1", "vid1", "archive.tar.gz%2e%2e%2f");
  assert.match(odd, /\.bin$/);
});

// ---------------------------------------------------------------------------
// URL classification adapters
// ---------------------------------------------------------------------------

test("YouTube URLs normalize to a canonical watch URL", async () => {
  const cases = [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
    "https://www.youtube.com/embed/dQw4w9WgXcQ",
  ];
  for (const raw of cases) {
    const result = await videoSources.validateVideoSourceUrl(raw);
    assert.equal(result.sourceType, "youtube");
    assert.equal(result.normalizedUrl, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  }
});

test("YouTube URLs without a video id are invalid, not unsupported", async () => {
  for (const raw of ["https://www.youtube.com/", "https://www.youtube.com/playlist?list=PL123", "https://youtu.be/"]) {
    await assert.rejects(videoSources.validateVideoSourceUrl(raw), (e) => e.code === "INVALID_URL" && e.messageFa === "لینک واردشده معتبر نیست.");
  }
});

test("direct media links classify by container extension", async () => {
  const mp4 = await videoSources.validateVideoSourceUrl("https://cdn.example.com/media/talk.mp4");
  assert.equal(mp4.sourceType, "direct_media_url");
  assert.equal(mp4.normalizedUrl, "https://cdn.example.com/media/talk.mp4");
  const webm = await videoSources.validateVideoSourceUrl("https://cdn.example.com/a/b/clip.webm?token=abc");
  assert.equal(webm.sourceType, "direct_media_url");
});

test("known platforms and unknown hosts are honestly unsupported", async () => {
  const unsupported = [
    "https://www.instagram.com/reel/xyz/",
    "https://vt.tiktok.com/xyz/",
    "https://www.aparat.com/v/xyz",
    "https://vimeo.com/123456",
    "https://example.com/page-about-video",
  ];
  for (const raw of unsupported) {
    await assert.rejects(videoSources.validateVideoSourceUrl(raw), (e) => e.code === "UNSUPPORTED_SOURCE" && e.messageFa === "این لینک در حال حاضر پشتیبانی نمی‌شود.");
  }
});

test("garbage input is an invalid URL with a Persian message", async () => {
  for (const raw of ["", "   ", "not a url", "youtube.com/watch?v=abc"]) {
    await assert.rejects(videoSources.validateVideoSourceUrl(raw), (e) => e.code === "INVALID_URL");
  }
});

// ---------------------------------------------------------------------------
// SSRF guard
// ---------------------------------------------------------------------------

test("SSRF guard refuses loopback, private, link-local, and metadata addresses", async () => {
  const dangerous = [
    "https://localhost/video.mp4",
    "https://127.0.0.1/video.mp4",
    "https://0.0.0.0/video.mp4",
    "https://10.0.12.7/video.mp4",
    "https://192.168.1.10/video.mp4",
    "https://172.16.0.9/video.mp4",
    "https://172.31.255.1/video.mp4",
    "https://169.254.169.254/latest/meta-data/",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://internal-service.local/video.mp4",
    "https://db.internal/video.mp4",
    "https://intranet/video.mp4",
    "https://[::1]/video.mp4",
    "https://8.8.8.8/video.mp4",
  ];
  for (const raw of dangerous) {
    await assert.rejects(videoSources.validateVideoSourceUrl(raw), (e) => e.code === "UNSAFE_URL" && e.messageFa === "این آدرس به دلایل امنیتی قابل پردازش نیست.", raw);
  }
});

test("SSRF guard refuses embedded credentials and non-HTTPS schemes", async () => {
  const dangerous = [
    "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "ftp://example.com/video.mp4",
    "file:///etc/passwd",
    "https://user:pass@example.com/video.mp4",
    "https://admin@example.com/video.mp4",
  ];
  for (const raw of dangerous) {
    await assert.rejects(videoSources.validateVideoSourceUrl(raw), (e) => e.code === "UNSAFE_URL", raw);
  }
});

test("SSRF guard applies even when a supported adapter matches the shape", async () => {
  await assert.rejects(videoSources.validateVideoSourceUrl("https://192.168.0.5/clip.mp4"), (e) => e.code === "UNSAFE_URL");
});

// ---------------------------------------------------------------------------
// Product access policy
// ---------------------------------------------------------------------------

test("access policy allows any authenticated user and denies guests", async () => {
  const me = { user: { id: "user-1" }, accessToken: "jwt" };
  const authed = new accessPolicy.AllowAuthenticatedAccessPolicy(() => me);
  assert.equal((await authed.canUploadVideo("user-1")).allowed, true);
  assert.equal((await authed.canSubmitVideoUrl("user-1")).allowed, true);
  assert.equal((await authed.canViewProcessedVideo("user-1", "vid-9")).allowed, true);

  const guest = new accessPolicy.AllowAuthenticatedAccessPolicy(() => null);
  const denied = await guest.canUploadVideo("user-1");
  assert.equal(denied.allowed, false);
  assert.equal(denied.reason, "AUTH_REQUIRED");
  assert.match(denied.messageFa, /وارد حساب/);

  // A session for a different user id must not authorize acting as user-1.
  const other = new accessPolicy.AllowAuthenticatedAccessPolicy(() => ({ user: { id: "user-2" }, accessToken: "jwt" }));
  assert.equal((await other.canUploadVideo("user-1")).allowed, false);
});

test("swapping the policy is the single seam for future plan checks", async () => {
  const denyAll = {
    canUploadVideo: async () => ({ allowed: false, reason: "PLAN_REQUIRED", messageFa: "اشتراک لازم است." }),
    canSubmitVideoUrl: async () => ({ allowed: false, reason: "PLAN_REQUIRED", messageFa: "اشتراک لازم است." }),
    canViewProcessedVideo: async () => ({ allowed: false, reason: "PLAN_REQUIRED", messageFa: "اشتراک لازم است." }),
  };
  const previous = accessPolicy.getAccessPolicy();
  accessPolicy.setAccessPolicy(denyAll);
  try {
    assert.equal((await accessPolicy.getAccessPolicy().canUploadVideo("user-1")).reason, "PLAN_REQUIRED");
  } finally {
    accessPolicy.setAccessPolicy(previous);
  }
});

// ---------------------------------------------------------------------------
// Queue/database error mapping (stable codes; raw Supabase text never leaks)
// ---------------------------------------------------------------------------

test("queue RPC errors map to stable codes with Persian messages", async () => {
  const map = (status, body) =>
    videoService.__testMapRestError(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }), "عملیات ناموفق بود.", "test");

  assert.equal((await map(401, { message: "JWT expired" })).code, "ACCESS_DENIED");
  assert.equal((await map(403, { message: "permission denied" })).code, "ACCESS_DENIED");
  assert.equal((await map(429, { message: "rate limit" })).code, "RATE_LIMITED");
  assert.equal((await map(404, { message: "VIDEO_NOT_FOUND" })).code, "VIDEO_NOT_FOUND");
  assert.equal((await map(409, { message: "VIDEO_NOT_ENQUEUEABLE" })).code, "JOB_ALREADY_EXISTS");
  assert.equal((await map(409, { message: "VIDEO_NOT_CANCELLABLE" })).code, "JOB_ALREADY_EXISTS");
  assert.equal((await map(409, { message: "VIDEO_SOURCE_MISSING" })).code, "STORAGE_OBJECT_MISSING");

  const generic = await map(500, { message: 'relation "public.videos" does not exist' });
  assert.equal(generic.code, "DATABASE_ERROR");
  assert.equal(generic.retryable, true);
  // The raw Supabase error text must stay out of the user-facing message.
  assert.ok(!generic.messageFa.includes("relation"));
  assert.match(generic.messageFa, /ناموفق/);
});

// ---------------------------------------------------------------------------
// Migration invariants (idempotent queue + safety rails live in SQL)
// ---------------------------------------------------------------------------

test("pipeline migration declares the idempotency index and guarded RPCs", () => {
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/202607090001_video_pipeline_foundation.sql"), "utf8");
  assert.match(sql, /create unique index[\s\S]*video_jobs[\s\S]*where status in \('queued',\s*'running'\)/i);
  assert.match(sql, /create or replace function public\.enqueue_video_processing/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /revoke (all|execute)[\s\S]*from public/i);
  assert.match(sql, /grant execute[\s\S]*to authenticated/i);
  assert.match(sql, /VIDEO_NOT_ENQUEUEABLE/);
  assert.match(sql, /VIDEO_SOURCE_MISSING/);
  assert.match(sql, /max_attempts/);
  assert.match(sql, /lease_expires_at/);
});


// ---------------------------------------------------------------------------
// Processed-video review: private playback + transcript behavior
// ---------------------------------------------------------------------------

test("signed playback URL refreshes a rejected session once", async () => {
  const values = new Map();
  const now = Math.floor(Date.now() / 1000);
  const session = {
    accessToken: "stale-access",
    refreshToken: "stale-refresh",
    expiresAt: now + 3600,
    user: { id: "user-1", email: "owner@example.com" },
  };
  values.set("vidora.supabase.session.v1", JSON.stringify(session));
  global.window = {
    location: { origin: "http://localhost" },
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };

  let storageCalls = 0;
  let refreshCalls = 0;
  global.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url.includes("/auth/v1/token")) {
      refreshCalls += 1;
      return new Response(JSON.stringify({
        access_token: "fresh-access",
        refresh_token: "fresh-refresh",
        expires_at: now + 7200,
        user: session.user,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    storageCalls += 1;
    const authorized = new Headers(init.headers).get("Authorization") === "Bearer fresh-access";
    if (!authorized) return new Response("{}", { status: 401 });
    return new Response(JSON.stringify({ signedURL: "/object/sign/vidora-video-uploads/private?token=redacted" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const adapter = new videoStorage.SupabaseVideoStorage();
  const url = await adapter.createSignedReadUrl(session, "user-1/videos/video-1/source/a.mp4", 300);
  assert.match(url, /\/storage\/v1\/object\/sign\/vidora-video-uploads\/private/);
  assert.equal(storageCalls, 2);
  assert.equal(refreshCalls, 1);
});

test("transcript preparation sorts chronologically and reports malformed data", () => {
  const rows = [
    { id: "b", video_id: "v", segment_index: 1, start_ms: 2000, end_ms: 3000, source_text: "Second", translated_text_fa: "دوم" },
    { id: "a", video_id: "v", segment_index: 0, start_ms: 0, end_ms: 1000, source_text: "First", translated_text_fa: "اول" },
  ];
  const clean = transcriptReview.prepareTranscript(rows);
  assert.deepEqual(clean.segments.map((row) => row.id), ["a", "b"]);
  assert.equal(clean.isComplete, true);

  const malformed = transcriptReview.prepareTranscript([
    ...rows,
    { id: "dup", video_id: "v", segment_index: 1, start_ms: 4000, end_ms: 3000, source_text: "", translated_text_fa: null },
  ]);
  assert.deepEqual(malformed.duplicateIndexes, [1]);
  assert.deepEqual(malformed.invalidIndexes, [1]);
  assert.deepEqual(malformed.missingSourceIndexes, [1]);
  assert.deepEqual(malformed.missingTranslationIndexes, [1]);
  assert.equal(malformed.isComplete, false);
});

test("active segment lookup handles boundaries and only small gaps", () => {
  const segments = [
    { start_ms: 0, end_ms: 1000 },
    { start_ms: 1200, end_ms: 2000 },
    { start_ms: 4000, end_ms: 5000 },
  ];
  assert.equal(transcriptReview.findActiveSegmentIndex(segments, 500), 0);
  assert.equal(transcriptReview.findActiveSegmentIndex(segments, 1100), 0);
  assert.equal(transcriptReview.findActiveSegmentIndex(segments, 3000), -1);
  assert.equal(transcriptReview.findActiveSegmentIndex(segments, 4500), 2);
  assert.equal(transcriptReview.findActiveSegmentIndex(segments, 6000), -1);
});

test("search matches source and normalized Persian variants", () => {
  const segment = { source_text: "Building useful AI agents", translated_text_fa: "ساخت عامل‌های هوش مصنوعی کاربردی" };
  assert.equal(transcriptReview.segmentMatchesQuery(segment, "USEFUL ai"), true);
  assert.equal(transcriptReview.segmentMatchesQuery(segment, "عامل هاي"), false);
  assert.equal(
    transcriptReview.normalizeTranscriptSearch("يادگيري كاربردي"),
    transcriptReview.normalizeTranscriptSearch("یادگیری کاربردی"),
  );
  const zwnj = { source_text: "", translated_text_fa: "عامل‌های هوشمند" };
  assert.equal(transcriptReview.segmentMatchesQuery(zwnj, "عاملهای"), true);
});

test("display-mode copy preserves chronological text without UI labels", () => {
  const segments = [
    { start_ms: 0, source_text: "First", translated_text_fa: "اول" },
    { start_ms: 2000, source_text: "Second", translated_text_fa: "دوم" },
  ];
  assert.equal(transcriptReview.buildTranscriptCopy(segments, "source"), `First
Second`);
  assert.equal(transcriptReview.buildTranscriptCopy(segments, "fa"), `اول
دوم`);
  assert.equal(transcriptReview.buildTranscriptCopy(segments, "both"), `First
اول

Second
دوم`);
  assert.match(transcriptReview.buildTranscriptCopy(segments, "source", true), /^\[00:00\]/);
});

test("review UI uses semantic seek controls", () => {
  const source = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
  assert.match(source, /<button[\s\S]*className="vdr-segment-main"/);
  assert.match(source, /player\.currentTime\s*=/);
  assert.match(source, /onTimeUpdate=\{handleTimeUpdate\}/);
  assert.match(source, /navigator\.clipboard\.writeText/);
});

// ---------------------------------------------------------------------------
// Soft subtitles (consume-only frontend)
// ---------------------------------------------------------------------------

test("subtitle availability derives from status + builder version", () => {
  const artifact = (over) => ({ format: "vtt", language: "fa", status: "ready", content_hash: "h",
    builder_version: subtitleReview.SUBTITLE_BUILDER_VERSION, cue_count: 3, storage_path: "p", validation_warnings: [], error_code: null, ...over });
  assert.equal(subtitleReview.deriveSubtitleAvailability([artifact({})]).state, "ready");
  assert.equal(subtitleReview.deriveSubtitleAvailability([artifact({ status: "generating" })]).state, "generating");
  assert.equal(subtitleReview.deriveSubtitleAvailability([artifact({ status: "failed" })]).state, "failed");
  assert.equal(subtitleReview.deriveSubtitleAvailability([artifact({ status: "stale" })]).state, "stale");
  // A ready artifact from a different builder version is treated as stale.
  assert.equal(subtitleReview.deriveSubtitleAvailability([artifact({ builder_version: "sub-vOLD" })]).state, "stale");
  // No vtt artifact at all -> none.
  assert.equal(subtitleReview.deriveSubtitleAvailability([]).state, "none");
});

test("subtitle downloadable only when ready with a storage path", () => {
  assert.equal(subtitleReview.isSubtitleDownloadable({ status: "ready", storage_path: "p" }), true);
  assert.equal(subtitleReview.isSubtitleDownloadable({ status: "ready", storage_path: null }), false);
  assert.equal(subtitleReview.isSubtitleDownloadable({ status: "failed", storage_path: "p" }), false);
  assert.equal(subtitleReview.isSubtitleDownloadable(null), false);
});

test("subtitle filenames and language metadata are correct", () => {
  assert.equal(subtitleReview.subtitleFilename("vtt"), "vidora-fa.vtt");
  assert.equal(subtitleReview.subtitleFilename("srt"), "vidora-fa.srt");
  assert.equal(subtitleReview.SUBTITLE_LANG, "fa");
  assert.equal(subtitleReview.SUBTITLE_LABEL, "فارسی");
  // Must NOT use the NLLB model code as the track language.
  assert.notEqual(subtitleReview.SUBTITLE_LANG, "pes_Arab");
});

test("frontend builder version matches the worker builder version (no drift)", () => {
  const py = fs.readFileSync(path.join(root, "worker/app/subtitle_config.py"), "utf8");
  const match = py.match(/BUILDER_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "worker BUILDER_VERSION not found");
  assert.equal(subtitleReview.SUBTITLE_BUILDER_VERSION, match[1]);
});

// ---------------------------------------------------------------------------
// Video insights (consume-only frontend)
// ---------------------------------------------------------------------------

test("insight state derives from status + schema version", () => {
  const insight = (over) => ({ status: "ready", language: "fa", short_summary: "خلاصه", detailed_summary: "کامل",
    key_takeaways: [], provider: "local_transformers", model: "qwen",
    schema_version: insightReview.INSIGHT_SCHEMA_VERSION, source_segment_count: 3, generated_at: "2026-07-12", ...over });
  assert.equal(insightReview.deriveInsightState(insight({})), "ready");
  assert.equal(insightReview.deriveInsightState(insight({ status: "generating" })), "generating");
  assert.equal(insightReview.deriveInsightState(insight({ status: "failed" })), "failed");
  assert.equal(insightReview.deriveInsightState(insight({ status: "stale" })), "stale");
  // Ready row from a different schema version is stale, never shown as current.
  assert.equal(insightReview.deriveInsightState(insight({ schema_version: "ins-s0" })), "stale");
  assert.equal(insightReview.deriveInsightState(null), "none");
});

test("insight Persian state messages are accurate and non-empty", () => {
  for (const state of ["none", "generating", "ready", "failed", "stale"]) {
    assert.ok(insightReview.INSIGHT_STATE_FA[state].length > 5, state);
  }
  assert.match(insightReview.INSIGHT_STATE_FA.failed, /متن و زیرنویس همچنان در دسترس/);
  assert.match(insightReview.INSIGHT_STATE_FA.stale, /تغییر کرده/);
});

test("takeaway seek resolves the first real supporting segment or null", () => {
  const segments = [
    { segment_index: 0, start_ms: 0 },
    { segment_index: 1, start_ms: 9500 },
    { segment_index: 2, start_ms: 20000 },
  ];
  assert.equal(insightReview.takeawaySeekMs({ text: "x", segment_indexes: [2, 1] }, segments), 9500);
  assert.equal(insightReview.takeawaySeekMs({ text: "x", segment_indexes: [0] }, segments), 0);
  // No real supporting segment -> null -> no seek button rendered.
  assert.equal(insightReview.takeawaySeekMs({ text: "x", segment_indexes: [9] }, segments), null);
  assert.equal(insightReview.takeawaySeekMs({ text: "x", segment_indexes: [] }, segments), null);
});

test("active chapter lookup uses chronological non-overlapping ranges", () => {
  const chapters = [
    { chapter_index: 0, start_ms: 0, end_ms: 9500 },
    { chapter_index: 1, start_ms: 9500, end_ms: 29900 },
  ];
  assert.equal(insightReview.activeChapterIndex(chapters, 0), 0);
  assert.equal(insightReview.activeChapterIndex(chapters, 9499), 0);
  assert.equal(insightReview.activeChapterIndex(chapters, 9500), 1);
  assert.equal(insightReview.activeChapterIndex(chapters, 29900), -1);
  assert.equal(insightReview.activeChapterIndex([], 5), -1);
});

test("frontend insight schema version matches the worker (no drift)", () => {
  const py = fs.readFileSync(path.join(root, "worker/app/insight_config.py"), "utf8");
  const match = py.match(/SCHEMA_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "worker SCHEMA_VERSION not found");
  assert.equal(insightReview.INSIGHT_SCHEMA_VERSION, match[1]);
});

test("video chat citation labels are deterministic", () => {
  assert.equal(videoChat.formatCitation({ start_ms: 12000, end_ms: 24000 }), "00:12–00:24");
  assert.equal(videoChat.formatCitation({ start_ms: 0, end_ms: 900 }), "00:00");
});

test("review page adds grounded video chat without replacing existing review tools", () => {
  const source = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
  assert.match(source, /\["chat", "پرسش از ویدیو"\]/);
  assert.match(source, /fetchVideoChatHistory/);
  assert.match(source, /askVideoQuestion/);
  assert.match(source, /formatCitation\(citation\)/);
  assert.match(source, /seekToCitation\(citation\)/);
  assert.match(source, /crypto\.randomUUID\(\)/);
  assert.match(source, /role="tabpanel" aria-label="پرسش از ویدیو"/);
  assert.match(source, /متن و ترجمه/);
  assert.match(source, /"summary", "خلاصه"/);
  assert.match(source, /"chapters", "فصل‌ها"/);
  assert.doesNotMatch(source, /Save to Note|Living Note|ذخیره در یادداشت/);
});

test("video chat client uses authenticated endpoint and owner-scoped history", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/video-chat.ts"), "utf8");
  assert.match(source, /fetchWithAuth/);
  assert.match(source, /video_chat_sessions\?video_id=eq/);
  assert.match(source, /video_chat_messages\?session_id=eq/);
  assert.match(source, /video_chat_message_citations\?video_id=eq/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("living-note AI state derives from status + schema version", () => {
  const note = (over = {}) => ({
    personal_text: "", personal_updated_at: null, ai_status: "ready",
    ai_overview: "x", ai_key_points: [], ai_action_items: [],
    ai_schema_version: noteReview.NOTE_SCHEMA_VERSION, ai_generated_at: "2026-07-14", ai_error_code: null, ...over });
  assert.equal(noteReview.deriveNoteAiState(note({})), "ready");
  assert.equal(noteReview.deriveNoteAiState(note({ ai_status: "generating" })), "generating");
  assert.equal(noteReview.deriveNoteAiState(note({ ai_status: "failed" })), "failed");
  assert.equal(noteReview.deriveNoteAiState(note({ ai_status: "stale" })), "stale");
  // A ready row with a drifted schema version is treated as stale.
  assert.equal(noteReview.deriveNoteAiState(note({ ai_schema_version: "note-s0" })), "stale");
  assert.equal(noteReview.deriveNoteAiState(null), "none");
});

test("living-note state messages are meaningful Persian", () => {
  for (const state of ["none", "generating", "ready", "failed", "stale"]) {
    assert.ok(noteReview.NOTE_AI_STATE_FA[state].length > 5, state);
  }
  assert.match(noteReview.NOTE_AI_STATE_FA.failed, /یادداشت شخصی و پاسخ‌های ذخیره‌شده/);
  assert.match(noteReview.NOTE_AI_STATE_FA.stale, /تغییر کرده/);
});

test("note item seek uses the first citation start or null", () => {
  assert.equal(noteReview.noteItemSeekMs({ text: "x", citations: [{ start_ms: 9500, end_ms: 12000, source_segment_indexes: [1] }] }), 9500);
  assert.equal(noteReview.noteItemSeekMs({ text: "x", citations: [] }), null);
  assert.equal(noteReview.noteItemSeekMs({ text: "x" }), null);
});

test("frontend note schema version matches the worker (no drift)", () => {
  const py = fs.readFileSync(path.join(root, "worker/app/note_config.py"), "utf8");
  const match = py.match(/NOTE_SCHEMA_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "worker NOTE_SCHEMA_VERSION not found");
  assert.equal(noteReview.NOTE_SCHEMA_VERSION, match[1]);
});

test("note client uses the Supabase Edge gateway, authenticated RPCs, and no secrets", () => {
  const source = fs.readFileSync(path.join(root, "src/lib/note-review.ts"), "utf8");
  // AI generation goes through the Edge gateway function, never directly to Modal.
  assert.match(source, /functions\/v1\/video-note/);
  assert.doesNotMatch(source, /modal\.run/);
  // User-authored writes go through owner-checked RPCs (auth.uid()), not direct writes.
  assert.match(source, /rest\/v1\/rpc\/\$\{fn\}/);
  assert.match(source, /"upsert_video_note_personal"/);
  assert.match(source, /"save_video_note_answer"/);
  assert.match(source, /"remove_video_note_answer"/);
  // Owner-scoped reads only.
  assert.match(source, /video_notes\?video_id=eq/);
  assert.match(source, /video_note_saved_answers\?video_id=eq/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY|service_role/);
});

test("review page adds the یادداشت‌ها tab with AI note, saved answers, and autosave", () => {
  const source = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
  assert.match(source, /\["notes", "یادداشت‌ها"\]/);
  assert.match(source, /fetchVideoNote/);
  assert.match(source, /generateVideoNote/);
  assert.match(source, /saveNotePersonalText/);
  assert.match(source, /saveChatAnswerToNote/);
  assert.match(source, /removeSavedAnswer/);
  assert.match(source, /افزودن به یادداشت/);
  assert.match(source, /role="tabpanel" aria-label="یادداشت‌های این ویدیو"/);
  // Existing review tools remain.
  assert.match(source, /"chat", "پرسش از ویدیو"/);
  assert.match(source, /متن و ترجمه/);
});

test("review page adds insight tabs with seek actions and keeps transcript usable", () => {
  const source = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
  // Tabs exist with the required Persian labels and tab semantics.
  assert.match(source, /role="tablist"/);
  assert.match(source, /متن و ترجمه/);
  assert.match(source, /"summary", "خلاصه"/);
  assert.match(source, /"chapters", "فصل‌ها"/);
  // Chapter click seeks the existing player; takeaway seek reuses segment seek.
  assert.match(source, /seekToChapter\(chapter, position\)/);
  assert.match(source, /seekToTakeaway\(takeaway\)/);
  assert.match(source, /takeawaySeekMs\(takeaway, segments\) !== null/);
  // Insight failure never hides transcript review (fallback state in loader).
  assert.match(source, /setInsightState\(\{ loading: false, state: "none", insight: null, chapters: \[\] \}\)/);
  // Insight status messages come from the shared Persian map; no raw errors.
  assert.match(source, /INSIGHT_STATE_FA\[/);
  // The browser never writes insights (read-only consumption).
  assert.doesNotMatch(source, /persist_video_insight|set_video_insight_status|mark_video_insights_stale/);
});

test("review page attaches a Persian VTT track and secure downloads, and never generates artifacts", () => {
  const source = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
  assert.match(source, /kind="subtitles"/);
  assert.match(source, /srcLang=\{SUBTITLE_LANG\}/);
  assert.match(source, /label=\{SUBTITLE_LABEL\}/);
  assert.match(source, /downloadSubtitle\(subtitles\.(vtt|srt)\)/);
  // Default-on is applied via TextTrack mode, and refresh is bounded.
  assert.match(source, /track\.mode = show \? "showing" : "hidden"/);
  assert.match(source, /subtitleRetryRef\.current >= 1/);
  // The browser must not build authoritative subtitle files.
  assert.doesNotMatch(source, /WEBVTT|to_vtt|buildCues|content_hash/);
});
