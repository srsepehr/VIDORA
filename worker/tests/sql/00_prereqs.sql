-- Minimal, faithful stand-ins for the Supabase-managed objects the worker
-- migration depends on, so the REAL migration SQL can be loaded and exercised
-- against a plain local Postgres. Only what the worker RPCs touch is created.

create schema if not exists auth;

-- Roles Supabase provides. NOLOGIN test roles are enough for grant statements.
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

-- auth.uid() reads a per-session GUC we set from tests to impersonate a user.
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('app.current_user', true), '')::uuid
$$;

-- Supabase's shared updated_at trigger function (used by artifact tables).
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Minimal storage schema stubs so migrations that declare storage.objects
-- policies load against a plain Postgres.
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text
);
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select string_to_array(name, '/')
$$;

-- auth.users stub (video_jobs.user_id FKs to it in the real schema; here we
-- keep it minimal and do not enforce the FK to avoid seeding users).
create table if not exists auth.users (id uuid primary key);

-- Enums (copied verbatim from the initial schema).
do $$ begin
  create type public.video_source_type as enum ('upload', 'youtube', 'supported_url', 'direct_media_url', 'supported_external_url');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.video_status as enum (
    'created','uploading','uploaded','validating','queued','acquiring_source',
    'downloading_source','extracting_audio','transcribing','translating',
    'generating_subtitles','rendering','uploading_result','completed','failed','cancelled'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.video_job_status as enum ('queued','running','completed','failed','cancelled');
exception when duplicate_object then null; end $$;

-- videos: only the columns the worker RPCs read/write.
create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  source_type public.video_source_type not null default 'upload',
  source_url text,
  storage_key text,
  status public.video_status not null default 'created',
  duration_seconds integer,
  detected_language text,
  failure_code text,
  failure_message_fa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- video_jobs: the full set of columns migration 2 added, as the RPCs expect.
create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null,
  stage public.video_status not null default 'queued',
  status public.video_job_status not null default 'queued',
  progress_percent integer not null default 0,
  progress_current bigint,
  progress_total bigint,
  attempt integer not null default 1,
  max_attempts integer not null default 3,
  provider text,
  provider_job_id text,
  worker_id text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  retryable boolean not null default true,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The subtitle-artifact RLS policy checks ownership through public.videos, so
-- the client role needs read access to it (as it does in the real schema).
grant select on public.videos to authenticated;

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  segment_index integer not null,
  start_ms integer not null,
  end_ms integer not null,
  source_text text not null,
  translated_text_fa text,
  confidence numeric(5,4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, segment_index)
);
