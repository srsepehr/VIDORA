-- Vidora phase 6: private per-video grounded chat.
-- Additive only. Browser clients may read their own sessions/messages/citations
-- but all index and generated-message writes are service-role-only.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;

create table public.video_chat_indexes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references public.videos(id) on delete cascade,
  status text not null default 'ready' check (status in ('ready','failed','stale')),
  content_hash text not null,
  chunker_version text not null,
  embedding_provider text not null,
  embedding_model text not null,
  embedding_version text not null,
  embedding_dimensions integer not null check (embedding_dimensions = 384),
  chunk_count integer not null check (chunk_count >= 0),
  error_code text,
  error_detail text,
  indexed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.video_chat_chunks (
  id uuid primary key default gen_random_uuid(),
  index_id uuid not null references public.video_chat_indexes(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  chunk_index integer not null check (chunk_index >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  source_segment_indexes jsonb not null,
  text_fa text not null,
  source_text text,
  content_hash text not null,
  embedding extensions.vector(384) not null,
  created_at timestamptz not null default now(),
  unique (index_id, chunk_index)
);

create table public.video_chat_sessions (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, user_id)
);

create table public.video_chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.video_chat_sessions(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  status text not null default 'complete' check (status in ('complete','failed')),
  request_id uuid not null,
  provider text,
  model text,
  prompt_version text,
  schema_version text,
  request_hash text,
  not_in_video boolean not null default false,
  error_code text,
  created_at timestamptz not null default now(),
  unique (session_id, request_id, role)
);

create table public.video_chat_message_citations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.video_chat_messages(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  citation_index integer not null check (citation_index >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms > start_ms),
  source_segment_indexes jsonb not null,
  chunk_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (message_id, citation_index)
);

create index video_chat_chunks_video_idx on public.video_chat_chunks(video_id, chunk_index);
create index video_chat_chunks_embedding_idx on public.video_chat_chunks using hnsw (embedding extensions.vector_cosine_ops);
create index video_chat_messages_session_idx on public.video_chat_messages(session_id, created_at, id);
create index video_chat_messages_rate_idx on public.video_chat_messages(user_id, video_id, created_at) where role = 'user';
create index video_chat_citations_video_idx on public.video_chat_message_citations(video_id, message_id);

create trigger video_chat_indexes_set_updated_at before update on public.video_chat_indexes
  for each row execute function public.set_updated_at();
create trigger video_chat_sessions_set_updated_at before update on public.video_chat_sessions
  for each row execute function public.set_updated_at();

alter table public.video_chat_indexes enable row level security;
alter table public.video_chat_chunks enable row level security;
alter table public.video_chat_sessions enable row level security;
alter table public.video_chat_messages enable row level security;
alter table public.video_chat_message_citations enable row level security;

create policy video_chat_indexes_select_own on public.video_chat_indexes for select to authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid())
);
create policy video_chat_sessions_select_own on public.video_chat_sessions for select to authenticated using (user_id = auth.uid());
create policy video_chat_messages_select_own on public.video_chat_messages for select to authenticated using (user_id = auth.uid());
create policy video_chat_citations_select_own on public.video_chat_message_citations for select to authenticated using (
  exists (select 1 from public.videos v where v.id = video_id and v.user_id = auth.uid())
);

grant select on public.video_chat_indexes, public.video_chat_sessions,
  public.video_chat_messages, public.video_chat_message_citations to authenticated;
-- Deliberately no authenticated grants or policies on chunks/embeddings.

