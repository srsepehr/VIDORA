-- Vidora phase 8: adaptive learning tools (suitability assessment, flashcards,
-- multiple-choice quiz, per-user practice sessions).
-- Additive only; safe after 202607120004. Never edits an applied migration.
--
-- Design: canonical learning artifacts are separated from per-user progress.
--   * video_learning_profiles / video_learning_sets / video_learning_items are
--     per-VIDEO artifacts (one profile per video; one set per video+mode) so a
--     future shared-Library video can reuse one validated set across authorized
--     users without rewriting learning history. Reads are owner-scoped via the
--     existing video relationship today; a future Library entitlement policy
--     can widen reads without schema change. All writes are service_role-only.
--   * video_learning_sessions / video_learning_attempts are per-USER progress,
--     always private to that user, written only through SECURITY DEFINER RPCs
--     that resolve the caller from auth.uid() (never a client-supplied id).
--
-- Quiz-answer safety: authenticated clients receive a COLUMN-LIMITED select on
-- video_learning_items that excludes correct_choice_index and explanation.
-- Evaluation happens server-side in submit_learning_answer, which returns the
-- correct answer and grounded explanation only after a submission is recorded.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.video_learning_profiles (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos(id) on delete cascade,
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'stale')),
  recommended_mode text check (recommended_mode in ('content', 'language', 'both', 'none')),
  content_kind text check (content_kind in ('conceptual', 'procedural', 'factual', 'opinion', 'narrative', 'entertainment', 'promotional', 'mixed')),
  content_suitability text check (content_suitability in ('high', 'medium', 'low', 'none')),
  language_suitability text check (language_suitability in ('high', 'medium', 'low', 'none')),
  reason_code text,
  teachable_points jsonb not null default '[]'::jsonb,
  content_hash text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  -- 'model' when Qwen assessed; 'deterministic' when pre-guards classified the
  -- video without a model call (e.g. incomplete translation, too short).
  assessment_source text check (assessment_source is null or assessment_source in ('model', 'deterministic')),
  -- Future Library editorial override. 'auto' follows the stored assessment;
  -- explicit modes force the offering; 'disabled' hides learning tools. The
  -- automatic assessment stays stored for audit and history is never erased.
  editorial_policy text not null default 'auto' check (editorial_policy in ('auto', 'content', 'language', 'both', 'disabled')),
  error_code text,
  assessed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.video_learning_sets (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  mode text not null check (mode in ('content', 'language', 'both')),
  status text not null default 'generating' check (status in ('generating', 'ready', 'failed', 'stale')),
  content_hash text,
  profile_hash text,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  flashcard_count integer not null default 0 check (flashcard_count >= 0),
  quiz_count integer not null default 0 check (quiz_count >= 0),
  error_code text,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One canonical current set per video + mode.
  unique (video_id, mode)
);

