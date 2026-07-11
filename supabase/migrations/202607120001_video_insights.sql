-- Vidora phase 5: video insights (Persian summary, key takeaways, chapters).
-- Additive only; safe after 202607110001. Never edits an applied migration.
--
-- Insights are generated server-side from the persisted transcript and stored
-- here. Browsers can only READ their own rows (RLS via the video relationship);
-- all writes go through service_role-only SECURITY DEFINER functions, so a
-- client can never insert, update, or forge generated content. Insight state is
-- independent from video/job/subtitle state.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.video_insights (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  language text not null default 'fa',
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'stale')),
  short_summary text,
  detailed_summary text,
  key_takeaways jsonb not null default '[]'::jsonb,
  content_hash text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  source_segment_count integer check (source_segment_count is null or source_segment_count >= 0),
  error_code text,
  error_detail text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One current insight per video + language.
  unique (video_id, language)
);

create table if not exists public.video_chapters (
  id uuid primary key default gen_random_uuid(),
  insight_id uuid not null references public.video_insights(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  chapter_index integer not null check (chapter_index >= 0),
  title text not null,
  description text,
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null,
  source_segment_indexes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  constraint video_chapters_positive_duration check (end_ms > start_ms),
  unique (insight_id, chapter_index)
);

create index if not exists video_insights_video_idx on public.video_insights (video_id);
create index if not exists video_chapters_video_idx on public.video_chapters (video_id, chapter_index);

drop trigger if exists video_insights_set_updated_at on public.video_insights;
create trigger video_insights_set_updated_at before update on public.video_insights
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner-only reads via the video relationship; no client write grants.
-- ---------------------------------------------------------------------------

alter table public.video_insights enable row level security;
alter table public.video_chapters enable row level security;

drop policy if exists video_insights_select_own on public.video_insights;
create policy video_insights_select_own on public.video_insights for select to authenticated using (
  exists (
    select 1 from public.videos
    where videos.id = video_insights.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists video_chapters_select_own on public.video_chapters;
create policy video_chapters_select_own on public.video_chapters for select to authenticated using (
  exists (
    select 1 from public.videos
    where videos.id = video_chapters.video_id
      and videos.user_id = auth.uid()
  )
);

grant select on public.video_insights to authenticated;
grant select on public.video_chapters to authenticated;

-- ---------------------------------------------------------------------------
-- set_video_insight_status: transition to generating/failed WITHOUT touching
-- previously persisted content fields (a failure never erases a prior result).
-- ---------------------------------------------------------------------------

create or replace function public.set_video_insight_status(
  p_video_id uuid,
  p_language text,
  p_status text,
  p_content_hash text,
  p_error_code text,
  p_error_detail text
)
returns public.video_insights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_insights;
begin
  insert into public.video_insights as vi (video_id, language, status, content_hash, error_code, error_detail)
  values (p_video_id, coalesce(p_language, 'fa'), p_status, p_content_hash, p_error_code, p_error_detail)
  on conflict (video_id, language) do update set
    status = excluded.status,
    content_hash = coalesce(excluded.content_hash, vi.content_hash),
    error_code = excluded.error_code,
    error_detail = excluded.error_detail,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_video_insight_status(uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_video_insight_status(uuid, text, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- persist_video_insight: atomic ready-persistence. Upserts the insight row with
-- the full generated content and replaces its chapters in the SAME transaction,
-- so concurrent generation can never produce duplicate current rows or a
-- half-replaced chapter list. p_chapters:
--   [{ "chapter_index":int, "title":str, "description":str|null,
--      "start_ms":int, "end_ms":int, "source_segment_indexes":[int,...] }]
-- ---------------------------------------------------------------------------

create or replace function public.persist_video_insight(
  p_video_id uuid,
  p_language text,
  p_short_summary text,
  p_detailed_summary text,
  p_key_takeaways jsonb,
  p_content_hash text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_source_segment_count integer,
  p_chapters jsonb
)
returns public.video_insights
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_insights;
begin
  insert into public.video_insights as vi (
    video_id, language, status, short_summary, detailed_summary, key_takeaways,
    content_hash, provider, model, prompt_version, schema_version,
    source_segment_count, error_code, error_detail, generated_at
  ) values (
    p_video_id, coalesce(p_language, 'fa'), 'ready', p_short_summary, p_detailed_summary,
    coalesce(p_key_takeaways, '[]'::jsonb), p_content_hash, p_provider, p_model,
    p_prompt_version, p_schema_version, p_source_segment_count, null, null, now()
  )
  on conflict (video_id, language) do update set
    status = 'ready',
    short_summary = excluded.short_summary,
    detailed_summary = excluded.detailed_summary,
    key_takeaways = excluded.key_takeaways,
    content_hash = excluded.content_hash,
    provider = excluded.provider,
    model = excluded.model,
    prompt_version = excluded.prompt_version,
    schema_version = excluded.schema_version,
    source_segment_count = excluded.source_segment_count,
    error_code = null,
    error_detail = null,
    generated_at = now(),
    updated_at = now()
  returning * into v_row;

  delete from public.video_chapters where insight_id = v_row.id;

  insert into public.video_chapters
    (insight_id, video_id, chapter_index, title, description, start_ms, end_ms, source_segment_indexes)
  select
    v_row.id,
    p_video_id,
    (ch->>'chapter_index')::integer,
    ch->>'title',
    nullif(ch->>'description', ''),
    (ch->>'start_ms')::integer,
    (ch->>'end_ms')::integer,
    coalesce(ch->'source_segment_indexes', '[]'::jsonb)
  from jsonb_array_elements(coalesce(p_chapters, '[]'::jsonb)) as ch;

  return v_row;
end;
$$;

revoke all on function public.persist_video_insight(uuid, text, text, text, jsonb, text, text, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.persist_video_insight(uuid, text, text, text, jsonb, text, text, text, text, text, integer, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- mark_video_insights_stale: flag ready results whose input changed. Content is
-- preserved (UI shows an explicit stale state) until a replacement succeeds.
-- ---------------------------------------------------------------------------

create or replace function public.mark_video_insights_stale(p_video_id uuid, p_keep_hash text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.video_insights
  set status = 'stale', updated_at = now()
  where video_id = p_video_id
    and status = 'ready'
    and (p_keep_hash is null or content_hash is distinct from p_keep_hash);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_video_insights_stale(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_video_insights_stale(uuid, text) to service_role;
