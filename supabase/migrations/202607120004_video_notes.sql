-- Vidora phase 7: per-user Living Note for each video.
-- Additive only; safe after 202607120003. Never edits an applied migration.
--
-- Each authenticated owner has ONE persistent note per video, combining three
-- independent parts on a single row / relation:
--   1. personal_text          — the owner's own free-form notes (user-authored).
--   2. ai_* columns           — a server-generated structured Persian summary
--                               (overview / key points / action items), built
--                               ONLY from already-persisted insights, saved chat
--                               answers, and the transcript. Never regenerates
--                               video/audio/STT/translation/insights.
--   3. video_note_saved_answers — chat Q&A the owner explicitly pinned.
--
-- Security model:
--   * Personal text and saved-answer writes are USER-authored, so they go
--     through SECURITY DEFINER RPCs granted to `authenticated` that resolve the
--     caller from auth.uid() (never a client-supplied user_id) and verify video
--     ownership. No direct table writes are granted to browsers.
--   * AI-generated content is PRIVILEGED (must not be forgeable by a client), so
--     it is written only by service_role RPCs. The Modal worker authenticates
--     the caller's token, resolves the user server-side, and passes that id in.
--   * Regeneration and failure never erase personal text or saved answers, and a
--     failed regeneration never discards a prior valid AI result.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.video_notes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Owner-authored personal notes (plain text; rendered escaped in the UI).
  personal_text text not null default '',
  personal_updated_at timestamptz,
  -- Server-generated structured Persian note (independent of personal_text).
  ai_status text not null default 'none' check (ai_status in ('none', 'generating', 'ready', 'failed', 'stale')),
  ai_overview text,
  ai_key_points jsonb not null default '[]'::jsonb,
  ai_action_items jsonb not null default '[]'::jsonb,
  ai_content_hash text,
  ai_source_insight_hash text,
  ai_saved_answer_count integer check (ai_saved_answer_count is null or ai_saved_answer_count >= 0),
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_schema_version text,
  ai_error_code text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One Living Note per owner + video.
  unique (video_id, user_id)
);

