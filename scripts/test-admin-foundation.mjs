import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const migration = fs.readFileSync(path.join(root, "supabase/migrations/202607190001_admin_operations.sql"), "utf8");
const adminClient = fs.readFileSync(path.join(root, "src/lib/admin.ts"), "utf8");
const analytics = fs.readFileSync(path.join(root, "src/lib/analytics.ts"), "utf8");
const review = fs.readFileSync(path.join(root, "src/video-review.jsx"), "utf8");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vidora-admin-tests-"));

function compileTs(source, targetName) {
  const input = fs.readFileSync(path.join(root, source), "utf8");
  const js = ts.transpileModule(input, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Bundler },
  }).outputText.replace(/from "\.\/([^"]+)"/g, 'from "./$1.mjs"');
  const out = path.join(tmp, targetName);
  fs.writeFileSync(out, js);
  return out;
}

compileTs("src/lib/admin-permissions.ts", "admin-permissions.mjs");
compileTs("src/lib/routes.ts", "routes.mjs");
compileTs("src/lib/return-to.ts", "return-to.mjs");

const permissions = await import(pathToFileURL(path.join(tmp, "admin-permissions.mjs")));
const returnTo = await import(pathToFileURL(path.join(tmp, "return-to.mjs")));

test("all requested admin roles are centralized", () => {
  assert.deepEqual(permissions.ADMIN_ROLES, ["super_admin", "operations", "support", "analyst", "content_manager", "finance"]);
  assert.equal(permissions.hasAdminPermission({ permissions: ["analytics.read"] }, "analytics.read"), true);
  assert.equal(permissions.hasAdminPermission({ permissions: ["analytics.read"] }, "users.suspend"), false);
});

test("admin return routes are internal and external redirects stay rejected", () => {
  assert.equal(returnTo.sanitizeReturnTo("/admin"), "/admin");
  assert.equal(returnTo.sanitizeReturnTo("/admin/users/63bf51e8-9d81-4187-a045-332fad75409a"), "/admin/users/63bf51e8-9d81-4187-a045-332fad75409a");
  assert.equal(returnTo.sanitizeReturnTo("/admin/../../checkout"), "/dashboard");
  assert.equal(returnTo.sanitizeReturnTo("https://evil.example/admin"), "/dashboard");
});

test("admin tables are RPC-only and normal users cannot read them", () => {
  for (const table of ["admin_memberships", "admin_audit_logs", "subscription_adjustments", "payment_records", "product_events"]) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.doesNotMatch(migration, /create policy .*admin_memberships.*authenticated/i);
});

test("every admin RPC resolves permission server-side", () => {
  for (const permission of ["users.read", "subscriptions.read", "payments.read", "jobs.read", "videos.read", "analytics.read", "system.read", "audit.read", "team.read"]) {
    assert.match(migration, new RegExp(`admin_require_permission\\('${permission.replace(".", "\\.")}'\\)`));
  }
  assert.match(adminClient, /admin_get_context/);
  assert.match(adminClient, /UNAUTHORIZED/);
});

test("support compensation is limited and analyst has no mutation permissions", () => {
  assert.match(migration, /v_role='support' and \(p_days<1 or p_days>7\)/);
  assert.match(migration, /'SUPPORT_LIMIT_EXCEEDED'/);
  const analystSeeds = [...migration.matchAll(/\('analyst',\s*'([^']+)'\)/g)].map((match) => match[1]);
  assert.deepEqual(analystSeeds.sort(), ["analytics.read", "overview.read"]);
});

test("subscription adjustment and retry are transactional, idempotent and audited", () => {
  assert.match(migration, /unique \(actor_user_id, action_type, request_id\)/);
  assert.match(migration, /unique \(actor_user_id, request_id\)/);
  assert.match(migration, /admin_adjust_subscription_days[\s\S]*insert into public\.subscription_adjustments/);
  assert.match(migration, /admin_adjust_subscription_days[\s\S]*admin_write_audit/);
  assert.match(migration, /admin_retry_translation_job[\s\S]*status in \('queued','running'\)/);
});

test("audit records cannot be edited or deleted", () => {
  assert.match(migration, /ADMIN_AUDIT_IMMUTABLE/);
  assert.match(migration, /before update or delete on public\.admin_audit_logs/);
  assert.doesNotMatch(migration, /grant (?:update|delete).*admin_audit_logs/i);
});

test("analytics is bounded and playback progress ignores seek jumps", () => {
  assert.match(migration, /octet_length\(coalesce\(p_properties/);
  assert.match(migration, /on conflict \(event_id\) do nothing/);
  assert.match(analytics, /delta > 0 && delta <= 4/);
  assert.match(analytics, /Math\.floor\(\(this\.watchedSeconds \/ duration\) \* 20\) \* 5/);
  assert.match(review, /onPlay=\{\(event\) => playbackTracker\.play/);
  assert.match(review, /onEnded=\{\(event\) => playbackTracker\.ended/);
});

test("last super administrator is protected", () => {
  assert.match(migration, /LAST_SUPER_ADMIN/);
  assert.match(migration, /count\(\*\) from public\.admin_memberships where role='super_admin' and status='active'/);
});

