import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vidora-subscription-tests-"));

function compileTs(source, targetName) {
  const input = fs.readFileSync(path.join(root, source), "utf8");
  const js = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler },
  }).outputText.replace(/from "\.\/([^"]+)"/g, 'from "./$1.mjs"');
  const out = path.join(tmp, targetName);
  fs.writeFileSync(out, js);
  return out;
}

compileTs("src/lib/routes.ts", "routes.mjs");
compileTs("src/lib/return-to.ts", "return-to.mjs");
compileTs("src/lib/auth-intent.ts", "auth-intent.mjs");
compileTs("src/lib/subscription-access.ts", "subscription-access.mjs");
compileTs("src/lib/payment.ts", "payment.mjs");

const load = (name) => import(pathToFileURL(path.join(tmp, name)));
const returnTo = await load("return-to.mjs");
const authIntent = await load("auth-intent.mjs");
const access = await load("subscription-access.mjs");
const payment = await load("payment.mjs");

function memoryWindow(hash = "#/") {
  const values = new Map();
  global.window = {
    location: { hash },
    sessionStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  };
  return values;
}

test("direct login defaults to the dashboard", () => assert.equal(returnTo.sanitizeReturnTo(null), "/dashboard"));
test("approved dashboard routes survive validation", () => assert.equal(returnTo.sanitizeReturnTo("/dashboard/new-translation"), "/dashboard/new-translation"));
test("private video detail UUID routes survive validation", () => assert.equal(returnTo.sanitizeReturnTo("/dashboard/videos/63bf51e8-9d81-4187-a045-332fad75409a"), "/dashboard/videos/63bf51e8-9d81-4187-a045-332fad75409a"));
test("watch destinations survive validation", () => assert.equal(returnTo.sanitizeReturnTo("/watch/future-of-ai"), "/watch/future-of-ai"));
test("external destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("https://evil.example"), "/dashboard"));
test("protocol-relative destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("//evil.example/path"), "/dashboard"));
test("encoded external destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("https%3A%2F%2Fevil.example"), "/dashboard"));
test("double-encoded external destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("https%253A%252F%252Fevil.example"), "/dashboard"));
test("javascript destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("javascript:alert(1)"), "/dashboard"));
test("backslash destinations are rejected", () => assert.equal(returnTo.sanitizeReturnTo("/\\evil.example"), "/dashboard"));
test("nested redirect query parameters are rejected", () => assert.equal(returnTo.sanitizeReturnTo("/subscriptions?returnTo=https://evil.example"), "/dashboard"));
test("plan query accepts only a compact slug", () => assert.equal(returnTo.sanitizeReturnTo("/subscriptions?plan=pro"), "/subscriptions?plan=pro"));
test("search query remains internal", () => assert.equal(returnTo.sanitizeReturnTo("/search?q=%D9%87%D9%88%D8%B4"), "/search?q=%D9%87%D9%88%D8%B4"));

test("general auth intent persists and restores", () => {
  memoryWindow();
  const record = authIntent.persistAuthIntent(authIntent.createAuthIntent({ intent: "general-entry", returnTo: "/dashboard", now: 1000 }));
  assert.equal(authIntent.readAuthIntent(1001).intent, "general-entry");
  assert.equal(record.returnTo, "/dashboard");
});

test("watch intent keeps the exact safe video", () => {
  memoryWindow();
  const record = authIntent.createAuthIntent({ intent: "watch-video", returnTo: "/watch/future-of-ai", now: 1000 });
  assert.equal(record.returnTo, "/watch/future-of-ai");
});

test("selected plan survives authentication", () => {
  memoryWindow();
  authIntent.persistAuthIntent(authIntent.createAuthIntent({ intent: "buy-subscription", returnTo: "/subscriptions?plan=pro", planSlug: "pro", now: 1000 }));
  assert.equal(authIntent.readAuthIntent(1001).planSlug, "pro");
});

test("invalid selected plan is discarded", () => {
  const record = authIntent.createAuthIntent({ intent: "buy-subscription", planSlug: "../../admin", now: 1000 });
  assert.equal(record.planSlug, undefined);
});

test("expired intents are cleared", () => {
  const values = memoryWindow();
  authIntent.persistAuthIntent(authIntent.createAuthIntent({ intent: "add-video", returnTo: "/dashboard/new-translation", now: 1000 }));
  assert.equal(authIntent.readAuthIntent(1000 + 31 * 60 * 1000), null);
  assert.equal(values.size, 0);
});

test("consumed intents cannot be reused", () => {
  memoryWindow();
  authIntent.persistAuthIntent(authIntent.createAuthIntent({ intent: "general-entry", now: 1000 }));
  assert.equal(authIntent.consumeAuthIntent(1001).intent, "general-entry");
  assert.equal(authIntent.readAuthIntent(1001), null);
});

test("auth hash carries explicit general intent", () => {
  memoryWindow();
  const hash = authIntent.buildAuthHash({ intent: "general-entry", returnTo: "/dashboard" });
  assert.match(hash, /^#\/login\?/);
  assert.match(hash, /intent=general-entry/);
});

const active = { status: "active", starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" };
test("current server subscription is active", () => assert.equal(access.isSubscriptionActive(active, Date.parse("2026-07-01T00:00:00Z")), true));
test("expired server subscription is inactive", () => assert.equal(access.isSubscriptionActive(active, Date.parse("2027-07-01T00:00:00Z")), false));
test("future server subscription is inactive", () => assert.equal(access.isSubscriptionActive(active, Date.parse("2025-07-01T00:00:00Z")), false));
test("pending subscriptions are inactive", () => assert.equal(access.isSubscriptionActive({ ...active, status: "pending" }), false));
test("guest playback requires authentication", () => assert.equal(access.canWatchLibraryVideo("guest").reason, "AUTH_REQUIRED"));
test("authenticated inactive playback requires subscription", () => assert.equal(access.canWatchLibraryVideo("inactive").reason, "SUBSCRIPTION_REQUIRED"));
test("active subscribers may play", () => assert.equal(access.canWatchLibraryVideo("active").allowed, true));

test("payment boundary never reports fake success", async () => {
  await assert.rejects(payment.paymentAdapter.startCheckout({ planSlug: "pro", returnTo: "/dashboard" }), (error) => error.code === "PAYMENT_NOT_CONFIGURED");
});

test("landing and auth UI contain the required intent-aware states", () => {
  const source = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
  const header = source.slice(source.lastIndexOf("function EditorialHeader"), source.indexOf("window.EditorialHeader", source.lastIndexOf("function EditorialHeader")));
  const hero = source.slice(source.lastIndexOf("function EditorialHero"), source.indexOf("window.EditorialHero", source.lastIndexOf("function EditorialHero")));
  assert.match(header, /ورود \/ عضویت/);
  assert.match(header, /profile_menu_opened/);
  assert.doesNotMatch(header, /d\.nav\.product/);
  assert.match(hero, /general-entry/);
  assert.doesNotMatch(hero, /d\.ctaSecondary/);
  assert.doesNotMatch(hero, /d\.heroChips/);
});

test("Library playback distinguishes guest, inactive, and active states", () => {
  const source = fs.readFileSync(path.join(root, "src/library.jsx"), "utf8");
  const watch = source.slice(source.indexOf("function WatchPageInner"), source.indexOf("// ---------------------------------------------------------------------------\n// Exports"));
  assert.match(watch, /subscriptionState === "guest"/);
  assert.match(watch, /subscriptionState === "inactive"/);
  assert.match(watch, /subscriptionState === "active"/);
  assert.match(watch, /intent: "watch-video"/);
  assert.doesNotMatch(watch, /access\.\$\{video\.access\}/);
});

test("dashboard prompt and paid upload lock are both present", () => {
  const source = fs.readFileSync(path.join(root, "src/main.jsx"), "utf8");
  const dashboard = source.slice(source.indexOf("function VidoraDashboard"), source.indexOf("function LoginPage"));
  assert.match(dashboard, /subscriptionPromptOpen/);
  assert.match(dashboard, /dashboard_subscription_popup_viewed/);
  assert.match(dashboard, /افزودن و ترجمه ویدیو به اشتراک نیاز دارد/);
  assert.doesNotMatch(dashboard, /\["pro",\s*t\.subscription\.pro,\s*"\$19"/);
});