create table if not exists public.video_learning_items (
  id uuid primary key default gen_random_uuid(),
  learning_set_id uuid not null references public.video_learning_sets(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  item_index integer not null check (item_index >= 0),
  item_type text not null check (item_type in ('flashcard', 'multiple_choice')),
  learning_mode text not null check (learning_mode in ('content', 'language')),
  front_text text,
  back_text text,
  question_text text,
  choices jsonb,
  correct_choice_index integer check (correct_choice_index is null or correct_choice_index >= 0),
  explanation text,
  source_segment_indexes jsonb not null default '[]'::jsonb,
  -- Server-derived citation span from real transcript segment boundaries
  -- (null when the item carries no valid citation; the UI then shows no seek).
  start_ms integer check (start_ms is null or start_ms >= 0),
  end_ms integer,
  created_at timestamptz not null default now(),
  constraint video_learning_items_citation_span check (
    (start_ms is null and end_ms is null) or (end_ms > start_ms)
  ),
  unique (learning_set_id, item_index)
);

create table if not exists public.video_learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  learning_set_id uuid not null references public.video_learning_sets(id) on delete cascade,
  mode text not null check (mode in ('content', 'language', 'both')),
  status text not null default 'active' check (status in ('active', 'completed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Resume finds one unambiguous active session per user + set.
create unique index if not exists video_learning_sessions_active_idx
  on public.video_learning_sessions (user_id, learning_set_id) where status = 'active';

create table if not exists public.video_learning_attempts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.video_learning_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  learning_item_id uuid not null references public.video_learning_items(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  response_type text not null check (response_type in ('quiz_answer', 'flashcard_rating')),
  selected_choice_index integer check (selected_choice_index is null or selected_choice_index >= 0),
  flashcard_rating text check (flashcard_rating is null or flashcard_rating in ('known', 'review')),
  is_correct boolean,
  answered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- One recorded attempt per item within a session (quiz answers are final;
  -- flashcard ratings update in place via the RPC).
  unique (session_id, learning_item_id)
);

create index if not exists video_learning_sets_video_idx on public.video_learning_sets (video_id, mode);
create index if not exists video_learning_items_set_idx on public.video_learning_items (learning_set_id, item_index);
create index if not exists video_learning_sessions_user_idx on public.video_learning_sessions (user_id, video_id, created_at);
create index if not exists video_learning_attempts_session_idx on public.video_learning_attempts (session_id, learning_item_id);

drop trigger if exists video_learning_profiles_set_updated_at on public.video_learning_profiles;
create trigger video_learning_profiles_set_updated_at before update on public.video_learning_profiles
  for each row execute function public.set_updated_at();
drop trigger if exists video_learning_sets_set_updated_at on public.video_learning_sets;
create trigger video_learning_sets_set_updated_at before update on public.video_learning_sets
  for each row execute function public.set_updated_at();
drop trigger if exists video_learning_sessions_set_updated_at on public.video_learning_sessions;
create trigger video_learning_sessions_set_updated_at before update on public.video_learning_sessions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: canonical artifacts readable by the video owner (existing access rule);
-- sessions/attempts readable only by their user. No direct client writes.
-- ---------------------------------------------------------------------------

alter table public.video_learning_profiles enable row level security;
alter table public.video_learning_sets enable row level security;
alter table public.video_learning_items enable row level security;
alter table public.video_learning_sessions enable row level security;
alter table public.video_learning_attempts enable row level security;

drop policy if exists video_learning_profiles_select_own on public.video_learning_profiles;
create policy video_learning_profiles_select_own on public.video_learning_profiles for select to authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid())
);
drop policy if exists video_learning_sets_select_own on public.video_learning_sets;
create policy video_learning_sets_select_own on public.video_learning_sets for select to authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid())
);
drop policy if exists video_learning_items_select_own on public.video_learning_items;
create policy video_learning_items_select_own on public.video_learning_items for select to authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid())
);
drop policy if exists video_learning_sessions_select_own on public.video_learning_sessions;
create policy video_learning_sessions_select_own on public.video_learning_sessions for select to authenticated using (
  user_id = auth.uid()
);
drop policy if exists video_learning_attempts_select_own on public.video_learning_attempts;
create policy video_learning_attempts_select_own on public.video_learning_attempts for select to authenticated using (
  user_id = auth.uid()
);

revoke all privileges on table public.video_learning_profiles, public.video_learning_sets,
  public.video_learning_items, public.video_learning_sessions,
  public.video_learning_attempts from public, anon, authenticated;

grant select on table public.video_learning_profiles, public.video_learning_sets,
  public.video_learning_sessions, public.video_learning_attempts to authenticated;

-- COLUMN-LIMITED item reads: the browser never receives correct_choice_index
-- or explanation. They are returned only by submit_learning_answer after a
-- submission is recorded.
grant select (id, learning_set_id, video_id, item_index, item_type, learning_mode,
              front_text, back_text, question_text, choices,
              source_segment_indexes, start_ms, end_ms, created_at)
  on public.video_learning_items to authenticated;

-- ---------------------------------------------------------------------------
-- Service-role persistence RPCs (assessment + generated sets)
-- ---------------------------------------------------------------------------

