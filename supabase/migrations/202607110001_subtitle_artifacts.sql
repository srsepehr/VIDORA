-- Vidora phase 4: soft-subtitle artifacts (WebVTT + SRT).
-- Additive only; safe after 202607100001. Never edits an applied migration.
--
-- Authoritative subtitle files are generated server-side by the worker and
-- stored in the existing private 'vidora-video-results' bucket under
-- {owner_id}/videos/{video_id}/subtitles/{hash}/fa.(vtt|srt), which the
-- existing storage_read_own_video_results policy already scopes to the owner.
-- This migration records artifact metadata and provides a service_role-only
-- idempotent upsert. Browsers can read only their own artifact metadata and can
-- never forge or overwrite worker-generated rows.

-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------

create table if not exists public.subtitle_artifacts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  language text not null default 'fa',
  format text not null check (format in ('vtt', 'srt')),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'stale')),
  storage_path text,
  content_hash text,
  builder_version text,
  cue_count integer check (cue_count is null or cue_count >= 0),
  source_segment_count integer check (source_segment_count is null or source_segment_count >= 0),
  validation_warnings jsonb not null default '[]'::jsonb,
  error_code text,
  error_detail text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One current artifact per video + language + format.
  unique (video_id, language, format)
);

create index if not exists subtitle_artifacts_video_idx on public.subtitle_artifacts (video_id);
create index if not exists subtitle_artifacts_hash_idx on public.subtitle_artifacts (content_hash);

drop trigger if exists subtitle_artifacts_set_updated_at on public.subtitle_artifacts;
create trigger subtitle_artifacts_set_updated_at before update on public.subtitle_artifacts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner reads metadata via the video relationship; writes are worker-only
-- (service role bypasses RLS). No insert/update/delete is granted to clients,
-- so a browser can never forge or overwrite an artifact record.
-- ---------------------------------------------------------------------------

alter table public.subtitle_artifacts enable row level security;

drop policy if exists subtitle_artifacts_select_own on public.subtitle_artifacts;
create policy subtitle_artifacts_select_own on public.subtitle_artifacts for select to authenticated using (
  exists (
    select 1 from public.videos
    where videos.id = subtitle_artifacts.video_id
      and videos.user_id = auth.uid()
  )
);

grant select on public.subtitle_artifacts to authenticated;

-- Owner may delete their own artifact objects from the results bucket (used by
-- video deletion cleanup). Writes remain worker-only.
drop policy if exists storage_delete_own_video_results on storage.objects;
create policy storage_delete_own_video_results on storage.objects for delete to authenticated using (
  bucket_id = 'vidora-video-results'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- ---------------------------------------------------------------------------
-- Idempotent, concurrency-safe upsert (service_role only). Callers pass the
-- content hash; a matching ready row with the same hash + builder version is a
-- no-op reuse. Partial/failed generation never clobbers a previously ready row
-- unless the caller explicitly supersedes it with a valid one.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_subtitle_artifact(
  p_video_id uuid,
  p_language text,
  p_format text,
  p_status text,
  p_storage_path text,
  p_content_hash text,
  p_builder_version text,
  p_cue_count integer,
  p_source_segment_count integer,
  p_validation_warnings jsonb,
  p_error_code text,
  p_error_detail text
)
returns public.subtitle_artifacts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subtitle_artifacts;
begin
  insert into public.subtitle_artifacts as sa (
    video_id, language, format, status, storage_path, content_hash, builder_version,
    cue_count, source_segment_count, validation_warnings, error_code, error_detail,
    generated_at
  ) values (
    p_video_id, coalesce(p_language, 'fa'), p_format, p_status, p_storage_path, p_content_hash,
    p_builder_version, p_cue_count, p_source_segment_count, coalesce(p_validation_warnings, '[]'::jsonb),
    p_error_code, p_error_detail,
    case when p_status = 'ready' then now() else null end
  )
  on conflict (video_id, language, format) do update set
    status = excluded.status,
    storage_path = case when excluded.status = 'ready' then excluded.storage_path else sa.storage_path end,
    content_hash = case when excluded.status = 'ready' then excluded.content_hash else sa.content_hash end,
    builder_version = case when excluded.status = 'ready' then excluded.builder_version else sa.builder_version end,
    cue_count = case when excluded.status = 'ready' then excluded.cue_count else sa.cue_count end,
    source_segment_count = case when excluded.status = 'ready' then excluded.source_segment_count else sa.source_segment_count end,
    validation_warnings = excluded.validation_warnings,
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    generated_at = case when excluded.status = 'ready' then now() else sa.generated_at end,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.upsert_subtitle_artifact(uuid, text, text, text, text, text, text, integer, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.upsert_subtitle_artifact(uuid, text, text, text, text, text, text, integer, integer, jsonb, text, text) to service_role;

-- Mark all artifacts for a video stale (used when the transcript changed and a
-- new hash is detected). Keeps the old rows until a new ready set replaces them.
create or replace function public.mark_subtitle_artifacts_stale(p_video_id uuid, p_keep_hash text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.subtitle_artifacts
  set status = 'stale', updated_at = now()
  where video_id = p_video_id
    and status = 'ready'
    and (p_keep_hash is null or content_hash is distinct from p_keep_hash);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_subtitle_artifacts_stale(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_subtitle_artifacts_stale(uuid, text) to service_role;
