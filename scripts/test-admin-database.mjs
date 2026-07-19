import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const db = new PGlite();
let assertions = 0;

function ok(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

async function expectDenied(sql, message) {
  let denied = false;
  try {
    await db.query(sql);
  } catch (error) {
    denied = /ADMIN_(?:PERMISSION_DENIED|ACCESS_REQUIRED)|permission denied/i.test(String(error?.message || error));
  }
  ok(denied, message);
}

await db.exec(`
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create table auth.users (
    id uuid primary key, email text, phone text,
    created_at timestamptz not null default now(), last_sign_in_at timestamptz,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text, name text
  );
  create function storage.foldername(text) returns text[] language sql immutable as
    $$ select string_to_array($1, '/') $$;
`);

const migrations = [
  "202607080001_initial_schema.sql",
  "202607090001_video_pipeline_foundation.sql",
  "202607100001_video_worker_queue.sql",
  "202607110001_subtitle_artifacts.sql",
  "202607120001_video_insights.sql",
  "202607190001_admin_operations.sql",
];

for (const migration of migrations) {
  const sql = (await readFile(resolve(root, "supabase/migrations", migration), "utf8"))
    // PGlite has gen_random_uuid built in but does not package the extension
    // control file. Supabase PostgreSQL installs pgcrypto normally.
    .replace(/^create extension if not exists pgcrypto;$/gm, "");
  await db.exec(sql);
}
ok(true, "all admin schema dependencies and the admin migration compile");

const ids = {
  ordinary: "10000000-0000-4000-8000-000000000001",
  superAdmin: "10000000-0000-4000-8000-000000000002",
  content: "10000000-0000-4000-8000-000000000003",
  finance: "10000000-0000-4000-8000-000000000004",
  privateVideo: "20000000-0000-4000-8000-000000000001",
  category: "30000000-0000-4000-8000-000000000001",
  libraryVideo: "30000000-0000-4000-8000-000000000002",
  plan: "40000000-0000-4000-8000-000000000001",
  subscription: "40000000-0000-4000-8000-000000000002",
};

await db.query(
  `insert into auth.users(id,email,raw_user_meta_data) values
    ($1,'person@example.com','{"display_name":"کاربر"}'),
    ($2,'root@example.com','{"display_name":"مدیر"}'),
    ($3,'content@example.com','{"display_name":"محتوا"}'),
    ($4,'finance@example.com','{"display_name":"مالی"}')`,
  [ids.ordinary, ids.superAdmin, ids.content, ids.finance],
);
await db.query(
  `insert into public.admin_memberships(user_id,role,status) values
    ($1,'super_admin','active'),($2,'content_manager','active'),($3,'finance','active')`,
  [ids.superAdmin, ids.content, ids.finance],
);

await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.ordinary]);
await expectDenied("select public.admin_get_context()", "a normal authenticated user cannot obtain admin context");

await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.superAdmin]);
const context = await db.query("select public.admin_get_context() as value");
assert.equal(context.rows[0].value.role, "super_admin");
assert.equal(context.rows[0].value.permissions.includes("team.manage"), true);
assertions += 2;

await db.query(
  `insert into public.videos(id,user_id,source_type,original_filename,status)
   values($1,$2,'upload','private.mp4','uploaded')`,
  [ids.privateVideo, ids.ordinary],
);
const playbackProperties = JSON.stringify({
  video_id: ids.privateVideo,
  playback_session_id: "60000000-0000-4000-8000-000000000001",
  duration_seconds: 100,
  watched_seconds: 250,
  progress_percent: 100,
});
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.ordinary]);
const ownEvent = await db.query(
  `select public.record_product_event(gen_random_uuid(),'video_started',now(),gen_random_uuid(),gen_random_uuid(),null,null,'desktop','Chrome',$1::jsonb) as value`,
  [playbackProperties],
);
assert.equal(ownEvent.rows[0].value, true);
const boundedPlayback = await db.query("select watched_seconds,max_progress_percent from public.video_playback_sessions where video_id=$1", [ids.privateVideo]);
assert.equal(Number(boundedPlayback.rows[0].watched_seconds), 100);
assert.equal(Number(boundedPlayback.rows[0].max_progress_percent), 100);
assertions += 3;
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.finance]);
let privateEventDenied = false;
try {
  await db.query(
    `select public.record_product_event(gen_random_uuid(),'video_started',now(),gen_random_uuid(),gen_random_uuid(),null,null,'desktop','Chrome',$1::jsonb)`,
    [playbackProperties],
  );
} catch (error) {
  privateEventDenied = /EVENT_VIDEO_DENIED/.test(String(error?.message || error));
}
ok(privateEventDenied, "a non-owner cannot attribute playback events to a private upload");
await db.query(
  "insert into public.library_categories(id,slug,title_fa) values($1,'test','آزمایشی')",
  [ids.category],
);
await db.query(
  `insert into public.library_videos(id,category_id,title_fa,description_fa,thumbnail_url,duration_seconds)
   values($1,$2,'عمومی','شرح','/thumb.jpg',60)`,
  [ids.libraryVideo, ids.category],
);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.content]);
const contentRows = await db.query("select public.admin_list_videos('all',null,1,25) as value");
assert.deepEqual(contentRows.rows[0].value.items.map((item) => item.kind), ["library"]);
assertions += 1;

await db.query(
  `insert into public.plans(id,slug,name_fa,description_fa,price,billing_period_days,included_minutes,max_file_size_bytes,max_video_duration_seconds)
   values($1,'test-plan','آزمایشی','شرح',10,30,100,1000000,3600)`,
  [ids.plan],
);
await db.query(
  `insert into public.subscriptions(id,user_id,plan_id,status,starts_at,ends_at,included_minutes)
   values($1,$2,$3,'active',now(),now()+interval '30 days',100)`,
  [ids.subscription, ids.finance, ids.plan],
);
await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.finance]);
const subscriptions = await db.query("select public.admin_list_subscriptions(null,null,1,25) as value");
assert.equal(subscriptions.rows[0].value.items[0].email, "f•••@example.com");
assertions += 1;
await expectDenied("select public.admin_list_users(null::text,'{}'::jsonb,1,25)", "finance cannot list users or read profile PII");

await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.superAdmin]);
const auditId = "50000000-0000-4000-8000-000000000001";
await db.query(
  `insert into public.admin_audit_logs(id,actor_user_id,actor_role,action_type,target_entity_type,reason,request_id,success)
   values($1,$2,'super_admin','test.action','test','test reason',gen_random_uuid(),true)`,
  [auditId, ids.superAdmin],
);
let immutable = false;
try {
  await db.query("update public.admin_audit_logs set reason='changed' where id=$1", [auditId]);
} catch (error) {
  immutable = /ADMIN_AUDIT_IMMUTABLE/.test(String(error?.message || error));
}
ok(immutable, "admin audit records reject updates");

await db.close();
process.stdout.write(`Admin database tests passed (${assertions} assertions).\n`);
