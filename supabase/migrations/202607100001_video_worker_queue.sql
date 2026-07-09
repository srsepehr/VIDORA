-- Vidora phase 3: asynchronous worker queue — atomic claiming, leasing,
-- heartbeats, stage/progress advancement, safe retry/reap, cancellation, and
-- controlled transcript writes. Additive only; safe to run after
-- 202607090001. Never edits an applied migration.
--
-- Authorization model: every function here is SECURITY DEFINER and callable
-- ONLY by the worker's service role (execute revoked from public/anon/
-- authenticated). Browser clients can never claim, heartbeat, fail, reap, or
-- write transcript rows. RLS still governs client reads.

-- ---------------------------------------------------------------------------
-- transcript_segments: additive columns for language + translation provenance
-- ---------------------------------------------------------------------------

alter table public.transcript_segments add column if not exists source_language text;
alter table public.transcript_segments add column if not exists speaker text;
alter table public.transcript_segments add column if not exists translation_provider text;
alter table public.transcript_segments add column if not exists translation_model text;

-- Fast "has this video been fully translated" scans and ordered reads.
create index if not exists transcript_segments_untranslated_idx
  on public.transcript_segments (video_id)
  where translated_text_fa is null;

-- ---------------------------------------------------------------------------
-- Broaden client cancellation so a user can cancel while the worker is
-- mid-flight. Replacing the migration-2 function (allowed: new migration).
-- Setting the video to 'cancelled' is observed by the worker's heartbeat,
-- which then stops and finalizes its job. A queued job is cancelled inline.
-- ---------------------------------------------------------------------------

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

  -- Cancellable while pending OR actively processing (pre-worker + in-flight).
  if v_video.status not in (
    'created', 'uploading', 'uploaded', 'validating', 'queued',
    'acquiring_source', 'downloading_source', 'extracting_audio',
    'transcribing', 'translating'
  ) then
    raise exception 'VIDEO_NOT_CANCELLABLE' using errcode = 'P0005';
  end if;

  -- A still-queued job can be cancelled immediately; a running job is left for
  -- the worker to finalize when its heartbeat observes the cancelled video.
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

-- ---------------------------------------------------------------------------
-- claim_next_video_job: atomically lease the oldest eligible queued job.
-- Only 'queued' jobs whose video is not cancelled are eligible. Crashed
-- leases are handled by release_expired_video_jobs (below), keeping this
-- function simple and free of attempt bookkeeping.
-- ---------------------------------------------------------------------------

create or replace function public.claim_next_video_job(
  p_worker_id text,
  p_lease_seconds integer default 120
)
returns public.video_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
begin
  if p_worker_id is null or length(p_worker_id) = 0 then
    raise exception 'WORKER_ID_REQUIRED' using errcode = 'P0100';
  end if;

  for v_job in
    select j.*
    from public.video_jobs j
    join public.videos v on v.id = j.video_id
    where j.status = 'queued'
      and v.status <> 'cancelled'
    order by j.created_at asc
    for update of j skip locked
    limit 1
  loop
    update public.video_jobs
    set status = 'running',
        worker_id = p_worker_id,
        stage = 'acquiring_source',
        lease_expires_at = now() + make_interval(secs => p_lease_seconds),
        heartbeat_at = now(),
        started_at = coalesce(started_at, now()),
        progress_percent = 0,
        progress_current = null,
        progress_total = null,
        error_code = null,
        error_message = null
    where id = v_job.id
    returning * into v_job;

    update public.videos
    set status = 'acquiring_source', failure_code = null, failure_message_fa = null
    where id = v_job.video_id;

    return v_job;
  end loop;

  return null; -- nothing eligible
end;
$$;

