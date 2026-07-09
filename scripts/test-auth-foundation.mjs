import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vidora-auth-tests-"));

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
compileTs("src/lib/return-to.ts", "return-to.mjs");

const appError = await import(pathToFileURL(path.join(tmp, "app-error.mjs")));
const envCore = await import(pathToFileURL(path.join(tmp, "env-core.mjs")));
const returnTo = await import(pathToFileURL(path.join(tmp, "return-to.mjs")));

test("missing and placeholder environment is classified as configuration", () => {
  assert.throws(
    () => envCore.resolveBrowserEnv({}, "http://localhost:5173"),
    (error) => error.code === "CONFIG_MISSING" && error.messageFa === "اتصال به سرویس احراز هویت پیکربندی نشده است.",
  );
  assert.throws(
    () => envCore.resolveBrowserEnv({ VITE_SUPABASE_URL: "https://your-project-ref.supabase.co", VITE_SUPABASE_ANON_KEY: "your-public-anon-key" }, "http://localhost:5173"),
    (error) => error.code === "CONFIG_MISSING",
  );
});

test("malformed Supabase URL is classified as configuration invalid", () => {
  assert.throws(
    () => envCore.resolveBrowserEnv({ VITE_SUPABASE_URL: "not-a-url", VITE_SUPABASE_ANON_KEY: "public-key" }, "http://localhost:5173"),
    (error) => error.code === "CONFIG_INVALID",
  );
});

test("usable environment resolves normalized values", () => {
  const env = envCore.resolveBrowserEnv({ VITE_SUPABASE_URL: "https://abc.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon", VITE_APP_URL: "http://localhost:5173/" }, "http://fallback");
  assert.equal(env.supabaseUrl, "https://abc.supabase.co");
  assert.equal(env.supabaseAnonKey, "anon");
  assert.equal(env.appUrl, "http://localhost:5173");
});

test("auth error mapper distinguishes common Supabase failures", () => {
  assert.equal(appError.mapSupabaseAuthError(400, { message: "Invalid login credentials" }).code, "INVALID_CREDENTIALS");
  assert.equal(appError.mapSupabaseAuthError(400, { error_code: "user_already_exists" }).code, "DUPLICATE_ACCOUNT");
  assert.equal(appError.mapSupabaseAuthError(403, { error_code: "signup_disabled" }).code, "SIGNUP_DISABLED");
  assert.equal(appError.mapSupabaseAuthError(400, { error_code: "email_not_confirmed" }).code, "EMAIL_CONFIRMATION_REQUIRED");
  assert.equal(appError.mapSupabaseAuthError(422, { error_code: "weak_password" }).code, "WEAK_PASSWORD");
  assert.equal(appError.mapSupabaseAuthError(429, { message: "Too many requests" }).code, "RATE_LIMIT");
});

test("actual network failures are the only generic network classification", () => {
  const mapped = appError.toAppError(new TypeError("Failed to fetch"));
  assert.equal(mapped.code, "NETWORK_FAILURE");
  assert.match(mapped.messageFa, /ارتباط با سرور برقرار نشد/);
});

test("returnTo sanitizer allows internal routes and rejects external routes", () => {
  assert.equal(returnTo.sanitizeReturnTo("/dashboard/new-translation"), "/dashboard/new-translation");
  assert.equal(returnTo.sanitizeReturnTo("/watch/future-of-ai"), "/watch/future-of-ai");
  assert.equal(returnTo.sanitizeReturnTo("https://evil.example/dashboard"), "/dashboard");
  assert.equal(returnTo.sanitizeReturnTo("//evil.example"), "/dashboard");
  assert.equal(returnTo.sanitizeReturnTo("/admin"), "/dashboard");
});

test("hash login returnTo rejects external destinations", () => {
  global.window = { location: { hash: "#/login?returnTo=https%3A%2F%2Fevil.example" } };
  assert.equal(returnTo.getReturnToFromHash(), "/dashboard");
  global.window = { location: { hash: "#/login?returnTo=%2Fdashboard%2Fvideos" } };
  assert.equal(returnTo.getReturnToFromHash(), "/dashboard/videos");
});