create or replace function public.set_video_learning_profile_status(
  p_video_id uuid,
  p_status text,
  p_content_hash text,
  p_error_code text
)
returns public.video_learning_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_learning_profiles;
begin
  insert into public.video_learning_profiles as lp (video_id, status, content_hash, error_code)
  values (p_video_id, p_status, p_content_hash, p_error_code)
  on conflict (video_id) do update set
    status = excluded.status,
    content_hash = coalesce(excluded.content_hash, lp.content_hash),
    error_code = excluded.error_code,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_video_learning_profile_status(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_video_learning_profile_status(uuid, text, text, text) to service_role;

create or replace function public.persist_video_learning_profile(
  p_video_id uuid,
  p_recommended_mode text,
  p_content_kind text,
  p_content_suitability text,
  p_language_suitability text,
  p_reason_code text,
  p_teachable_points jsonb,
  p_content_hash text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_assessment_source text
)
returns public.video_learning_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_learning_profiles;
begin
  insert into public.video_learning_profiles as lp (
    video_id, status, recommended_mode, content_kind, content_suitability,
    language_suitability, reason_code, teachable_points, content_hash,
    provider, model, prompt_version, schema_version, assessment_source,
    error_code, assessed_at
  ) values (
    p_video_id, 'ready', p_recommended_mode, p_content_kind, p_content_suitability,
    p_language_suitability, p_reason_code, coalesce(p_teachable_points, '[]'::jsonb),
    p_content_hash, p_provider, p_model, p_prompt_version, p_schema_version,
    p_assessment_source, null, now()
  )
  on conflict (video_id) do update set
    status = 'ready',
    recommended_mode = excluded.recommended_mode,
    content_kind = excluded.content_kind,
    content_suitability = excluded.content_suitability,
    language_suitability = excluded.language_suitability,
    reason_code = excluded.reason_code,
    teachable_points = excluded.teachable_points,
    content_hash = excluded.content_hash,
    provider = excluded.provider,
    model = excluded.model,
    prompt_version = excluded.prompt_version,
    schema_version = excluded.schema_version,
    assessment_source = excluded.assessment_source,
    error_code = null,
    assessed_at = now(),
    updated_at = now()
    -- editorial_policy is intentionally NOT touched: an editorial override
    -- survives re-assessment and never erases learning history.
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.persist_video_learning_profile(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.persist_video_learning_profile(uuid, text, text, text, text, text, jsonb, text, text, text, text, text, text) to service_role;

-- Atomic set persistence: upserts the set row and replaces its items in the
-- same transaction so a half-replaced item list can never be observed.
-- p_items: [{ "item_index":int, "item_type":"flashcard|multiple_choice",
--   "learning_mode":"content|language", "front_text":str|null, "back_text":str|null,
--   "question_text":str|null, "choices":[str,...]|null, "correct_choice_index":int|null,
--   "explanation":str|null, "source_segment_indexes":[int,...],
--   "start_ms":int|null, "end_ms":int|null }]
create or replace function public.persist_video_learning_set(
  p_video_id uuid,
  p_mode text,
  p_content_hash text,
  p_profile_hash text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text,
  p_items jsonb
)
returns public.video_learning_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_learning_sets;
  v_flashcards integer;
  v_quiz integer;
begin
  select count(*) filter (where it->>'item_type' = 'flashcard'),
         count(*) filter (where it->>'item_type' = 'multiple_choice')
    into v_flashcards, v_quiz
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  insert into public.video_learning_sets as ls (
    video_id, mode, status, content_hash, profile_hash, provider, model,
    prompt_version, schema_version, flashcard_count, quiz_count, error_code, generated_at
  ) values (
    p_video_id, p_mode, 'ready', p_content_hash, p_profile_hash, p_provider, p_model,
    p_prompt_version, p_schema_version, v_flashcards, v_quiz, null, now()
  )
  on conflict (video_id, mode) do update set
    status = 'ready',
    content_hash = excluded.content_hash,
    profile_hash = excluded.profile_hash,
    provider = excluded.provider,
    model = excluded.model,
    prompt_version = excluded.prompt_version,
    schema_version = excluded.schema_version,
    flashcard_count = excluded.flashcard_count,
    quiz_count = excluded.quiz_count,
    error_code = null,
    generated_at = now(),
    updated_at = now()
  returning * into v_row;

  delete from public.video_learning_items where learning_set_id = v_row.id;

  insert into public.video_learning_items
    (learning_set_id, video_id, item_index, item_type, learning_mode, front_text,
     back_text, question_text, choices, correct_choice_index, explanation,
     source_segment_indexes, start_ms, end_ms)
  select
    v_row.id,
    p_video_id,
    (it->>'item_index')::integer,
    it->>'item_type',
    it->>'learning_mode',
    nullif(it->>'front_text', ''),
    nullif(it->>'back_text', ''),
    nullif(it->>'question_text', ''),
    case when it ? 'choices' and jsonb_typeof(it->'choices') = 'array' then it->'choices' else null end,
    (it->>'correct_choice_index')::integer,
    nullif(it->>'explanation', ''),
    coalesce(it->'source_segment_indexes', '[]'::jsonb),
    (it->>'start_ms')::integer,
    (it->>'end_ms')::integer
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as it;

  return v_row;
end;
$$;

revoke all on function public.persist_video_learning_set(uuid, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.persist_video_learning_set(uuid, text, text, text, text, text, text, text, jsonb) to service_role;

create or replace function public.set_video_learning_set_status(
  p_video_id uuid,
  p_mode text,
  p_status text,
  p_content_hash text,
  p_error_code text
)
returns public.video_learning_sets
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_learning_sets;
begin
  insert into public.video_learning_sets as ls (video_id, mode, status, content_hash, error_code)
  values (p_video_id, p_mode, p_status, p_content_hash, p_error_code)
  on conflict (video_id, mode) do update set
    status = excluded.status,
    content_hash = coalesce(excluded.content_hash, ls.content_hash),
    error_code = excluded.error_code,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_video_learning_set_status(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.set_video_learning_set_status(uuid, text, text, text, text) to service_role;

-- Flag ready artifacts whose inputs changed. Content is preserved (the UI
-- shows an explicit stale state) until a replacement succeeds.
create or replace function public.mark_video_learning_stale(p_video_id uuid, p_keep_profile_hash text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_rows integer;
begin
  update public.video_learning_profiles
    set status = 'stale', updated_at = now()
    where video_id = p_video_id and status = 'ready'
      and (p_keep_profile_hash is null or content_hash is distinct from p_keep_profile_hash);
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  update public.video_learning_sets
    set status = 'stale', updated_at = now()
    where video_id = p_video_id and status = 'ready'
      and (p_keep_profile_hash is null or profile_hash is distinct from p_keep_profile_hash);
  get diagnostics v_rows = row_count; v_count := v_count + v_rows;
  return v_count;
end;
$$;

revoke all on function public.mark_video_learning_stale(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_video_learning_stale(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Authenticated session/attempt RPCs. Every function resolves the caller from
-- auth.uid() and verifies video + set + item relationships server-side.
-- ---------------------------------------------------------------------------

create or replace function public.start_learning_session(p_video_id uuid, p_set_id uuid)
returns public.video_learning_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_set public.video_learning_sets;
  v_row public.video_learning_sessions;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.videos where id = p_video_id and user_id = v_user) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  select * into v_set from public.video_learning_sets
    where id = p_set_id and video_id = p_video_id and status = 'ready';
  if not found then
    raise exception 'learning set not found' using errcode = 'P0002';
  end if;

  -- Resume the active session when one exists (refresh never duplicates).
  select * into v_row from public.video_learning_sessions
    where user_id = v_user and learning_set_id = p_set_id and status = 'active';
  if found then
    return v_row;
  end if;
  insert into public.video_learning_sessions (user_id, video_id, learning_set_id, mode)
    values (v_user, p_video_id, p_set_id, v_set.mode)
    on conflict (user_id, learning_set_id) where status = 'active' do nothing
    returning * into v_row;
  if not found then
    -- Concurrent start: return the session the other request created.
    select * into v_row from public.video_learning_sessions
      where user_id = v_user and learning_set_id = p_set_id and status = 'active';
  end if;
  return v_row;
end;
$$;

revoke all on function public.start_learning_session(uuid, uuid) from public, anon;
grant execute on function public.start_learning_session(uuid, uuid) to authenticated;

-- Server-side quiz evaluation. The correct answer and explanation leave the
-- database ONLY through this function, after the attempt is recorded. Repeat
-- submissions for the same item return the original recorded result (an answer
-- can never be changed after submission).
create or replace function public.submit_learning_answer(
  p_session_id uuid,
  p_item_id uuid,
  p_choice_index integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.video_learning_sessions;
  v_item public.video_learning_items;
  v_existing public.video_learning_attempts;
  v_correct boolean;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  select * into v_session from public.video_learning_sessions
    where id = p_session_id and user_id = v_user and status = 'active';
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  select * into v_item from public.video_learning_items
    where id = p_item_id and learning_set_id = v_session.learning_set_id
      and item_type = 'multiple_choice';
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;
  if p_choice_index is null or p_choice_index < 0
     or p_choice_index >= jsonb_array_length(coalesce(v_item.choices, '[]'::jsonb)) then
    raise exception 'invalid choice' using errcode = '22023';
  end if;

  select * into v_existing from public.video_learning_attempts
    where session_id = p_session_id and learning_item_id = p_item_id;
  if found then
    return jsonb_build_object(
      'reused', true,
      'is_correct', v_existing.is_correct,
      'selected_choice_index', v_existing.selected_choice_index,
      'correct_choice_index', v_item.correct_choice_index,
      'explanation', v_item.explanation);
  end if;

  v_correct := (p_choice_index = v_item.correct_choice_index);
  insert into public.video_learning_attempts
      (session_id, user_id, learning_item_id, video_id, response_type, selected_choice_index, is_correct)
    values (p_session_id, v_user, p_item_id, v_session.video_id, 'quiz_answer', p_choice_index, v_correct)
    on conflict (session_id, learning_item_id) do nothing;
  if not found then
    -- Concurrent duplicate submission: return the recorded attempt.
    select * into v_existing from public.video_learning_attempts
      where session_id = p_session_id and learning_item_id = p_item_id;
    return jsonb_build_object(
      'reused', true,
      'is_correct', v_existing.is_correct,
      'selected_choice_index', v_existing.selected_choice_index,
      'correct_choice_index', v_item.correct_choice_index,
      'explanation', v_item.explanation);
  end if;

  return jsonb_build_object(
    'reused', false,
    'is_correct', v_correct,
    'selected_choice_index', p_choice_index,
    'correct_choice_index', v_item.correct_choice_index,
    'explanation', v_item.explanation);
end;
$$;

revoke all on function public.submit_learning_answer(uuid, uuid, integer) from public, anon;
grant execute on function public.submit_learning_answer(uuid, uuid, integer) to authenticated;

-- Flashcard self-rating. Re-rating the same card within a session updates the
-- stored rating (review flow), but never creates a duplicate row.
create or replace function public.submit_flashcard_rating(
  p_session_id uuid,
  p_item_id uuid,
  p_rating text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_session public.video_learning_sessions;
  v_item public.video_learning_items;
  v_row public.video_learning_attempts;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_rating not in ('known', 'review') then
    raise exception 'invalid rating' using errcode = '22023';
  end if;
  select * into v_session from public.video_learning_sessions
    where id = p_session_id and user_id = v_user and status = 'active';
  if not found then
    raise exception 'session not found' using errcode = 'P0002';
  end if;
  select * into v_item from public.video_learning_items
    where id = p_item_id and learning_set_id = v_session.learning_set_id
      and item_type = 'flashcard';
  if not found then
    raise exception 'item not found' using errcode = 'P0002';
  end if;

  insert into public.video_learning_attempts
      (session_id, user_id, learning_item_id, video_id, response_type, flashcard_rating)
    values (p_session_id, v_user, p_item_id, v_session.video_id, 'flashcard_rating', p_rating)
    on conflict (session_id, learning_item_id) do update set
      flashcard_rating = excluded.flashcard_rating,
      answered_at = now()
    returning * into v_row;
  return jsonb_build_object('rating', v_row.flashcard_rating, 'item_id', v_row.learning_item_id);
end;
$$;

revoke all on function public.submit_flashcard_rating(uuid, uuid, text) from public, anon;
grant execute on function public.submit_flashcard_rating(uuid, uuid, text) to authenticated;

create or replace function public.complete_learning_session(p_session_id uuid)
returns public.video_learning_sessions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row public.video_learning_sessions;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  update public.video_learning_sessions
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = p_session_id and user_id = v_user and status = 'active'
    returning * into v_row;
  if not found then
    -- Idempotent: completing an already-completed own session returns it.
    select * into v_row from public.video_learning_sessions
      where id = p_session_id and user_id = v_user;
    if not found then
      raise exception 'session not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$$;

revoke all on function public.complete_learning_session(uuid) from public, anon;
grant execute on function public.complete_learning_session(uuid) to authenticated;