revoke all on function public.claim_next_video_job(text, integer) from public, anon, authenticated;
grant execute on function public.claim_next_video_job(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- heartbeat_video_job: extend the lease and record progress. Returns whether
-- the worker still owns the job and whether the video was cancelled (so the
-- worker can stop promptly).
-- ---------------------------------------------------------------------------

create or replace function public.heartbeat_video_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 120,
  p_progress_current bigint default null,
  p_progress_total bigint default null,
  p_progress_percent integer default null
)
returns table(ok boolean, cancelled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
  v_video_status public.video_status;
begin
  select * into v_job from public.video_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    return query select false, false; return;
  end if;

  select status into v_video_status from public.videos where id = v_job.video_id;
  if v_video_status = 'cancelled' then
    update public.video_jobs set status = 'cancelled', finished_at = now() where id = p_job_id;
    return query select false, true; return;
  end if;

  update public.video_jobs
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      progress_current = coalesce(p_progress_current, progress_current),
      progress_total = coalesce(p_progress_total, progress_total),
      progress_percent = coalesce(p_progress_percent, progress_percent)
  where id = p_job_id;

  return query select true, false;
end;
$$;

revoke all on function public.heartbeat_video_job(uuid, text, integer, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.heartbeat_video_job(uuid, text, integer, bigint, bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- complete_video_job_stage: advance the pipeline stage on both the job and
-- the video, extend the lease, and record progress. Refuses if the video was
-- cancelled (returns cancelled=true so the worker aborts).
-- ---------------------------------------------------------------------------

create or replace function public.complete_video_job_stage(
  p_job_id uuid,
  p_worker_id text,
  p_stage public.video_status,
  p_lease_seconds integer default 120,
  p_progress_current bigint default null,
  p_progress_total bigint default null,
  p_progress_percent integer default null
)
returns table(ok boolean, cancelled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
  v_video_status public.video_status;
begin
  select * into v_job from public.video_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    return query select false, false; return;
  end if;

  select status into v_video_status from public.videos where id = v_job.video_id;
  if v_video_status = 'cancelled' then
    update public.video_jobs set status = 'cancelled', finished_at = now() where id = p_job_id;
    return query select false, true; return;
  end if;

  update public.video_jobs
  set stage = p_stage,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      progress_current = coalesce(p_progress_current, progress_current),
      progress_total = coalesce(p_progress_total, progress_total),
      progress_percent = coalesce(p_progress_percent, progress_percent)
  where id = p_job_id;

  update public.videos set status = p_stage where id = v_job.video_id;

  return query select true, false;
end;
$$;

revoke all on function public.complete_video_job_stage(uuid, text, public.video_status, integer, bigint, bigint, integer) from public, anon, authenticated;
grant execute on function public.complete_video_job_stage(uuid, text, public.video_status, integer, bigint, bigint, integer) to service_role;

-- ---------------------------------------------------------------------------
-- complete_video_job: mark the job done for the currently-implemented phases
-- and set the video's terminal status for this phase. In phase 3 the worker
-- calls this with p_video_status = 'translating' after all segments are
-- translated. Later phases will call it with 'completed'.
-- ---------------------------------------------------------------------------

create or replace function public.complete_video_job(
  p_job_id uuid,
  p_worker_id text,
  p_video_status public.video_status default 'translating'
)
returns table(ok boolean, cancelled boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
  v_video_status public.video_status;
begin
  select * into v_job from public.video_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    return query select false, false; return;
  end if;

  select status into v_video_status from public.videos where id = v_job.video_id;
  if v_video_status = 'cancelled' then
    update public.video_jobs set status = 'cancelled', finished_at = now() where id = p_job_id;
    return query select false, true; return;
  end if;

  update public.video_jobs
  set status = 'completed', stage = p_video_status, finished_at = now(),
      progress_percent = 100, lease_expires_at = null
  where id = p_job_id;

  update public.videos set status = p_video_status where id = v_job.video_id;

  return query select true, false;
end;
$$;

revoke all on function public.complete_video_job(uuid, text, public.video_status) from public, anon, authenticated;
grant execute on function public.complete_video_job(uuid, text, public.video_status) to service_role;

-- ---------------------------------------------------------------------------
-- cancel_video_job: finalize a running job the worker found cancelled.
-- ---------------------------------------------------------------------------

create or replace function public.cancel_video_job(p_job_id uuid, p_worker_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.video_jobs
  set status = 'cancelled', finished_at = now(), lease_expires_at = null
  where id = p_job_id and worker_id = p_worker_id and status = 'running';
end;
$$;

revoke all on function public.cancel_video_job(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_video_job(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- fail_video_job: recoverable failures re-queue (bounded by max_attempts);
-- permanent failures (or exhausted attempts) mark job + video failed with a
-- stable code and Persian message. Only the owning worker may call it.
-- ---------------------------------------------------------------------------

create or replace function public.fail_video_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message text,
  p_message_fa text,
  p_retryable boolean
)
returns table(requeued boolean, failed boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
begin
  select * into v_job from public.video_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.worker_id is distinct from p_worker_id or v_job.status <> 'running' then
    return query select false, false; return;
  end if;

  if p_retryable and v_job.attempt < v_job.max_attempts then
    update public.video_jobs
    set status = 'queued',
        attempt = attempt + 1,
        worker_id = null,
        lease_expires_at = null,
        heartbeat_at = null,
        error_code = p_error_code,
        error_message = p_error_message
    where id = p_job_id;
    -- Video returns to 'queued' so the UI shows it waiting for the next try.
    update public.videos set status = 'queued' where id = v_job.video_id and status <> 'cancelled';
    return query select true, false; return;
  end if;

  update public.video_jobs
  set status = 'failed', finished_at = now(), lease_expires_at = null,
      error_code = p_error_code, error_message = p_error_message, retryable = p_retryable
  where id = p_job_id;
  update public.videos
  set status = 'failed', failure_code = p_error_code, failure_message_fa = p_message_fa
  where id = v_job.video_id and status <> 'cancelled';

  return query select false, true;
end;
$$;

revoke all on function public.fail_video_job(uuid, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.fail_video_job(uuid, text, text, text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- release_expired_video_jobs: reap crashed workers. Running jobs whose lease
-- has expired are re-queued (attempt++) when retryable and under the attempt
-- cap, otherwise permanently failed with JOB_TIMEOUT. Cancelled videos'
-- jobs are finalized as cancelled. Returns the number of jobs acted on.
-- ---------------------------------------------------------------------------

create or replace function public.release_expired_video_jobs()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.video_jobs;
  v_count integer := 0;
  v_video_status public.video_status;
begin
  for v_job in
    select * from public.video_jobs
    where status = 'running' and lease_expires_at is not null and lease_expires_at < now()
    for update skip locked
  loop
    select status into v_video_status from public.videos where id = v_job.video_id;

    if v_video_status = 'cancelled' then
      update public.video_jobs set status = 'cancelled', finished_at = now(), lease_expires_at = null where id = v_job.id;
    elsif v_job.retryable and v_job.attempt < v_job.max_attempts then
      update public.video_jobs
      set status = 'queued', attempt = attempt + 1, worker_id = null,
          lease_expires_at = null, heartbeat_at = null,
          error_code = 'WORKER_LEASE_EXPIRED', error_message = 'Lease expired; re-queued'
      where id = v_job.id;
      update public.videos set status = 'queued' where id = v_job.video_id and status <> 'cancelled';
    else
      update public.video_jobs
      set status = 'failed', finished_at = now(), lease_expires_at = null,
          error_code = 'JOB_TIMEOUT', error_message = 'Lease expired; attempts exhausted'
      where id = v_job.id;
      update public.videos
      set status = 'failed', failure_code = 'JOB_TIMEOUT',
          failure_message_fa = 'پردازش این ویدیو به دلیل قطع شدن پردازشگر ناتمام ماند. دوباره تلاش کنید.'
      where id = v_job.video_id and status <> 'cancelled';
    end if;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.release_expired_video_jobs() from public, anon, authenticated;
grant execute on function public.release_expired_video_jobs() to service_role;

-- ---------------------------------------------------------------------------
-- upsert_transcript_segments: idempotent write of source segments. Retries
-- never duplicate rows (unique video_id, segment_index). Worker-only.
-- p_segments: [{ "segment_index":int, "start_ms":int, "end_ms":int,
--               "source_text":str, "confidence":num|null,
--               "source_language":str|null, "speaker":str|null }]
-- ---------------------------------------------------------------------------

create or replace function public.upsert_transcript_segments(
  p_video_id uuid,
  p_segments jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  insert into public.transcript_segments
    (video_id, segment_index, start_ms, end_ms, source_text, confidence, source_language, speaker)
  select
    p_video_id,
    (seg->>'segment_index')::integer,
    (seg->>'start_ms')::integer,
    (seg->>'end_ms')::integer,
    seg->>'source_text',
    nullif(seg->>'confidence','')::numeric,
    seg->>'source_language',
    seg->>'speaker'
  from jsonb_array_elements(p_segments) as seg
  on conflict (video_id, segment_index) do update
    set start_ms = excluded.start_ms,
        end_ms = excluded.end_ms,
        source_text = excluded.source_text,
        confidence = excluded.confidence,
        source_language = excluded.source_language,
        speaker = excluded.speaker,
        updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.upsert_transcript_segments(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.upsert_transcript_segments(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- update_transcript_translations: idempotent write of Persian translations by
-- segment_index. Only updates existing rows; never creates or deletes. Retry
-- of a batch is safe. Worker-only.
-- p_items: [{ "segment_index":int, "translated_text_fa":str }]
-- ---------------------------------------------------------------------------

create or replace function public.update_transcript_translations(
  p_video_id uuid,
  p_items jsonb,
  p_provider text,
  p_model text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  update public.transcript_segments t
  set translated_text_fa = x.translated_text_fa,
      translation_provider = p_provider,
      translation_model = p_model,
      updated_at = now()
  from (
    select (item->>'segment_index')::integer as segment_index,
           item->>'translated_text_fa' as translated_text_fa
    from jsonb_array_elements(p_items) as item
  ) as x
  where t.video_id = p_video_id
    and t.segment_index = x.segment_index
    and coalesce(x.translated_text_fa, '') <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.update_transcript_translations(uuid, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.update_transcript_translations(uuid, jsonb, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- persist verified media metadata (duration etc.) discovered by ffprobe.
-- ---------------------------------------------------------------------------

create or replace function public.set_video_media_metadata(
  p_video_id uuid,
  p_duration_seconds integer,
  p_detected_language text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.videos
  set duration_seconds = coalesce(p_duration_seconds, duration_seconds),
      detected_language = coalesce(p_detected_language, detected_language)
  where id = p_video_id;
end;
$$;

revoke all on function public.set_video_media_metadata(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.set_video_media_metadata(uuid, integer, text) to service_role;
