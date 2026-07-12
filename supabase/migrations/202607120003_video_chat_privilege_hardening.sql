-- Vidora phase 6 hardening: Supabase grants broad table privileges to API
-- roles by default. Keep browser access read-only for owner-visible chat
-- metadata, and remove all browser access to private chunks/embeddings.

revoke all privileges on table public.video_chat_chunks from public, anon, authenticated;

revoke all privileges on table public.video_chat_indexes,
  public.video_chat_sessions,
  public.video_chat_messages,
  public.video_chat_message_citations from public, anon;

revoke insert, update, delete, truncate, references, trigger
  on table public.video_chat_indexes,
  public.video_chat_sessions,
  public.video_chat_messages,
  public.video_chat_message_citations from authenticated;

grant select on table public.video_chat_indexes,
  public.video_chat_sessions,
  public.video_chat_messages,
  public.video_chat_message_citations to authenticated;