create or replace function public.persist_video_chat_index(
  p_video_id uuid, p_content_hash text, p_chunker_version text,
  p_embedding_provider text, p_embedding_model text, p_embedding_version text,
  p_embedding_dimensions integer, p_chunks jsonb
) returns public.video_chat_indexes
language plpgsql security definer set search_path = public, extensions as $$
declare v_index public.video_chat_indexes; ch jsonb;
begin
  if p_embedding_dimensions <> 384 then raise exception 'invalid embedding dimensions'; end if;
  if not exists (select 1 from public.videos where id = p_video_id) then raise exception 'video not found'; end if;
  insert into public.video_chat_indexes as i
    (video_id,status,content_hash,chunker_version,embedding_provider,embedding_model,
     embedding_version,embedding_dimensions,chunk_count,indexed_at,error_code,error_detail)
  values (p_video_id,'ready',p_content_hash,p_chunker_version,p_embedding_provider,p_embedding_model,
          p_embedding_version,p_embedding_dimensions,jsonb_array_length(p_chunks),now(),null,null)
  on conflict (video_id) do update set
    status='ready', content_hash=excluded.content_hash, chunker_version=excluded.chunker_version,
    embedding_provider=excluded.embedding_provider, embedding_model=excluded.embedding_model,
    embedding_version=excluded.embedding_version, embedding_dimensions=excluded.embedding_dimensions,
    chunk_count=excluded.chunk_count, indexed_at=now(), error_code=null, error_detail=null, updated_at=now()
  returning * into v_index;
  delete from public.video_chat_chunks where index_id = v_index.id;
  for ch in select * from jsonb_array_elements(p_chunks) loop
    insert into public.video_chat_chunks
      (index_id,video_id,chunk_index,start_ms,end_ms,source_segment_indexes,text_fa,source_text,content_hash,embedding)
    values (v_index.id,p_video_id,(ch->>'chunk_index')::integer,(ch->>'start_ms')::integer,
      (ch->>'end_ms')::integer,ch->'source_segment_indexes',ch->>'text_fa',nullif(ch->>'source_text',''),
      ch->>'content_hash',(ch->>'embedding')::extensions.vector);
  end loop;
  return v_index;
end $$;

create or replace function public.match_video_chat_chunks(
  p_video_id uuid, p_content_hash text, p_query_embedding extensions.vector(384),
  p_top_k integer default 5, p_min_score real default 0.72
) returns table(id uuid,chunk_index integer,start_ms integer,end_ms integer,
  source_segment_indexes jsonb,text_fa text,source_text text,score real)
language sql stable security definer set search_path = public, extensions as $$
  select c.id,c.chunk_index,c.start_ms,c.end_ms,c.source_segment_indexes,c.text_fa,c.source_text,
         (1 - (c.embedding <=> p_query_embedding))::real as score
  from public.video_chat_chunks c join public.video_chat_indexes i on i.id=c.index_id
  where c.video_id=p_video_id and i.status='ready' and i.content_hash=p_content_hash
    and (1 - (c.embedding <=> p_query_embedding)) >= p_min_score
  order by c.embedding <=> p_query_embedding, c.chunk_index
  limit greatest(1,least(p_top_k,10))
$$;

create or replace function public.get_or_create_video_chat_session(p_video_id uuid,p_user_id uuid)
returns public.video_chat_sessions language plpgsql security definer set search_path=public as $$
declare s public.video_chat_sessions;
begin
  if not exists(select 1 from public.videos where id=p_video_id and user_id=p_user_id) then raise exception 'access denied'; end if;
  insert into public.video_chat_sessions(video_id,user_id) values(p_video_id,p_user_id)
  on conflict(video_id,user_id) do update set updated_at=now() returning * into s;
  return s;
end $$;