create table if not exists public.video_note_saved_answers (
  id uuid primary key default gen_random_uuid(),
  note_id uuid not null references public.video_notes(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The pinned assistant message. Deleting a saved answer never deletes chat
  -- history; deleting the chat message (rare) cascades to remove the pin.
  message_id uuid not null references public.video_chat_messages(id) on delete cascade,
  question text not null,
  answer text not null,
  not_in_video boolean not null default false,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  -- Duplicate prevention: one pin per (note, message).
  unique (note_id, message_id)
);

create index if not exists video_notes_user_video_idx on public.video_notes (user_id, video_id);
create index if not exists video_note_saved_answers_note_idx on public.video_note_saved_answers (note_id, created_at, id);

drop trigger if exists video_notes_set_updated_at on public.video_notes;
create trigger video_notes_set_updated_at before update on public.video_notes
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: owner-only reads. All writes flow through the functions below; no direct
-- client INSERT/UPDATE/DELETE grants (Supabase's broad defaults are revoked).
-- ---------------------------------------------------------------------------

alter table public.video_notes enable row level security;
alter table public.video_note_saved_answers enable row level security;

drop policy if exists video_notes_select_own on public.video_notes;
create policy video_notes_select_own on public.video_notes for select to authenticated using (
  user_id = auth.uid()
);

drop policy if exists video_note_saved_answers_select_own on public.video_note_saved_answers;
create policy video_note_saved_answers_select_own on public.video_note_saved_answers for select to authenticated using (
  user_id = auth.uid()
);

revoke all privileges on table public.video_notes, public.video_note_saved_answers from public, anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.video_notes, public.video_note_saved_answers from authenticated;
grant select on table public.video_notes, public.video_note_saved_answers to authenticated;

-- ---------------------------------------------------------------------------
-- upsert_video_note_personal: owner-authored personal notes autosave.
-- Resolves the caller from auth.uid() (never client-supplied), verifies video
-- ownership, caps length, and only ever touches personal_text.
-- ---------------------------------------------------------------------------

create or replace function public.upsert_video_note_personal(
  p_video_id uuid,
  p_personal_text text
)
returns public.video_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_text text := coalesce(p_personal_text, '');
  v_row public.video_notes;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.videos where id = p_video_id and user_id = v_user) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  if char_length(v_text) > 20000 then
    raise exception 'note too long' using errcode = '22001';
  end if;

  insert into public.video_notes as vn (video_id, user_id, personal_text, personal_updated_at)
  values (p_video_id, v_user, v_text, now())
  on conflict (video_id, user_id) do update set
    personal_text = excluded.personal_text,
    personal_updated_at = now(),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.upsert_video_note_personal(uuid, text) from public, anon;
grant execute on function public.upsert_video_note_personal(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- save_video_note_answer: pin one owned assistant chat message to the note.
-- Snapshots the question/answer/citations so the note is self-contained and
-- stable; duplicate-prevented via unique(note_id, message_id); idempotent.
-- ---------------------------------------------------------------------------

create or replace function public.save_video_note_answer(
  p_video_id uuid,
  p_message_id uuid
)
returns public.video_note_saved_answers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_note_id uuid;
  v_msg public.video_chat_messages;
  v_question text;
  v_citations jsonb;
  v_row public.video_note_saved_answers;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not exists (select 1 from public.videos where id = p_video_id and user_id = v_user) then
    raise exception 'access denied' using errcode = '42501';
  end if;

  select * into v_msg from public.video_chat_messages
    where id = p_message_id and user_id = v_user and video_id = p_video_id
      and role = 'assistant' and status = 'complete';
  if not found then
    raise exception 'assistant message not found' using errcode = 'P0002';
  end if;

  -- Paired user question from the same request; falls back to empty string.
  select content into v_question from public.video_chat_messages
    where session_id = v_msg.session_id and request_id = v_msg.request_id and role = 'user'
    limit 1;

  select coalesce(jsonb_agg(
      jsonb_build_object(
        'citation_index', c.citation_index,
        'start_ms', c.start_ms,
        'end_ms', c.end_ms,
        'source_segment_indexes', c.source_segment_indexes
      ) order by c.citation_index), '[]'::jsonb)
    into v_citations
    from public.video_chat_message_citations c
    where c.message_id = v_msg.id;

  -- Ensure the Living Note row exists without disturbing existing content.
  insert into public.video_notes (video_id, user_id)
    values (p_video_id, v_user)
    on conflict (video_id, user_id) do nothing;
  select id into v_note_id from public.video_notes where video_id = p_video_id and user_id = v_user;

  insert into public.video_note_saved_answers as sa
      (note_id, video_id, user_id, message_id, question, answer, not_in_video, citations)
    values (v_note_id, p_video_id, v_user, v_msg.id,
            coalesce(v_question, ''), v_msg.content, v_msg.not_in_video, v_citations)
    on conflict (note_id, message_id) do nothing
    returning * into v_row;

  if not found then
    -- Already pinned: return the existing row (idempotent, no duplicate).
    select * into v_row from public.video_note_saved_answers
      where note_id = v_note_id and message_id = v_msg.id;
  end if;
  return v_row;
end;
$$;

revoke all on function public.save_video_note_answer(uuid, uuid) from public, anon;
grant execute on function public.save_video_note_answer(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- remove_video_note_answer: unpin a saved answer (chat history is untouched).
-- ---------------------------------------------------------------------------

create or replace function public.remove_video_note_answer(p_saved_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_deleted integer;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  delete from public.video_note_saved_answers where id = p_saved_id and user_id = v_user;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

revoke all on function public.remove_video_note_answer(uuid) from public, anon;
grant execute on function public.remove_video_note_answer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- set_video_note_ai_status: transition AI generation to generating/failed
-- WITHOUT touching personal_text, saved answers, or a prior valid AI result.
-- service_role-only; the Modal worker resolves p_user_id from the verified token.
-- ---------------------------------------------------------------------------

create or replace function public.set_video_note_ai_status(
  p_video_id uuid,
  p_user_id uuid,
  p_status text,
  p_content_hash text,
  p_error_code text
)
returns public.video_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_notes;
begin
  if not exists (select 1 from public.videos where id = p_video_id and user_id = p_user_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  insert into public.video_notes as vn (video_id, user_id, ai_status, ai_content_hash, ai_error_code)
  values (p_video_id, p_user_id, p_status, p_content_hash, p_error_code)
  on conflict (video_id, user_id) do update set
    ai_status = excluded.ai_status,
    ai_content_hash = coalesce(excluded.ai_content_hash, vn.ai_content_hash),
    ai_error_code = excluded.ai_error_code,
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.set_video_note_ai_status(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.set_video_note_ai_status(uuid, uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- persist_video_note_ai: atomic ready-persistence of the generated AI note.
-- Only ever writes the ai_* columns; personal_text and saved answers are
-- preserved. p_key_points / p_action_items:
--   [{ "text": str, "citations": [{ "start_ms": int, "end_ms": int,
--      "source_segment_indexes": [int, ...] }, ...] }, ...]
-- ---------------------------------------------------------------------------

create or replace function public.persist_video_note_ai(
  p_video_id uuid,
  p_user_id uuid,
  p_overview text,
  p_key_points jsonb,
  p_action_items jsonb,
  p_content_hash text,
  p_source_insight_hash text,
  p_saved_answer_count integer,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_schema_version text
)
returns public.video_notes
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.video_notes;
begin
  if not exists (select 1 from public.videos where id = p_video_id and user_id = p_user_id) then
    raise exception 'access denied' using errcode = '42501';
  end if;
  insert into public.video_notes as vn (
    video_id, user_id, ai_status, ai_overview, ai_key_points, ai_action_items,
    ai_content_hash, ai_source_insight_hash, ai_saved_answer_count,
    ai_provider, ai_model, ai_prompt_version, ai_schema_version,
    ai_error_code, ai_generated_at
  ) values (
    p_video_id, p_user_id, 'ready', p_overview,
    coalesce(p_key_points, '[]'::jsonb), coalesce(p_action_items, '[]'::jsonb),
    p_content_hash, p_source_insight_hash, p_saved_answer_count,
    p_provider, p_model, p_prompt_version, p_schema_version, null, now()
  )
  on conflict (video_id, user_id) do update set
    ai_status = 'ready',
    ai_overview = excluded.ai_overview,
    ai_key_points = excluded.ai_key_points,
    ai_action_items = excluded.ai_action_items,
    ai_content_hash = excluded.ai_content_hash,
    ai_source_insight_hash = excluded.ai_source_insight_hash,
    ai_saved_answer_count = excluded.ai_saved_answer_count,
    ai_provider = excluded.ai_provider,
    ai_model = excluded.ai_model,
    ai_prompt_version = excluded.ai_prompt_version,
    ai_schema_version = excluded.ai_schema_version,
    ai_error_code = null,
    ai_generated_at = now(),
    updated_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.persist_video_note_ai(uuid, uuid, text, jsonb, jsonb, text, text, integer, text, text, text, text) from public, anon, authenticated;
grant execute on function public.persist_video_note_ai(uuid, uuid, text, jsonb, jsonb, text, text, integer, text, text, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- mark_video_note_ai_stale: flag a ready AI note whose inputs changed. Content
-- is preserved (UI shows an explicit stale state) until regeneration succeeds.
-- ---------------------------------------------------------------------------

create or replace function public.mark_video_note_ai_stale(
  p_video_id uuid,
  p_user_id uuid,
  p_keep_hash text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.video_notes
  set ai_status = 'stale', updated_at = now()
  where video_id = p_video_id
    and user_id = p_user_id
    and ai_status = 'ready'
    and (p_keep_hash is null or ai_content_hash is distinct from p_keep_hash);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.mark_video_note_ai_stale(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_video_note_ai_stale(uuid, uuid, text) to service_role;
