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
compileTs("src/lib/env.ts", "env.mjs");
compileTs("src/lib/auth.ts", "auth.mjs");
compileTs("src/lib/access-policy.ts", "access-policy.mjs");
compileTs("src/lib/video-config.ts", "video-config.mjs");
compileTs("src/lib/video-sources.ts", "video-sources.mjs");
compileTs("src/lib/video-storage.ts", "video-storage.mjs");
compileTs("src/lib/video-service.ts", "video-service.mjs");

const load = (name) => import(pathToFileURL(path.join(tmp, name)));
const videoConfig = await load("video-config.mjs");
const videoSources = await load("video-sources.mjs");
const videoStorage = await load("video-storage.mjs");
const videoService = await load("video-service.mjs");
const accessPolicy = await load("access-policy.mjs");

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
