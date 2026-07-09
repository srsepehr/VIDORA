-- Vidora phase 2: real upload + URL submission + durable job queue foundation.
-- Additive only. Safe to run on a database that already applied
-- 202607080001_initial_schema.sql. Apply with: supabase db push
-- (or paste into the Supabase SQL editor).

-- ---------------------------------------------------------------------------
-- Enum extensions (additive; old values are kept for existing rows)
-- ---------------------------------------------------------------------------

alter type public.video_source_type add value if not exists 'direct_media_url';
alter type public.video_source_type add value if not exists 'supported_external_url';
alter type public.video_status add value if not exists 'acquiring_source';

-- ---------------------------------------------------------------------------
-- videos: subtitle outputs + detected language
-- ---------------------------------------------------------------------------

alter table public.videos add column if not exists subtitle_vtt_storage_key text;
alter table public.videos add column if not exists subtitle_srt_storage_key text;
alter table public.videos add column if not exists detected_language text;

-- ---------------------------------------------------------------------------
-- video_jobs: durable queue fields (leasing, heartbeat, retry budget)
-- ---------------------------------------------------------------------------

alter table public.video_jobs add column if not exists progress_current bigint;
alter table public.video_jobs add column if not exists progress_total bigint;
alter table public.video_jobs add column if not exists max_attempts integer not null default 3;
alter table public.video_jobs add column if not exists worker_id text;
alter table public.video_jobs add column if not exists lease_expires_at timestamptz;
alter table public.video_jobs add column if not exists heartbeat_at timestamptz;
alter table public.video_jobs add column if not exists retryable boolean not null default true;

do $$
begin
  alter table public.video_jobs add constraint video_jobs_max_attempts_positive check (max_attempts > 0);
exception when duplicate_object then null;
end $$;

-- Idempotency: at most one live (queued or running) job per video.
create unique index if not exists video_jobs_one_active_per_video
  on public.video_jobs (video_id)
  where status in ('queued', 'running');

create index if not exists video_jobs_queue_scan_idx
  on public.video_jobs (status, created_at)
  where status = 'queued';

-- ---------------------------------------------------------------------------
-- RLS: owner-scoped writes needed by the dashboard flows
-- ---------------------------------------------------------------------------

-- The client may only move its own videos between pre-worker states.
drop policy if exists videos_update_own_safe on public.videos;
create policy videos_update_own_safe on public.videos for update to authenticated
  using (
    user_id = auth.uid()
    and status in ('created', 'uploading', 'uploaded', 'validating', 'queued', 'failed', 'cancelled')
  )
  with check (
    user_id = auth.uid()
    and status in ('created', 'uploading', 'uploaded', 'validating', 'queued', 'failed', 'cancelled')
  );

-- Deleting is only allowed while no worker owns the video.
drop policy if exists videos_delete_own_safe on public.videos;
create policy videos_delete_own_safe on public.videos for delete to authenticated
  using (
    user_id = auth.uid()
    and status in ('created', 'uploading', 'uploaded', 'queued', 'failed', 'cancelled', 'completed')
  );

-- The client may cancel its own queued job. Other transitions belong to the
-- worker (service role bypasses RLS).
drop policy if exists video_jobs_cancel_own_queued on public.video_jobs;
create policy video_jobs_cancel_own_queued on public.video_jobs for update to authenticated
  using (user_id = auth.uid() and status = 'queued')
  with check (user_id = auth.uid() and status in ('queued', 'cancelled'));

grant update (title, status, failure_code, failure_message_fa, storage_key, original_filename, mime_type, file_size_bytes, source_url) on public.videos to authenticated;
grant delete on public.videos to authenticated;
grant update (status, finished_at, error_code, error_message) on public.video_jobs to authenticated;

-- Users may remove their own uploaded source objects (delete flow).
drop policy if exists storage_delete_own_video_sources on storage.objects;
create policy storage_delete_own_video_sources on storage.objects for delete to authenticated using (
  bucket_id = 'vidora-video-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Atomic, idempotent enqueue. SECURITY DEFINER so the transition
-- (video -> queued) + job insert happen in one transaction, while ownership
-- is verified explicitly against auth.uid(). Returns the live job (existing
-- one when called twice), so double-clicks never create duplicates.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_video_processing(p_video_id uuid)
returns public.video_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_video public.videos;
  v_job public.video_jobs;
begin
  select * into v_video
  from public.videos
  where id = p_video_id and user_id = auth.uid()
  for update;

  if v_video.id is null then
    raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Idempotency: return the existing live job when one is already queued/running.
  select * into v_job
  from public.video_jobs
  where video_id = p_video_id and status in ('queued', 'running')
  limit 1;
  if v_job.id is not null then
    return v_job;
  end if;

  if v_video.status not in ('created', 'uploading', 'uploaded', 'validating', 'failed', 'cancelled', 'queued') then
    raise exception 'VIDEO_NOT_ENQUEUEABLE' using errcode = 'P0003';
  end if;

  -- Uploads must reference a stored object before they can be queued.
  if v_video.source_type = 'upload' and v_video.storage_key is null then
    raise exception 'VIDEO_SOURCE_MISSING' using errcode = 'P0004';
  end if;

  update public.videos
  set status = 'queued', failure_code = null, failure_message_fa = null
  where id = p_video_id;

  insert into public.video_jobs (video_id, user_id, stage, status, attempt, max_attempts, retryable)
  values (
    p_video_id,
    auth.uid(),
    'queued',
    'queued',
    coalesce((select max(attempt) from public.video_jobs where video_id = p_video_id), 0) + 1,
    3,
    true
  )
  returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.enqueue_video_processing(uuid) from public, anon;
grant execute on function public.enqueue_video_processing(uuid) to authenticated;

-- Cancel helper: cancels the live queued job and marks the video cancelled in
-- one transaction. No-op error if nothing is safely cancellable.
create or replace function public.cancel_video_processing(p_video_id uuid)
returns public.videos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_video public.videos;
begin
  select * into v_video
  from public.videos
  where id = p_video_id and user_id = auth.uid()
  for update;

  if v_video.id is null then
    raise exception 'VIDEO_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_video.status not in ('created', 'uploading', 'uploaded', 'validating', 'queued') then
    raise exception 'VIDEO_NOT_CANCELLABLE' using errcode = 'P0005';
  end if;

  update public.video_jobs
  set status = 'cancelled', finished_at = now()
  where video_id = p_video_id and status = 'queued';

  update public.videos
  set status = 'cancelled'
  where id = p_video_id
  returning * into v_video;

  return v_video;
end;
$$;

revoke all on function public.cancel_video_processing(uuid) from public, anon;
grant execute on function public.cancel_video_processing(uuid) to authenticated;