create or replace function public.persist_video_chat_exchange(
  p_session_id uuid,p_video_id uuid,p_user_id uuid,p_request_id uuid,p_question text,p_answer text,
  p_not_in_video boolean,p_provider text,p_model text,p_prompt_version text,p_schema_version text,
  p_request_hash text,p_citations jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.video_chat_messages; a public.video_chat_messages; c jsonb;
begin
  if not exists(select 1 from public.video_chat_sessions s where s.id=p_session_id and s.video_id=p_video_id and s.user_id=p_user_id)
    then raise exception 'session access denied'; end if;
  -- Serialize retries for the same client request so concurrent delivery cannot
  -- create duplicate rows. The request fingerprint also prevents accidental
  -- reuse of one request id for different question text.
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_request_id::text, 0));
  select * into a from public.video_chat_messages where session_id=p_session_id and request_id=p_request_id and role='assistant';
  if found then
    if a.request_hash is distinct from p_request_hash then
      return jsonb_build_object('session_id',p_session_id,'assistant_message_id',a.id,'reused',true,'conflict',true);
    end if;
    return jsonb_build_object('session_id',p_session_id,'assistant_message_id',a.id,'reused',true,'conflict',false);
  end if;
  insert into public.video_chat_messages(session_id,video_id,user_id,role,content,status,request_id,request_hash,error_code)
    values(p_session_id,p_video_id,p_user_id,'user',p_question,'complete',p_request_id,p_request_hash,null)
  on conflict(session_id,request_id,role) do update set
    content=excluded.content,status='complete',request_hash=excluded.request_hash,error_code=null
  where public.video_chat_messages.request_hash=excluded.request_hash
  returning * into u;
  if not found then
    return jsonb_build_object('session_id',p_session_id,'reused',true,'conflict',true);
  end if;
  insert into public.video_chat_messages(session_id,video_id,user_id,role,content,request_id,not_in_video,
    provider,model,prompt_version,schema_version,request_hash)
    values(p_session_id,p_video_id,p_user_id,'assistant',p_answer,p_request_id,p_not_in_video,
      p_provider,p_model,p_prompt_version,p_schema_version,p_request_hash) returning * into a;
  for c in select * from jsonb_array_elements(coalesce(p_citations,'[]'::jsonb)) loop
    insert into public.video_chat_message_citations(message_id,video_id,citation_index,start_ms,end_ms,source_segment_indexes,chunk_ids)
    values(a.id,p_video_id,(c->>'citation_index')::integer,(c->>'start_ms')::integer,(c->>'end_ms')::integer,
      c->'source_segment_indexes',coalesce(c->'chunk_ids','[]'::jsonb));
  end loop;
  update public.video_chat_sessions set updated_at=now() where id=p_session_id;
  return jsonb_build_object('session_id',p_session_id,'user_message_id',u.id,'assistant_message_id',a.id,'reused',false,'conflict',false);
end $$;

create or replace function public.persist_video_chat_failure(
  p_session_id uuid,p_video_id uuid,p_user_id uuid,p_request_id uuid,
  p_question text,p_request_hash text,p_error_code text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare u public.video_chat_messages; a public.video_chat_messages;
begin
  if not exists(select 1 from public.video_chat_sessions s where s.id=p_session_id and s.video_id=p_video_id and s.user_id=p_user_id)
    then raise exception 'session access denied'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_session_id::text || ':' || p_request_id::text, 0));
  select * into a from public.video_chat_messages
    where session_id=p_session_id and request_id=p_request_id and role='assistant';
  if found then
    return jsonb_build_object('session_id',p_session_id,'reused',true,'completed',true,
      'conflict',a.request_hash is distinct from p_request_hash);
  end if;
  insert into public.video_chat_messages
    (session_id,video_id,user_id,role,content,status,request_id,request_hash,error_code)
  values(p_session_id,p_video_id,p_user_id,'user',p_question,'failed',p_request_id,p_request_hash,p_error_code)
  on conflict(session_id,request_id,role) do update set
    status='failed',error_code=excluded.error_code
  where public.video_chat_messages.request_hash=excluded.request_hash
  returning * into u;
  if not found then
    return jsonb_build_object('session_id',p_session_id,'reused',true,'completed',false,'conflict',true);
  end if;
  return jsonb_build_object('session_id',p_session_id,'user_message_id',u.id,'reused',false,'completed',false,'conflict',false);
end $$;

revoke all on function public.persist_video_chat_index(uuid,text,text,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.match_video_chat_chunks(uuid,text,extensions.vector,integer,real) from public,anon,authenticated;
revoke all on function public.get_or_create_video_chat_session(uuid,uuid) from public,anon,authenticated;
revoke all on function public.persist_video_chat_exchange(uuid,uuid,uuid,uuid,text,text,boolean,text,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.persist_video_chat_failure(uuid,uuid,uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.persist_video_chat_index(uuid,text,text,text,text,text,integer,jsonb) to service_role;
grant execute on function public.match_video_chat_chunks(uuid,text,extensions.vector,integer,real) to service_role;
grant execute on function public.get_or_create_video_chat_session(uuid,uuid) to service_role;
grant execute on function public.persist_video_chat_exchange(uuid,uuid,uuid,uuid,text,text,boolean,text,text,text,text,text,jsonb) to service_role;
grant execute on function public.persist_video_chat_failure(uuid,uuid,uuid,uuid,text,text,text) to service_role;
