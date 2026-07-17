import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  DASHBOARD_PREVIEW_PATH,
  createDashboardPreviewGuard,
  isDashboardPreviewEnabled,
} from "../config/dashboard-preview.mjs";

const root = process.cwd();

function runGuard(enabled, url) {
  let nextCalled = false;
  let body = "";
  const headers = new Map();
  const response = {
    statusCode: 200,
    statusMessage: "OK",
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = "") { body = value; },
  };
  createDashboardPreviewGuard(enabled)({ url }, response, () => { nextCalled = true; });
  return { body, headers, nextCalled, response };
}

test("preview requires development serve mode, NODE_ENV, and explicit flag", () => {
  const base = { command: "serve", mode: "development", nodeEnv: "development", flag: "true" };
  assert.equal(isDashboardPreviewEnabled(base), true);
  assert.equal(isDashboardPreviewEnabled({ ...base, command: "build" }), false);
  assert.equal(isDashboardPreviewEnabled({ ...base, mode: "production" }), false);
  assert.equal(isDashboardPreviewEnabled({ ...base, nodeEnv: "production" }), false);
  assert.equal(isDashboardPreviewEnabled({ ...base, flag: "false" }), false);
  assert.equal(isDashboardPreviewEnabled({ ...base, flag: "TRUE" }), false);
});

test("disabled preview returns a real no-store 404 response", () => {
  const result = runGuard(false, `${DASHBOARD_PREVIEW_PATH}?responsive=1`);
  assert.equal(result.nextCalled, false);
  assert.equal(result.response.statusCode, 404);
  assert.equal(result.body, "Not Found");
  assert.equal(result.headers.get("cache-control"), "no-store");
});

test("enabled preview and unrelated routes continue to Vite", () => {
  assert.equal(runGuard(true, DASHBOARD_PREVIEW_PATH).nextCalled, true);
  assert.equal(runGuard(false, "/dashboard").nextCalled, true);
});

test("client preview is compile-time guarded while the real dashboard remains protected", () => {
  const source = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
  assert.match(source, /__VIDORA_DASHBOARD_PREVIEW_ENABLED__\s*&&\s*path === "\/dev\/dashboard-preview"/);
  assert.match(source, /React\.lazy\(async \(\) =>/);
  assert.match(source, /return <ProtectedDashboard returnTo=\{getCurrentInternalPath\(\)\}/);
  assert.match(source, /if \(previewMode\) return undefined;/);
});
