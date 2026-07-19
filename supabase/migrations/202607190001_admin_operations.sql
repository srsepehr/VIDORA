-- Vidora internal admin operations and analytics foundation.
-- Additive only. Apply after 202607120004_video_notes.sql.
--
-- Security model:
--   authenticated browser -> SECURITY DEFINER RPC -> centralized permission map
--   -> bounded query or transactional mutation + immutable audit record.
-- No browser role can read or mutate the underlying admin tables directly.

create extension if not exists pgcrypto;

do $$
begin
  create type public.admin_role as enum (
    'super_admin', 'operations', 'support', 'analyst', 'content_manager', 'finance'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.admin_membership_status as enum ('active', 'suspended');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.account_status as enum ('active', 'suspended');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.payment_record_status as enum (
    'pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'cancelled'
  );
exception when duplicate_object then null;
end $$;

alter table public.profiles add column if not exists account_status public.account_status not null default 'active';
alter table public.profiles add column if not exists suspended_at timestamptz;
alter table public.profiles add column if not exists acquisition_source text;
alter table public.profiles add column if not exists acquisition_data jsonb not null default '{}'::jsonb;

alter table public.video_jobs add column if not exists model text;
alter table public.video_jobs add column if not exists correlation_id uuid;
alter table public.video_jobs add column if not exists estimated_cost_usd numeric(14,6);

alter table public.library_videos add column if not exists original_title text;
alter table public.library_videos add column if not exists slug text;
alter table public.library_videos add column if not exists source_url text;
alter table public.library_videos add column if not exists speaker text;
alter table public.library_videos add column if not exists source_language text;
alter table public.library_videos add column if not exists is_featured boolean not null default false;
alter table public.library_videos add column if not exists subtitle_state text not null default 'unknown';
alter table public.library_videos add column if not exists summary_state text not null default 'unknown';
alter table public.library_videos add column if not exists takeaway_state text not null default 'unknown';
alter table public.library_videos add column if not exists published_at timestamptz;
alter table public.library_videos add column if not exists archived_at timestamptz;

create unique index if not exists library_videos_slug_unique_idx
  on public.library_videos (slug) where slug is not null;
create index if not exists profiles_account_status_idx on public.profiles (account_status, created_at desc);
create index if not exists profiles_acquisition_source_idx on public.profiles (acquisition_source, created_at desc);
create index if not exists video_jobs_status_created_admin_idx on public.video_jobs (status, created_at desc);
create index if not exists video_jobs_correlation_idx on public.video_jobs (correlation_id) where correlation_id is not null;

create table if not exists public.admin_role_permissions (
  role public.admin_role not null,
  permission text not null check (permission ~ '^[a-z][a-z0-9_.]+$'),
  primary key (role, permission)
);

create table if not exists public.admin_memberships (
  user_id uuid primary key references auth.users(id) on delete restrict,
  role public.admin_role not null,
  status public.admin_membership_status not null default 'active',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_role public.admin_role not null,
  action_type text not null check (length(action_type) between 3 and 120),
  target_entity_type text not null check (length(target_entity_type) between 2 and 80),
  target_entity_id text,
  previous_value jsonb,
  new_value jsonb,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  request_id uuid not null,
  ip_address inet,
  user_agent text,
  success boolean not null,
  failure_code text,
  created_at timestamptz not null default now(),
  unique (actor_user_id, action_type, request_id)
);

create table if not exists public.subscription_adjustments (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  adjustment_type text not null check (adjustment_type in ('add_days', 'remove_days', 'complimentary_grant', 'plan_change', 'cancel', 'compensation')),
  days_delta integer not null default 0,
  previous_ends_at timestamptz,
  new_ends_at timestamptz,
  previous_plan_id uuid references public.plans(id) on delete restrict,
  new_plan_id uuid references public.plans(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_role public.admin_role not null,
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (actor_user_id, request_id)
);

create table if not exists public.payment_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete restrict,
  provider text not null,
  provider_reference text not null,
  status public.payment_record_status not null default 'pending',
  amount numeric(14,2) not null check (amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  failure_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (provider, provider_reference)
);

create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique,
  event_name text not null,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id uuid,
  session_id uuid not null,
  page text,
  referrer text,
  acquisition_source text,
  device_class text check (device_class is null or device_class in ('mobile', 'tablet', 'desktop', 'unknown')),
  browser_family text,
  video_id text,
  category_id text,
  subscription_status text,
  playback_session_id uuid,
  playback_position_seconds numeric(12,3),
  video_duration_seconds numeric(12,3),
  processing_job_id uuid,
  request_correlation_id uuid,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (user_id is not null or anonymous_id is not null),
  check (jsonb_typeof(properties) = 'object')
);

create table if not exists public.video_playback_sessions (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id uuid,
  video_id text not null,
  app_session_id uuid not null,
  started_at timestamptz not null,
  last_event_at timestamptz not null,
  duration_seconds numeric(12,3),
  watched_seconds numeric(12,3) not null default 0,
  max_progress_percent numeric(5,2) not null default 0 check (max_progress_percent between 0 and 100),
  completed boolean not null default false,
  subtitle_activated boolean not null default false,
  summary_opened boolean not null default false,
  subscription_status text,
  acquisition_source text,
  device_class text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or anonymous_id is not null)
);

create table if not exists public.admin_incidents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  status text not null check (status in ('investigating', 'identified', 'monitoring', 'resolved')),
  severity text not null check (severity in ('minor', 'major', 'critical')),
  safe_summary_fa text not null,
  started_at timestamptz not null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]+$'),
  value jsonb not null,
  description_fa text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists admin_memberships_role_status_idx on public.admin_memberships (status, role);
create index if not exists admin_audit_actor_created_idx on public.admin_audit_logs (actor_user_id, created_at desc);
create index if not exists admin_audit_target_created_idx on public.admin_audit_logs (target_entity_type, target_entity_id, created_at desc);
create index if not exists admin_audit_created_idx on public.admin_audit_logs (created_at desc);
create index if not exists subscription_adjustments_user_created_idx on public.subscription_adjustments (user_id, created_at desc);
create index if not exists subscription_adjustments_subscription_idx on public.subscription_adjustments (subscription_id, created_at desc);
create index if not exists payment_records_user_created_idx on public.payment_records (user_id, created_at desc);
create index if not exists payment_records_status_created_idx on public.payment_records (status, created_at desc);
create index if not exists product_events_occurred_idx on public.product_events (occurred_at desc);
create index if not exists product_events_name_occurred_idx on public.product_events (event_name, occurred_at desc);
create index if not exists product_events_user_occurred_idx on public.product_events (user_id, occurred_at desc) where user_id is not null;
create index if not exists product_events_video_occurred_idx on public.product_events (video_id, occurred_at desc) where video_id is not null;
create index if not exists product_events_session_idx on public.product_events (session_id, occurred_at);
create index if not exists product_events_playback_idx on public.product_events (playback_session_id, occurred_at) where playback_session_id is not null;
create index if not exists playback_video_started_idx on public.video_playback_sessions (video_id, started_at desc);
create index if not exists playback_user_started_idx on public.video_playback_sessions (user_id, started_at desc) where user_id is not null;

drop trigger if exists admin_memberships_set_updated_at on public.admin_memberships;
create trigger admin_memberships_set_updated_at before update on public.admin_memberships
for each row execute function public.set_updated_at();

drop trigger if exists playback_sessions_set_updated_at on public.video_playback_sessions;
create trigger playback_sessions_set_updated_at before update on public.video_playback_sessions
for each row execute function public.set_updated_at();

drop trigger if exists admin_incidents_set_updated_at on public.admin_incidents;
create trigger admin_incidents_set_updated_at before update on public.admin_incidents
for each row execute function public.set_updated_at();

-- All privileged tables are RPC-only. RLS is a second boundary in addition to
-- revoked table grants. product_events is also write-only through a validated RPC.
alter table public.admin_role_permissions enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.admin_audit_logs enable row level security;
alter table public.subscription_adjustments enable row level security;
alter table public.payment_records enable row level security;
alter table public.product_events enable row level security;
alter table public.video_playback_sessions enable row level security;
alter table public.admin_incidents enable row level security;
alter table public.platform_settings enable row level security;

revoke all on public.admin_role_permissions from public, anon, authenticated;
revoke all on public.admin_memberships from public, anon, authenticated;
revoke all on public.admin_audit_logs from public, anon, authenticated;
revoke all on public.subscription_adjustments from public, anon, authenticated;
revoke all on public.payment_records from public, anon, authenticated;
revoke all on public.product_events from public, anon, authenticated;
revoke all on public.video_playback_sessions from public, anon, authenticated;
revoke all on public.admin_incidents from public, anon, authenticated;
revoke all on public.platform_settings from public, anon, authenticated;

-- Centralized server-side permission matrix. The frontend receives the
-- resolved permissions for visibility, but this table remains authoritative.
insert into public.admin_role_permissions (role, permission)
values
  ('super_admin', 'overview.read'), ('super_admin', 'users.read'), ('super_admin', 'users.pii.read'),
  ('super_admin', 'users.suspend'), ('super_admin', 'subscriptions.read'),
  ('super_admin', 'subscriptions.days.add'), ('super_admin', 'subscriptions.days.remove'),
  ('super_admin', 'subscriptions.plan.change'), ('super_admin', 'subscriptions.cancel'),
  ('super_admin', 'payments.read'), ('super_admin', 'payments.export'), ('super_admin', 'payments.refund'),
  ('super_admin', 'videos.read'), ('super_admin', 'videos.manage'), ('super_admin', 'analytics.read'),
  ('super_admin', 'jobs.read'), ('super_admin', 'jobs.retry'), ('super_admin', 'system.read'),
  ('super_admin', 'audit.read'), ('super_admin', 'team.read'), ('super_admin', 'team.manage'),
  ('super_admin', 'settings.read'), ('super_admin', 'settings.manage'),

  ('operations', 'overview.read'), ('operations', 'users.read'), ('operations', 'users.pii.read'),
  ('operations', 'users.suspend'), ('operations', 'subscriptions.read'),
  ('operations', 'subscriptions.days.add'), ('operations', 'subscriptions.days.remove'),
  ('operations', 'subscriptions.plan.change'), ('operations', 'videos.read'),
  ('operations', 'analytics.read'), ('operations', 'jobs.read'), ('operations', 'jobs.retry'),
  ('operations', 'system.read'),

  ('support', 'overview.read'), ('support', 'users.read'), ('support', 'users.pii.read'),
  ('support', 'subscriptions.read'), ('support', 'subscriptions.days.add'), ('support', 'jobs.read'),

  ('analyst', 'overview.read'), ('analyst', 'analytics.read'),

  ('content_manager', 'overview.read'), ('content_manager', 'videos.read'),
  ('content_manager', 'videos.manage'), ('content_manager', 'analytics.read'),

  ('finance', 'overview.read'), ('finance', 'subscriptions.read'), ('finance', 'payments.read'),
  ('finance', 'payments.export'), ('finance', 'payments.refund'), ('finance', 'analytics.read')
on conflict do nothing;

create or replace function public.admin_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_memberships membership
    join public.admin_role_permissions permission on permission.role = membership.role
    where membership.user_id = auth.uid()
      and membership.status = 'active'
      and permission.permission = p_permission
  );
$$;

create or replace function public.admin_require_permission(p_permission text)
returns public.admin_role
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.admin_role;
begin
  select membership.role into v_role
  from public.admin_memberships membership
  join public.admin_role_permissions permission on permission.role = membership.role
  where membership.user_id = auth.uid()
    and membership.status = 'active'
    and permission.permission = p_permission;

  if v_role is null then
    raise insufficient_privilege using message = 'ADMIN_PERMISSION_DENIED';
  end if;
  return v_role;
end;
$$;

create or replace function public.prevent_admin_audit_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'ADMIN_AUDIT_IMMUTABLE' using errcode = 'P0403';
end;
$$;

drop trigger if exists admin_audit_immutable on public.admin_audit_logs;
create trigger admin_audit_immutable before update or delete on public.admin_audit_logs
for each row execute function public.prevent_admin_audit_mutation();

create or replace function public.admin_write_audit(
  p_actor_role public.admin_role,
  p_action_type text,
  p_target_entity_type text,
  p_target_entity_id text,
  p_previous_value jsonb,
  p_new_value jsonb,
  p_reason text,
  p_request_id uuid,
  p_user_agent text,
  p_success boolean,
  p_failure_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.admin_audit_logs (
    actor_user_id, actor_role, action_type, target_entity_type, target_entity_id,
    previous_value, new_value, reason, request_id, user_agent, success, failure_code
  ) values (
    auth.uid(), p_actor_role, p_action_type, p_target_entity_type, p_target_entity_id,
    p_previous_value, p_new_value, btrim(p_reason), p_request_id,
    left(nullif(p_user_agent, ''), 500), p_success, p_failure_code
  )
  on conflict (actor_user_id, action_type, request_id) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.admin_audit_logs
    where actor_user_id = auth.uid() and action_type = p_action_type and request_id = p_request_id;
  end if;
  return v_id;
end;
$$;

create or replace function public.admin_get_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_membership public.admin_memberships;
begin
  select * into v_membership from public.admin_memberships
  where user_id = auth.uid() and status = 'active';
  if v_membership.user_id is null then
    raise insufficient_privilege using message = 'ADMIN_ACCESS_REQUIRED';
  end if;

  return jsonb_build_object(
    'userId', v_membership.user_id,
    'role', v_membership.role,
    'roleLabelFa', case v_membership.role
      when 'super_admin' then 'مدیر ارشد' when 'operations' then 'عملیات'
      when 'support' then 'پشتیبانی' when 'analyst' then 'تحلیل‌گر'
      when 'content_manager' then 'مدیر محتوا' when 'finance' then 'مالی' end,
    'membershipStatus', v_membership.status,
    'permissions', coalesce((
      select jsonb_agg(permission order by permission)
      from public.admin_role_permissions where role = v_membership.role
    ), '[]'::jsonb)
  );
end;
$$;

-- Validated, idempotent product event ingestion. No caller can choose user_id.
create or replace function public.record_product_event(
  p_event_id uuid,
  p_event_name text,
  p_occurred_at timestamptz,
  p_anonymous_id uuid,
  p_session_id uuid,
  p_page text default null,
  p_referrer text default null,
  p_device_class text default 'unknown',
  p_browser_family text default null,
  p_properties jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_video_id text;
  v_playback_id uuid;
  v_position numeric;
  v_duration numeric;
  v_watched numeric;
  v_progress numeric;
  v_inserted integer;
begin
  if p_event_id is null or p_session_id is null then
    raise exception 'EVENT_ID_AND_SESSION_REQUIRED' using errcode = 'P0200';
  end if;
  if v_user_id is null and p_anonymous_id is null then
    raise exception 'EVENT_IDENTITY_REQUIRED' using errcode = 'P0201';
  end if;
  if p_occurred_at < now() - interval '7 days' or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'EVENT_TIME_INVALID' using errcode = 'P0202';
  end if;
  if p_event_name <> all (array[
    'user_signed_up','user_logged_in','landing_viewed','library_viewed','category_viewed',
    'video_card_clicked','video_detail_viewed','video_started','video_paused','video_resumed',
    'video_progress','video_completed','subtitle_enabled','subtitle_disabled','summary_opened',
    'key_takeaway_interacted','watchlist_added','watchlist_removed','video_liked','video_unliked',
    'upload_page_viewed','video_upload_started','video_upload_completed','youtube_link_submitted',
    'translation_requested','translation_completed','translation_failed','pricing_viewed','plan_selected',
    'checkout_started','payment_succeeded','payment_failed','subscription_expired',
    'video_chat_opened','video_chat_message_sent','auth_opened','auth_completed',
    'landing_primary_cta_clicked','library_opened','video_play_attempted','video_paywall_viewed',
    'subscription_plans_viewed','dashboard_subscription_popup_viewed',
    'dashboard_subscription_popup_closed','add_video_attempted','profile_menu_opened'
  ]) then
    raise exception 'EVENT_NAME_NOT_ALLOWED' using errcode = 'P0203';
  end if;
  if jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object'
     or octet_length(coalesce(p_properties, '{}'::jsonb)::text) > 16384 then
    raise exception 'EVENT_PROPERTIES_INVALID' using errcode = 'P0204';
  end if;

  v_video_id := nullif(p_properties->>'video_id', '');
  v_playback_id := nullif(p_properties->>'playback_session_id', '')::uuid;
  v_position := nullif(p_properties->>'position_seconds', '')::numeric;
  v_duration := nullif(p_properties->>'duration_seconds', '')::numeric;
  v_watched := nullif(p_properties->>'watched_seconds', '')::numeric;
  v_progress := nullif(p_properties->>'progress_percent', '')::numeric;

  insert into public.product_events (
    event_id, event_name, occurred_at, user_id, anonymous_id, session_id, page, referrer,
    acquisition_source, device_class, browser_family, video_id, category_id,
    subscription_status, playback_session_id, playback_position_seconds,
    video_duration_seconds, processing_job_id, request_correlation_id, properties
  ) values (
    p_event_id, p_event_name, p_occurred_at, v_user_id, case when v_user_id is null then p_anonymous_id else p_anonymous_id end,
    p_session_id, left(p_page, 300), left(p_referrer, 500), nullif(p_properties->>'acquisition_source', ''),
    p_device_class, left(p_browser_family, 120), v_video_id, nullif(p_properties->>'category_id', ''),
    nullif(p_properties->>'subscription_status', ''), v_playback_id, v_position, v_duration,
    nullif(p_properties->>'processing_job_id', '')::uuid,
    nullif(p_properties->>'request_correlation_id', '')::uuid,
    p_properties - array['email','phone','title','url','transcript','question','answer','token']
  ) on conflict (event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then return false; end if;

  if v_playback_id is not null and v_video_id is not null and p_event_name in ('video_started','video_progress','video_paused','video_resumed','video_completed','subtitle_enabled','subtitle_disabled','summary_opened') then
    insert into public.video_playback_sessions (
      id, user_id, anonymous_id, video_id, app_session_id, started_at, last_event_at,
      duration_seconds, watched_seconds, max_progress_percent, completed,
      subtitle_activated, summary_opened, subscription_status, acquisition_source, device_class
    ) values (
      v_playback_id, v_user_id, p_anonymous_id, v_video_id, p_session_id, p_occurred_at, p_occurred_at,
      greatest(v_duration, 0), greatest(coalesce(v_watched, 0), 0), greatest(least(coalesce(v_progress, 0), 100), 0),
      p_event_name = 'video_completed' and coalesce(v_progress, 0) >= 90,
      p_event_name = 'subtitle_enabled', p_event_name = 'summary_opened',
      nullif(p_properties->>'subscription_status', ''), nullif(p_properties->>'acquisition_source', ''), p_device_class
    ) on conflict (id) do update set
      last_event_at = greatest(public.video_playback_sessions.last_event_at, excluded.last_event_at),
      duration_seconds = coalesce(excluded.duration_seconds, public.video_playback_sessions.duration_seconds),
      watched_seconds = greatest(public.video_playback_sessions.watched_seconds, excluded.watched_seconds),
      max_progress_percent = greatest(public.video_playback_sessions.max_progress_percent, excluded.max_progress_percent),
      completed = public.video_playback_sessions.completed or excluded.completed,
      subtitle_activated = public.video_playback_sessions.subtitle_activated or excluded.subtitle_activated,
      summary_opened = public.video_playback_sessions.summary_opened or excluded.summary_opened,
      subscription_status = coalesce(excluded.subscription_status, public.video_playback_sessions.subscription_status),
      device_class = coalesce(excluded.device_class, public.video_playback_sessions.device_class);
  end if;
  return true;
end;
$$;

create or replace function public.admin_list_users(
  p_search text default null,
  p_filters jsonb default '{}'::jsonb,
  p_page integer default 1,
  p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per_page integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_total bigint;
  v_items jsonb;
  v_can_pii boolean;
begin
  perform public.admin_require_permission('users.read');
  v_can_pii := public.admin_has_permission('users.pii.read');

  with user_rows as (
    select p.id, p.display_name, p.email, au.phone, au.created_at, au.last_sign_in_at,
      p.account_status, p.acquisition_source,
      s.status::text as subscription_status, plan.name_fa as plan_name_fa, s.ends_at,
      case when s.ends_at is null then null else greatest(ceil(extract(epoch from (s.ends_at - now())) / 86400.0), 0)::integer end as remaining_days,
      activity.last_activity_at,
      coalesce(playback.watched_videos, 0)::integer as watched_videos,
      coalesce(playback.watch_seconds, 0)::bigint as watch_seconds,
      coalesce(videos.uploaded_videos, 0)::integer as uploaded_videos,
      coalesce(videos.completed_translations, 0)::integer as completed_translations,
      coalesce(videos.failed_translations, 0)::integer as failed_translations
    from public.profiles p
    join auth.users au on au.id = p.id
    left join lateral (
      select sub.* from public.subscriptions sub where sub.user_id = p.id order by sub.created_at desc limit 1
    ) s on true
    left join public.plans plan on plan.id = s.plan_id
    left join lateral (
      select max(event.occurred_at) as last_activity_at from public.product_events event where event.user_id = p.id
    ) activity on true
    left join lateral (
      select count(distinct session.video_id) as watched_videos, floor(coalesce(sum(session.watched_seconds), 0)) as watch_seconds
      from public.video_playback_sessions session where session.user_id = p.id
    ) playback on true
    left join lateral (
      select count(*) as uploaded_videos,
        count(*) filter (where video.status = 'completed') as completed_translations,
        count(*) filter (where video.status = 'failed') as failed_translations
      from public.videos video where video.user_id = p.id
    ) videos on true
    where (v_search = ''
      or lower(coalesce(p.display_name, '')) like '%' || v_search || '%'
      or lower(p.email) like '%' || v_search || '%'
      or lower(coalesce(au.phone, '')) like '%' || v_search || '%'
      or p.id::text = v_search
      or exists (select 1 from public.subscriptions sx where sx.user_id = p.id and lower(coalesce(sx.payment_reference, '')) = v_search)
      or exists (select 1 from public.videos vx where vx.user_id = p.id and vx.id::text = v_search))
      and (not (p_filters ? 'accountStatus') or p.account_status::text = p_filters->>'accountStatus')
      and (not (p_filters ? 'subscriptionStatus') or coalesce(s.status::text, 'never_subscribed') = p_filters->>'subscriptionStatus')
      and (not (p_filters ? 'plan') or plan.slug = p_filters->>'plan')
      and (not coalesce((p_filters->>'hasFailedTranslation')::boolean, false) or coalesce(videos.failed_translations, 0) > 0)
  )
  select count(*) into v_total from user_rows;

  with user_rows as (
    select p.id, p.display_name, p.email, au.phone, au.created_at, au.last_sign_in_at,
      p.account_status, p.acquisition_source,
      s.status::text as subscription_status, plan.name_fa as plan_name_fa, s.ends_at,
      case when s.ends_at is null then null else greatest(ceil(extract(epoch from (s.ends_at - now())) / 86400.0), 0)::integer end as remaining_days,
      (select max(event.occurred_at) from public.product_events event where event.user_id = p.id) as last_activity_at,
      (select count(distinct session.video_id) from public.video_playback_sessions session where session.user_id = p.id)::integer as watched_videos,
      (select floor(coalesce(sum(session.watched_seconds), 0)) from public.video_playback_sessions session where session.user_id = p.id)::bigint as watch_seconds,
      (select count(*) from public.videos video where video.user_id = p.id)::integer as uploaded_videos,
      (select count(*) from public.videos video where video.user_id = p.id and video.status = 'completed')::integer as completed_translations,
      (select count(*) from public.videos video where video.user_id = p.id and video.status = 'failed')::integer as failed_translations
    from public.profiles p
    join auth.users au on au.id = p.id
    left join lateral (select sub.* from public.subscriptions sub where sub.user_id = p.id order by sub.created_at desc limit 1) s on true
    left join public.plans plan on plan.id = s.plan_id
    where (v_search = '' or lower(coalesce(p.display_name, '')) like '%' || v_search || '%' or lower(p.email) like '%' || v_search || '%'
      or lower(coalesce(au.phone, '')) like '%' || v_search || '%' or p.id::text = v_search
      or exists (select 1 from public.subscriptions sx where sx.user_id = p.id and lower(coalesce(sx.payment_reference, '')) = v_search)
      or exists (select 1 from public.videos vx where vx.user_id = p.id and vx.id::text = v_search))
      and (not (p_filters ? 'accountStatus') or p.account_status::text = p_filters->>'accountStatus')
      and (not (p_filters ? 'subscriptionStatus') or coalesce(s.status::text, 'never_subscribed') = p_filters->>'subscriptionStatus')
      and (not (p_filters ? 'plan') or plan.slug = p_filters->>'plan')
      and (not coalesce((p_filters->>'hasFailedTranslation')::boolean, false)
        or exists (select 1 from public.videos failed where failed.user_id = p.id and failed.status = 'failed'))
    order by au.created_at desc
    offset (v_page - 1) * v_per_page limit v_per_page
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'displayName', display_name,
    'email', case when v_can_pii then email else regexp_replace(email, '(^.).*(@.*$)', '\\1…\\2') end,
    'phone', case when v_can_pii then phone else case when phone is null then null else '••••' || right(phone, 4) end end,
    'createdAt', created_at, 'lastSignInAt', last_sign_in_at, 'lastActivityAt', last_activity_at,
    'accountStatus', account_status, 'acquisitionSource', acquisition_source,
    'subscriptionStatus', subscription_status, 'planNameFa', plan_name_fa,
    'subscriptionEndsAt', ends_at, 'remainingDays', remaining_days,
    'watchedVideos', watched_videos, 'watchSeconds', watch_seconds,
    'uploadedVideos', uploaded_videos, 'completedTranslations', completed_translations,
    'failedTranslations', failed_translations
  ) order by created_at desc), '[]'::jsonb) into v_items from user_rows;

  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per_page,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per_page)::integer, 1));
end;
$$;

create or replace function public.admin_get_user_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_user jsonb;
begin
  perform public.admin_require_permission('users.read');

  select jsonb_build_object(
    'id', p.id, 'displayName', p.display_name, 'email', p.email, 'phone', au.phone,
    'createdAt', au.created_at, 'lastSignInAt', au.last_sign_in_at,
    'lastActivityAt', (select max(e.occurred_at) from public.product_events e where e.user_id = p.id),
    'accountStatus', p.account_status, 'acquisitionSource', p.acquisition_source,
    'referrer', p.acquisition_data->>'referrer', 'campaign', p.acquisition_data->>'campaign',
    'subscriptionStatus', s.status, 'planNameFa', plan.name_fa, 'subscriptionEndsAt', s.ends_at,
    'remainingDays', case when s.ends_at is null then null else greatest(ceil(extract(epoch from (s.ends_at - now())) / 86400.0), 0)::integer end,
    'watchedVideos', (select count(distinct ps.video_id) from public.video_playback_sessions ps where ps.user_id = p.id),
    'watchSeconds', (select floor(coalesce(sum(ps.watched_seconds), 0)) from public.video_playback_sessions ps where ps.user_id = p.id),
    'uploadedVideos', (select count(*) from public.videos v where v.user_id = p.id),
    'completedTranslations', (select count(*) from public.videos v where v.user_id = p.id and v.status = 'completed'),
    'failedTranslations', (select count(*) from public.videos v where v.user_id = p.id and v.status = 'failed'),
    'lifetimePaymentAmount', (select coalesce(sum(pr.amount - pr.discount_amount), 0) from public.payment_records pr where pr.user_id = p.id and pr.status = 'succeeded'),
    'paymentCurrency', (select pr.currency from public.payment_records pr where pr.user_id = p.id and pr.status = 'succeeded' order by pr.created_at desc limit 1)
  ) into v_user
  from public.profiles p
  join auth.users au on au.id = p.id
  left join lateral (select sx.* from public.subscriptions sx where sx.user_id = p.id order by sx.created_at desc limit 1) s on true
  left join public.plans plan on plan.id = s.plan_id
  where p.id = p_user_id;

  if v_user is null then raise exception 'ADMIN_USER_NOT_FOUND' using errcode = 'P0002'; end if;

  return jsonb_build_object(
    'user', v_user,
    'subscriptionTimeline', coalesce((select jsonb_agg(jsonb_build_object(
      'id', a.id, 'subscriptionId', a.subscription_id, 'userId', a.user_id,
      'adjustmentType', a.adjustment_type, 'daysDelta', a.days_delta,
      'previousEndsAt', a.previous_ends_at, 'newEndsAt', a.new_ends_at,
      'reason', a.reason, 'actorUserId', a.actor_user_id, 'actorRole', a.actor_role,
      'requestId', a.request_id, 'createdAt', a.created_at
    ) order by a.created_at desc) from public.subscription_adjustments a where a.user_id = p_user_id), '[]'::jsonb),
    'activity', coalesce((select jsonb_agg(row_data order by occurred_at desc) from (
      select e.occurred_at, jsonb_build_object('id', e.id, 'eventName', e.event_name,
        'occurredAt', e.occurred_at, 'videoId', e.video_id, 'processingJobId', e.processing_job_id,
        'properties', e.properties - array['email','phone','question','answer','transcript']) as row_data
      from public.product_events e where e.user_id = p_user_id order by e.occurred_at desc limit 100
    ) activity_rows), '[]'::jsonb),
    'videos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', v.id, 'kind', 'user', 'userId', v.user_id, 'ownerName', null,
      'title', coalesce(v.title, v.original_filename), 'sourceType', v.source_type,
      'category', null, 'status', v.status, 'isPublished', null, 'isFeatured', null,
      'durationSeconds', v.duration_seconds, 'createdAt', v.created_at, 'updatedAt', v.updated_at,
      'starts', (select count(*) from public.product_events e where e.video_id = v.id::text and e.event_name = 'video_started'),
      'completionRate', null, 'averageWatchSeconds', null
    ) order by v.created_at desc) from public.videos v where v.user_id = p_user_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_list_subscriptions(
  p_search text default null, p_status text default null,
  p_page integer default 1, p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  perform public.admin_require_permission('subscriptions.read');
  select count(*) into v_total from public.subscriptions s join public.profiles p on p.id = s.user_id
  where (p_status is null or s.status::text = p_status)
    and (coalesce(btrim(p_search), '') = '' or lower(p.email) like '%' || lower(btrim(p_search)) || '%'
      or lower(coalesce(p.display_name, '')) like '%' || lower(btrim(p_search)) || '%' or s.id::text = btrim(p_search));

  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select s.created_at as sort_at, jsonb_build_object(
      'id', s.id, 'userId', s.user_id, 'displayName', p.display_name, 'email', p.email,
      'planId', plan.id, 'planNameFa', plan.name_fa, 'planSlug', plan.slug, 'status', s.status,
      'startsAt', s.starts_at, 'endsAt', s.ends_at,
      'remainingDays', case when s.ends_at is null then null else greatest(ceil(extract(epoch from (s.ends_at - now())) / 86400.0), 0)::integer end,
      'includedMinutes', s.included_minutes, 'usedMinutes', s.used_minutes,
      'paymentReference', s.payment_reference,
      'lastModificationSource', case when exists (select 1 from public.subscription_adjustments a where a.subscription_id = s.id) then 'admin' else 'system' end,
      'updatedAt', s.updated_at
    ) as row_json
    from public.subscriptions s join public.profiles p on p.id = s.user_id join public.plans plan on plan.id = s.plan_id
    where (p_status is null or s.status::text = p_status)
      and (coalesce(btrim(p_search), '') = '' or lower(p.email) like '%' || lower(btrim(p_search)) || '%'
        or lower(coalesce(p.display_name, '')) like '%' || lower(btrim(p_search)) || '%' or s.id::text = btrim(p_search))
    order by s.created_at desc offset (v_page - 1) * v_per limit v_per
  ) rows;
  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per)::integer, 1));
end;
$$;

create or replace function public.admin_list_payments(
  p_status text default null, p_page integer default 1, p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  perform public.admin_require_permission('payments.read');
  select count(*) into v_total from public.payment_records where p_status is null or status::text = p_status;
  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select pr.created_at as sort_at, jsonb_build_object(
      'id', pr.id, 'userId', pr.user_id, 'displayName', p.display_name, 'email', p.email,
      'subscriptionId', pr.subscription_id, 'provider', pr.provider,
      'providerReference', pr.provider_reference, 'status', pr.status,
      'amount', pr.amount, 'currency', pr.currency, 'discountAmount', pr.discount_amount,
      'createdAt', pr.created_at, 'settledAt', pr.settled_at, 'failureCode', pr.failure_code
    ) as row_json from public.payment_records pr join public.profiles p on p.id = pr.user_id
    where p_status is null or pr.status::text = p_status
    order by pr.created_at desc offset (v_page - 1) * v_per limit v_per
  ) rows;
  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per)::integer, 1));
end;
$$;

create or replace function public.admin_list_translation_jobs(
  p_status text default null, p_long_running boolean default false,
  p_page integer default 1, p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  perform public.admin_require_permission('jobs.read');
  select count(*) into v_total from public.video_jobs j
  where (p_status is null or j.status::text = p_status)
    and (not p_long_running or (j.status = 'running' and j.started_at < now() - interval '20 minutes'));
  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select j.created_at as sort_at, jsonb_build_object(
      'id', j.id, 'userId', j.user_id, 'userLabel', coalesce(p.display_name, p.email),
      'videoId', j.video_id, 'videoTitle', coalesce(v.title, v.original_filename),
      'inputType', v.source_type, 'provider', j.provider, 'model', j.model,
      'status', j.status, 'stage', j.stage, 'progressPercent', j.progress_percent,
      'createdAt', j.created_at, 'startedAt', j.started_at, 'finishedAt', j.finished_at,
      'processingSeconds', case when j.started_at is null then null else floor(extract(epoch from (coalesce(j.finished_at, now()) - j.started_at))) end,
      'attempt', j.attempt, 'maxAttempts', j.max_attempts, 'failureCode', j.error_code,
      'failureMessage', case when j.error_code is null then null else coalesce(v.failure_message_fa, 'خطای پردازش ثبت شده است.') end,
      'correlationId', j.correlation_id, 'estimatedCost', j.estimated_cost_usd
    ) as row_json from public.video_jobs j join public.videos v on v.id = j.video_id
      join public.profiles p on p.id = j.user_id
    where (p_status is null or j.status::text = p_status)
      and (not p_long_running or (j.status = 'running' and j.started_at < now() - interval '20 minutes'))
    order by j.created_at desc offset (v_page - 1) * v_per limit v_per
  ) rows;
  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per)::integer, 1));
end;
$$;

create or replace function public.admin_list_videos(
  p_kind text default 'all', p_status text default null,
  p_page integer default 1, p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  perform public.admin_require_permission('videos.read');
  with rows as (
    select v.id::text as id, 'user'::text as kind, v.user_id, p.display_name as owner_name,
      coalesce(v.title, v.original_filename) as title, v.source_type::text as source_type,
      null::text as category, v.status::text as status, null::boolean as is_published,
      null::boolean as is_featured, v.duration_seconds, v.created_at, v.updated_at
    from public.videos v join public.profiles p on p.id = v.user_id
    union all
    select lv.id::text, 'library', null, null, lv.title_fa, 'library', lc.title_fa,
      case when lv.archived_at is not null then 'archived' when lv.is_published then 'published' else 'draft' end,
      lv.is_published, lv.is_featured, lv.duration_seconds, lv.created_at, lv.updated_at
    from public.library_videos lv join public.library_categories lc on lc.id = lv.category_id
  ) select count(*) into v_total from rows
    where (p_kind = 'all' or kind = p_kind) and (p_status is null or status = p_status);

  with rows as (
    select v.id::text as id, 'user'::text as kind, v.user_id, p.display_name as owner_name,
      coalesce(v.title, v.original_filename) as title, v.source_type::text as source_type,
      null::text as category, v.status::text as status, null::boolean as is_published,
      null::boolean as is_featured, v.duration_seconds, v.created_at, v.updated_at
    from public.videos v join public.profiles p on p.id = v.user_id
    union all
    select lv.id::text, 'library', null, null, lv.title_fa, 'library', lc.title_fa,
      case when lv.archived_at is not null then 'archived' when lv.is_published then 'published' else 'draft' end,
      lv.is_published, lv.is_featured, lv.duration_seconds, lv.created_at, lv.updated_at
    from public.library_videos lv join public.library_categories lc on lc.id = lv.category_id
  ), paged as (
    select * from rows where (p_kind = 'all' or kind = p_kind) and (p_status is null or status = p_status)
    order by created_at desc offset (v_page - 1) * v_per limit v_per
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', row.id, 'kind', row.kind, 'userId', row.user_id, 'ownerName', row.owner_name,
    'title', row.title, 'sourceType', row.source_type, 'category', row.category,
    'status', row.status, 'isPublished', row.is_published, 'isFeatured', row.is_featured,
    'durationSeconds', row.duration_seconds, 'createdAt', row.created_at, 'updatedAt', row.updated_at,
    'starts', (select count(*) from public.product_events e where e.video_id = row.id and e.event_name = 'video_started'),
    'completionRate', (select round(100.0 * count(*) filter (where ps.completed) / nullif(count(*), 0), 2) from public.video_playback_sessions ps where ps.video_id = row.id),
    'averageWatchSeconds', (select round(avg(ps.watched_seconds), 2) from public.video_playback_sessions ps where ps.video_id = row.id)
  ) order by row.created_at desc), '[]'::jsonb) into v_items from paged row;
  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per)::integer, 1));
end;
$$;

create or replace function public.admin_list_audit_logs(
  p_search text default null, p_success boolean default null,
  p_page integer default 1, p_per_page integer default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_per integer := least(greatest(coalesce(p_per_page, 25), 1), 100);
  v_total bigint;
  v_items jsonb;
begin
  perform public.admin_require_permission('audit.read');
  select count(*) into v_total from public.admin_audit_logs a where (p_success is null or a.success = p_success)
    and (coalesce(btrim(p_search), '') = '' or lower(a.action_type) like '%' || lower(btrim(p_search)) || '%'
      or lower(coalesce(a.target_entity_id, '')) like '%' || lower(btrim(p_search)) || '%' or a.request_id::text = btrim(p_search));
  select coalesce(jsonb_agg(row_json order by sort_at desc), '[]'::jsonb) into v_items from (
    select a.created_at as sort_at, jsonb_build_object(
      'id', a.id, 'actorUserId', a.actor_user_id, 'actorRole', a.actor_role,
      'actionType', a.action_type, 'targetEntityType', a.target_entity_type,
      'targetEntityId', a.target_entity_id, 'previousValue', a.previous_value,
      'newValue', a.new_value, 'reason', a.reason, 'requestId', a.request_id,
      'userAgent', a.user_agent, 'success', a.success, 'failureCode', a.failure_code,
      'createdAt', a.created_at
    ) as row_json from public.admin_audit_logs a where (p_success is null or a.success = p_success)
      and (coalesce(btrim(p_search), '') = '' or lower(a.action_type) like '%' || lower(btrim(p_search)) || '%'
        or lower(coalesce(a.target_entity_id, '')) like '%' || lower(btrim(p_search)) || '%' or a.request_id::text = btrim(p_search))
    order by a.created_at desc offset (v_page - 1) * v_per limit v_per
  ) rows;
  return jsonb_build_object('items', v_items, 'page', v_page, 'perPage', v_per,
    'total', v_total, 'pageCount', greatest(ceil(v_total::numeric / v_per)::integer, 1));
end;
$$;

create or replace function public.admin_list_team()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_require_permission('team.read');
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object(
    'userId', m.user_id, 'displayName', p.display_name, 'email', p.email,
    'role', m.role, 'status', m.status, 'createdAt', m.created_at, 'invitedBy', m.invited_by,
    'lastAdminActivityAt', (select max(a.created_at) from public.admin_audit_logs a where a.actor_user_id = m.user_id)
  ) order by m.created_at desc) from public.admin_memberships m join public.profiles p on p.id = m.user_id), '[]'::jsonb));
end;
$$;

create or replace function public.admin_metric_snapshot(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'totalUsers', (select count(*) from public.profiles where created_at < p_to),
    'newUsers', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'activeUsers', (select count(distinct user_id) from public.product_events where user_id is not null and occurred_at >= p_from and occurred_at < p_to),
    'paidUsers', (select count(distinct user_id) from public.payment_records where status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'activeSubscriptions', (select count(*) from public.subscriptions where status = 'active' and coalesce(starts_at, created_at) < p_to and (ends_at is null or ends_at >= p_to)),
    'expiredSubscriptions', (select count(*) from public.subscriptions where ends_at >= p_from and ends_at < p_to),
    'revenue', (select coalesce(sum(amount - discount_amount), 0) from public.payment_records where status = 'succeeded' and created_at >= p_from and created_at < p_to),
    'videoStarts', (select count(*) from public.product_events where event_name = 'video_started' and occurred_at >= p_from and occurred_at < p_to),
    'videoCompletions', (select count(*) from public.product_events where event_name = 'video_completed' and occurred_at >= p_from and occurred_at < p_to),
    'watchSeconds', (select coalesce(sum(watched_seconds), 0) from public.video_playback_sessions where started_at >= p_from and started_at < p_to),
    'translationRequests', (select count(*) from public.video_jobs where created_at >= p_from and created_at < p_to),
    'translationSuccesses', (select count(*) from public.video_jobs where status = 'completed' and created_at >= p_from and created_at < p_to),
    'translationFailures', (select count(*) from public.video_jobs where status = 'failed' and created_at >= p_from and created_at < p_to),
    'translationProcessingSeconds', (select avg(extract(epoch from (finished_at - started_at))) from public.video_jobs where finished_at is not null and started_at is not null and created_at >= p_from and created_at < p_to),
    'estimatedCost', (select sum(estimated_cost_usd) from public.video_jobs where created_at >= p_from and created_at < p_to)
  );
$$;

create or replace function public.admin_get_overview(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_current jsonb;
  v_previous jsonb;
  v_previous_from timestamptz;
  v_metrics jsonb;
begin
  perform public.admin_require_permission('overview.read');
  if p_to <= p_from or p_to - p_from > interval '370 days' then
    raise exception 'ADMIN_DATE_RANGE_INVALID' using errcode = 'P0205';
  end if;
  v_previous_from := p_from - (p_to - p_from);
  v_current := public.admin_metric_snapshot(p_from, p_to);
  v_previous := public.admin_metric_snapshot(v_previous_from, p_from);
  v_metrics := jsonb_build_array(
    jsonb_build_object('key','totalUsers','value',v_current->'totalUsers','previous',v_previous->'totalUsers','unit','count'),
    jsonb_build_object('key','newUsers','value',v_current->'newUsers','previous',v_previous->'newUsers','unit','count'),
    jsonb_build_object('key','activeUsers','value',v_current->'activeUsers','previous',v_previous->'activeUsers','unit','count'),
    jsonb_build_object('key','paidUsers','value',v_current->'paidUsers','previous',v_previous->'paidUsers','unit','count'),
    jsonb_build_object('key','activeSubscriptions','value',v_current->'activeSubscriptions','previous',v_previous->'activeSubscriptions','unit','count'),
    jsonb_build_object('key','expiredSubscriptions','value',v_current->'expiredSubscriptions','previous',v_previous->'expiredSubscriptions','unit','count'),
    jsonb_build_object('key','conversionRate','value',round(100.0*(v_current->>'paidUsers')::numeric/nullif((v_current->>'newUsers')::numeric,0),2),'previous',round(100.0*(v_previous->>'paidUsers')::numeric/nullif((v_previous->>'newUsers')::numeric,0),2),'unit','percent'),
    jsonb_build_object('key','revenue','value',v_current->'revenue','previous',v_previous->'revenue','unit','currency','currency','USD'),
    jsonb_build_object('key','videoStarts','value',v_current->'videoStarts','previous',v_previous->'videoStarts','unit','count'),
    jsonb_build_object('key','videoCompletions','value',v_current->'videoCompletions','previous',v_previous->'videoCompletions','unit','count'),
    jsonb_build_object('key','averageWatchTime','value',round((v_current->>'watchSeconds')::numeric/nullif((v_current->>'videoStarts')::numeric,0),2),'previous',round((v_previous->>'watchSeconds')::numeric/nullif((v_previous->>'videoStarts')::numeric,0),2),'unit','seconds'),
    jsonb_build_object('key','translationRequests','value',v_current->'translationRequests','previous',v_previous->'translationRequests','unit','count'),
    jsonb_build_object('key','translationSuccessRate','value',round(100.0*(v_current->>'translationSuccesses')::numeric/nullif((v_current->>'translationRequests')::numeric,0),2),'previous',round(100.0*(v_previous->>'translationSuccesses')::numeric/nullif((v_previous->>'translationRequests')::numeric,0),2),'unit','percent'),
    jsonb_build_object('key','translationFailureRate','value',round(100.0*(v_current->>'translationFailures')::numeric/nullif((v_current->>'translationRequests')::numeric,0),2),'previous',round(100.0*(v_previous->>'translationFailures')::numeric/nullif((v_previous->>'translationRequests')::numeric,0),2),'unit','percent'),
    jsonb_build_object('key','averageProcessingTime','value',v_current->'translationProcessingSeconds','previous',v_previous->'translationProcessingSeconds','unit','seconds'),
    jsonb_build_object('key','estimatedCost','value',v_current->'estimatedCost','previous',v_previous->'estimatedCost','unit','currency','currency','USD')
  );
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'previousFrom', v_previous_from, 'previousTo', p_from,
    'metrics', v_metrics,
    'series', coalesce((select jsonb_agg(jsonb_build_object(
      'date', day::date,
      'newUsers', (select count(*) from public.profiles p where p.created_at >= day and p.created_at < day + interval '1 day'),
      'activeUsers', (select count(distinct e.user_id) from public.product_events e where e.user_id is not null and e.occurred_at >= day and e.occurred_at < day + interval '1 day'),
      'revenue', (select coalesce(sum(pr.amount - pr.discount_amount),0) from public.payment_records pr where pr.status='succeeded' and pr.created_at >= day and pr.created_at < day + interval '1 day'),
      'videoStarts', (select count(*) from public.product_events e where e.event_name='video_started' and e.occurred_at >= day and e.occurred_at < day + interval '1 day'),
      'videoCompletions', (select count(*) from public.product_events e where e.event_name='video_completed' and e.occurred_at >= day and e.occurred_at < day + interval '1 day'),
      'translationRequests', (select count(*) from public.video_jobs j where j.created_at >= day and j.created_at < day + interval '1 day'),
      'translationFailures', (select count(*) from public.video_jobs j where j.status='failed' and j.created_at >= day and j.created_at < day + interval '1 day')
    ) order by day) from generate_series(date_trunc('day', p_from), p_to - interval '1 second', interval '1 day') day), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'severity',severity,'startedAt',started_at) order by started_at desc) from public.admin_incidents where status <> 'resolved'), '[]'::jsonb),
    'recentAudit', case when public.admin_has_permission('audit.read') then coalesce((select jsonb_agg(row_data order by created_at desc) from (
      select created_at, jsonb_build_object('id',id,'actorUserId',actor_user_id,'actorRole',actor_role,
        'actionType',action_type,'targetEntityType',target_entity_type,'targetEntityId',target_entity_id,
        'previousValue',null,'newValue',null,'reason',reason,'requestId',request_id,'userAgent',null,
        'success',success,'failureCode',failure_code,'createdAt',created_at) row_data
      from public.admin_audit_logs order by created_at desc limit 8
    ) recent), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function public.admin_get_video_analytics(
  p_video_id text default null, p_from timestamptz default now() - interval '30 days', p_to timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_sessions bigint;
  v_result jsonb;
begin
  perform public.admin_require_permission('analytics.read');
  if p_to <= p_from or p_to - p_from > interval '370 days' then raise exception 'ADMIN_DATE_RANGE_INVALID'; end if;
  select count(*) into v_sessions from public.video_playback_sessions s
    where s.started_at >= p_from and s.started_at < p_to and (p_video_id is null or s.video_id = p_video_id);
  with buckets as (select generate_series(0,100,5) as bucket), retention as (
    select b.bucket, count(s.id) filter (where s.max_progress_percent >= b.bucket) as sessions
    from buckets b left join public.video_playback_sessions s on s.started_at >= p_from and s.started_at < p_to
      and (p_video_id is null or s.video_id = p_video_id) group by b.bucket order by b.bucket
  ), points as (
    select bucket, sessions, round(100.0 * sessions / nullif(v_sessions,0),2) as retention_percent from retention
  ), drops as (
    select bucket, lag(retention_percent) over (order by bucket) - retention_percent as drop_value from points
  )
  select jsonb_build_object(
    'videoId', p_video_id, 'validSessions', v_sessions,
    'starts', (select count(*) from public.product_events e where e.event_name='video_started' and e.occurred_at>=p_from and e.occurred_at<p_to and (p_video_id is null or e.video_id=p_video_id)),
    'uniqueViewers', (select count(distinct coalesce(s.user_id::text, s.anonymous_id::text)) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'totalWatchSeconds', (select floor(coalesce(sum(s.watched_seconds),0)) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'averageWatchSeconds', (select round(avg(s.watched_seconds),2) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'medianWatchSeconds', (select round(percentile_cont(0.5) within group(order by s.watched_seconds)::numeric,2) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'completionRate', (select round(100.0*count(*) filter(where s.completed)/nullif(count(*),0),2) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'rewatchRate', (select round(100.0*count(*) filter(where views>1)/nullif(count(*),0),2) from (select coalesce(s.user_id::text,s.anonymous_id::text) viewer,count(*) views from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id) group by viewer) viewers),
    'subtitleActivationRate', (select round(100.0*count(*) filter(where s.subtitle_activated)/nullif(count(*),0),2) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'summaryOpenRate', (select round(100.0*count(*) filter(where s.summary_opened)/nullif(count(*),0),2) from public.video_playback_sessions s where s.started_at>=p_from and s.started_at<p_to and (p_video_id is null or s.video_id=p_video_id)),
    'largestDropoffBucket', (select bucket from drops where drop_value is not null order by drop_value desc limit 1),
    'retention', coalesce((select jsonb_agg(jsonb_build_object('bucket',bucket,'sessions',sessions,'retentionPercent',retention_percent) order by bucket) from points),'[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.admin_get_funnel(
  p_name text, p_from timestamptz, p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_steps jsonb;
  v_first numeric;
begin
  perform public.admin_require_permission('analytics.read');
  if p_name not in ('acquisition','activation','upload','subscription') then raise exception 'ADMIN_FUNNEL_INVALID'; end if;
  with definitions as (
    select * from (values
      ('acquisition',1,'landing_viewed','بازدید صفحه اصلی'),('acquisition',2,'library_viewed','بازدید کتابخانه'),
      ('acquisition',3,'video_card_clicked','انتخاب ویدئو'),('acquisition',4,'auth_opened','شروع ورود یا ثبت‌نام'),
      ('acquisition',5,'user_signed_up','تکمیل ثبت‌نام'),
      ('activation',1,'user_signed_up','تکمیل ثبت‌نام'),('activation',2,'library_viewed','اولین بازدید کتابخانه'),
      ('activation',3,'video_started','اولین شروع ویدئو'),('activation',4,'video_progress','پنج دقیقه تماشای معنادار'),
      ('activation',5,'video_completed','اولین تکمیل ویدئو'),
      ('upload',1,'upload_page_viewed','بازدید افزودن ویدئو'),('upload',2,'video_upload_started','انتخاب فایل یا ارسال لینک'),
      ('upload',3,'translation_requested','درخواست ترجمه'),('upload',4,'video_upload_completed','پذیرش ورودی'),
      ('upload',5,'translation_completed','تکمیل ترجمه'),('upload',6,'video_detail_viewed','باز کردن نتیجه'),
      ('subscription',1,'pricing_viewed','مشاهده پلن‌ها'),('subscription',2,'plan_selected','انتخاب پلن'),
      ('subscription',3,'checkout_started','شروع پرداخت'),('subscription',4,'payment_succeeded','پرداخت موفق'),
      ('subscription',5,'video_started','اولین فعالیت اشتراکی')
    ) d(funnel_name, position, event_name, label_fa) where funnel_name = p_name
  ), counts as (
    select d.*, count(distinct coalesce(e.user_id::text,e.anonymous_id::text)) as users
    from definitions d left join public.product_events e on e.event_name=d.event_name and e.occurred_at>=p_from and e.occurred_at<p_to
    group by d.funnel_name,d.position,d.event_name,d.label_fa
  ), enriched as (
    select *, lag(users) over(order by position) previous_users, first_value(users) over(order by position) first_users
    from counts
  )
  select jsonb_agg(jsonb_build_object(
    'key',event_name,'labelFa',label_fa,'users',users,
    'stepConversion',case when previous_users is null then 100 else round(100.0*users/nullif(previous_users,0),2) end,
    'totalConversion',round(100.0*users/nullif(first_users,0),2),
    'dropoff',case when previous_users is null then 0 else greatest(previous_users-users,0) end,
    'medianSecondsToNext',null
  ) order by position) into v_steps from enriched;
  return jsonb_build_object('name',p_name,'identityDefinition','کاربر واردشده یا شناسه ناشناس یکتا در بازه انتخابی','steps',coalesce(v_steps,'[]'::jsonb));
end;
$$;

create or replace function public.admin_get_system_health(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  perform public.admin_require_permission('system.read');
  return jsonb_build_object(
    'queueDepth',(select count(*) from public.video_jobs where status='queued'),
    'oldestQueuedAt',(select min(created_at) from public.video_jobs where status='queued'),
    'runningJobs',(select count(*) from public.video_jobs where status='running'),
    'failedJobs',(select count(*) from public.video_jobs where status='failed' and created_at>=p_from and created_at<p_to),
    'translationFailureRate',(select round(100.0*count(*) filter(where status='failed')/nullif(count(*),0),2) from public.video_jobs where created_at>=p_from and created_at<p_to),
    'averageProcessingSeconds',(select round(avg(extract(epoch from (finished_at-started_at)))::numeric,2) from public.video_jobs where started_at is not null and finished_at is not null and created_at>=p_from and created_at<p_to),
    'providerFailures',coalesce((select jsonb_agg(jsonb_build_object('provider',provider_name,'failed',failed,'total',total)) from (
      select coalesce(provider,'self-hosted') provider_name,count(*) filter(where status='failed') failed,count(*) total
      from public.video_jobs where created_at>=p_from and created_at<p_to group by provider_name
    ) providers),'[]'::jsonb),
    'incidents',coalesce((select jsonb_agg(jsonb_build_object('id',id,'title',title,'status',status,'severity',severity,'startedAt',started_at) order by started_at desc) from public.admin_incidents where status<>'resolved'),'[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_adjust_subscription_days(
  p_user_id uuid, p_days integer, p_reason text, p_request_id uuid, p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.admin_role;
  v_subscription public.subscriptions;
  v_plan public.plans;
  v_previous jsonb;
  v_new jsonb;
  v_audit_id uuid;
  v_existing public.admin_audit_logs;
  v_type text;
begin
  v_role := public.admin_require_permission(case when p_days < 0 then 'subscriptions.days.remove' else 'subscriptions.days.add' end);
  select * into v_existing from public.admin_audit_logs where actor_user_id=auth.uid() and action_type='subscription.days.adjust' and request_id=p_request_id;
  if v_existing.id is not null then
    return jsonb_build_object('ok',v_existing.success,'code',coalesce(v_existing.failure_code,'OK'),
      'messageFa',case when v_existing.success then 'این درخواست قبلاً با موفقیت انجام شده است.' else 'این درخواست قبلاً ناموفق ثبت شده است.' end,
      'auditId',v_existing.id,'entity',v_existing.new_value);
  end if;
  if p_request_id is null or length(btrim(coalesce(p_reason,''))) < 5 or p_days=0 or abs(p_days)>366 then
    v_audit_id:=public.admin_write_audit(v_role,'subscription.days.adjust','user',p_user_id::text,null,null,
      coalesce(nullif(btrim(p_reason),''),'دلیل معتبر وارد نشده است'),coalesce(p_request_id,gen_random_uuid()),p_user_agent,false,'INVALID_INPUT');
    return jsonb_build_object('ok',false,'code','INVALID_INPUT','messageFa','تعداد روز یا دلیل تغییر معتبر نیست.','auditId',v_audit_id);
  end if;
  if v_role='support' and (p_days<1 or p_days>7) then
    v_audit_id:=public.admin_write_audit(v_role,'subscription.days.adjust','user',p_user_id::text,null,null,p_reason,p_request_id,p_user_agent,false,'SUPPORT_LIMIT_EXCEEDED');
    return jsonb_build_object('ok',false,'code','SUPPORT_LIMIT_EXCEEDED','messageFa','پشتیبانی فقط می‌تواند حداکثر ۷ روز جبران اضافه کند.','auditId',v_audit_id);
  end if;

  begin
    perform 1 from public.profiles where id=p_user_id for update;
    if not found then raise exception 'USER_NOT_FOUND'; end if;
    select * into v_subscription from public.subscriptions where user_id=p_user_id order by created_at desc limit 1 for update;
    if v_subscription.id is null then
      if p_days<0 then raise exception 'ACTIVE_SUBSCRIPTION_REQUIRED'; end if;
      select * into v_plan from public.plans where is_active order by case when slug='free' then 0 else 1 end,sort_order limit 1;
      if v_plan.id is null then raise exception 'PLAN_REQUIRED'; end if;
      insert into public.subscriptions(user_id,plan_id,status,starts_at,ends_at,included_minutes,used_minutes)
      values(p_user_id,v_plan.id,'active',now(),now()+make_interval(days=>p_days),v_plan.included_minutes,0)
      returning * into v_subscription;
      v_previous:=null; v_type:='complimentary_grant';
    else
      v_previous:=jsonb_build_object('subscriptionId',v_subscription.id,'status',v_subscription.status,'endsAt',v_subscription.ends_at,'planId',v_subscription.plan_id);
      update public.subscriptions set status='active',starts_at=coalesce(starts_at,now()),
        ends_at=greatest(coalesce(ends_at,now()),now())+make_interval(days=>p_days)
      where id=v_subscription.id returning * into v_subscription;
      if v_subscription.ends_at<=now() then raise exception 'SUBSCRIPTION_END_INVALID'; end if;
      v_type:=case when p_days>0 then 'add_days' else 'remove_days' end;
    end if;
    v_new:=jsonb_build_object('subscriptionId',v_subscription.id,'status',v_subscription.status,'endsAt',v_subscription.ends_at,'planId',v_subscription.plan_id,'daysDelta',p_days);
    insert into public.subscription_adjustments(subscription_id,user_id,adjustment_type,days_delta,previous_ends_at,new_ends_at,previous_plan_id,new_plan_id,actor_user_id,actor_role,reason,request_id)
    values(v_subscription.id,p_user_id,v_type,p_days,(v_previous->>'endsAt')::timestamptz,v_subscription.ends_at,(v_previous->>'planId')::uuid,v_subscription.plan_id,auth.uid(),v_role,btrim(p_reason),p_request_id);
  exception when others then
    v_audit_id:=public.admin_write_audit(v_role,'subscription.days.adjust','user',p_user_id::text,v_previous,null,p_reason,p_request_id,p_user_agent,false,sqlerrm);
    return jsonb_build_object('ok',false,'code','ADJUSTMENT_FAILED','messageFa','تغییر اشتراک انجام نشد و هیچ تغییر ناقصی ذخیره نشد.','auditId',v_audit_id);
  end;
  v_audit_id:=public.admin_write_audit(v_role,'subscription.days.adjust','user',p_user_id::text,v_previous,v_new,p_reason,p_request_id,p_user_agent,true,null);
  return jsonb_build_object('ok',true,'code','OK','messageFa','تغییر اشتراک با موفقیت ثبت شد.','auditId',v_audit_id,'entity',v_new);
end;
$$;

create or replace function public.admin_retry_translation_job(
  p_job_id uuid, p_reason text, p_request_id uuid, p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.admin_role;
  v_job public.video_jobs;
  v_next public.video_jobs;
  v_audit_id uuid;
  v_existing public.admin_audit_logs;
begin
  v_role:=public.admin_require_permission('jobs.retry');
  select * into v_existing from public.admin_audit_logs where actor_user_id=auth.uid() and action_type='translation_job.retry' and request_id=p_request_id;
  if v_existing.id is not null then return jsonb_build_object('ok',v_existing.success,'code',coalesce(v_existing.failure_code,'OK'),'messageFa','این درخواست قبلاً پردازش شده است.','auditId',v_existing.id,'entity',v_existing.new_value); end if;
  if p_request_id is null or length(btrim(coalesce(p_reason,'')))<5 then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  begin
    select * into v_job from public.video_jobs where id=p_job_id for update;
    if v_job.id is null or v_job.status not in ('failed','cancelled') then raise exception 'JOB_NOT_RETRYABLE'; end if;
    select * into v_next from public.video_jobs where video_id=v_job.video_id and status in ('queued','running') limit 1;
    if v_next.id is null then
      insert into public.video_jobs(video_id,user_id,stage,status,attempt,max_attempts,retryable,provider,model,correlation_id)
      values(v_job.video_id,v_job.user_id,'queued','queued',v_job.attempt+1,greatest(v_job.max_attempts,v_job.attempt+2),true,v_job.provider,v_job.model,coalesce(v_job.correlation_id,gen_random_uuid()))
      returning * into v_next;
      update public.videos set status='queued',failure_code=null,failure_message_fa=null where id=v_job.video_id;
    end if;
  exception when others then
    v_audit_id:=public.admin_write_audit(v_role,'translation_job.retry','video_job',p_job_id::text,to_jsonb(v_job),null,p_reason,p_request_id,p_user_agent,false,sqlerrm);
    return jsonb_build_object('ok',false,'code','RETRY_FAILED','messageFa','درخواست تلاش مجدد ثبت نشد.','auditId',v_audit_id);
  end;
  v_audit_id:=public.admin_write_audit(v_role,'translation_job.retry','video_job',p_job_id::text,to_jsonb(v_job),jsonb_build_object('jobId',v_next.id,'status',v_next.status),p_reason,p_request_id,p_user_agent,true,null);
  return jsonb_build_object('ok',true,'code','OK','messageFa','کار پردازش به‌صورت ایمن در صف قرار گرفت.','auditId',v_audit_id,'entity',jsonb_build_object('jobId',v_next.id));
end;
$$;

create or replace function public.admin_set_library_video_publication(
  p_video_id uuid, p_published boolean, p_reason text, p_request_id uuid, p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.admin_role;
  v_before public.library_videos;
  v_after public.library_videos;
  v_audit_id uuid;
begin
  v_role:=public.admin_require_permission('videos.manage');
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  select * into v_before from public.library_videos where id=p_video_id for update;
  if v_before.id is null then raise exception 'LIBRARY_VIDEO_NOT_FOUND'; end if;
  update public.library_videos set is_published=p_published,
    published_at=case when p_published then coalesce(published_at,now()) else published_at end
  where id=p_video_id returning * into v_after;
  v_audit_id:=public.admin_write_audit(v_role,case when p_published then 'library_video.publish' else 'library_video.unpublish' end,
    'library_video',p_video_id::text,jsonb_build_object('isPublished',v_before.is_published),jsonb_build_object('isPublished',v_after.is_published),p_reason,p_request_id,p_user_agent,true,null);
  return jsonb_build_object('ok',true,'code','OK','messageFa',case when p_published then 'ویدئو منتشر شد.' else 'انتشار ویدئو متوقف شد.' end,'auditId',v_audit_id,'entity',jsonb_build_object('videoId',p_video_id,'isPublished',p_published));
end;
$$;

create or replace function public.admin_set_team_member(
  p_user_id uuid, p_role public.admin_role, p_status public.admin_membership_status,
  p_reason text, p_request_id uuid, p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role public.admin_role;
  v_before public.admin_memberships;
  v_after public.admin_memberships;
  v_audit_id uuid;
begin
  v_actor_role:=public.admin_require_permission('team.manage');
  if length(btrim(coalesce(p_reason,'')))<5 then raise exception 'ADMIN_REASON_REQUIRED'; end if;
  perform 1 from public.profiles where id=p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  select * into v_before from public.admin_memberships where user_id=p_user_id for update;
  if v_before.role='super_admin' and v_before.status='active' and (p_role<>'super_admin' or p_status<>'active')
     and (select count(*) from public.admin_memberships where role='super_admin' and status='active')<=1 then
    v_audit_id:=public.admin_write_audit(v_actor_role,'admin_membership.change','admin_user',p_user_id::text,to_jsonb(v_before),null,p_reason,p_request_id,p_user_agent,false,'LAST_SUPER_ADMIN');
    return jsonb_build_object('ok',false,'code','LAST_SUPER_ADMIN','messageFa','دسترسی آخرین مدیر ارشد را نمی‌توان حذف کرد.','auditId',v_audit_id);
  end if;
  insert into public.admin_memberships(user_id,role,status,invited_by) values(p_user_id,p_role,p_status,auth.uid())
  on conflict(user_id) do update set role=excluded.role,status=excluded.status,updated_at=now()
  returning * into v_after;
  v_audit_id:=public.admin_write_audit(v_actor_role,'admin_membership.change','admin_user',p_user_id::text,to_jsonb(v_before),to_jsonb(v_after),p_reason,p_request_id,p_user_agent,true,null);
  return jsonb_build_object('ok',true,'code','OK','messageFa','دسترسی مدیر به‌روزرسانی شد.','auditId',v_audit_id,'entity',jsonb_build_object('userId',p_user_id,'role',p_role,'status',p_status));
end;
$$;

-- Function privileges: internal helpers stay private; public RPCs are narrowly granted.
revoke all on function public.admin_has_permission(text) from public, anon, authenticated;
revoke all on function public.admin_require_permission(text) from public, anon, authenticated;
revoke all on function public.admin_write_audit(public.admin_role,text,text,text,jsonb,jsonb,text,uuid,text,boolean,text) from public, anon, authenticated;
revoke all on function public.admin_metric_snapshot(timestamptz,timestamptz) from public, anon, authenticated;

revoke all on function public.admin_get_context() from public, anon;
revoke all on function public.admin_list_users(text,jsonb,integer,integer) from public, anon;
revoke all on function public.admin_get_user_detail(uuid) from public, anon;
revoke all on function public.admin_list_subscriptions(text,text,integer,integer) from public, anon;
revoke all on function public.admin_list_payments(text,integer,integer) from public, anon;
revoke all on function public.admin_list_translation_jobs(text,boolean,integer,integer) from public, anon;
revoke all on function public.admin_list_videos(text,text,integer,integer) from public, anon;
revoke all on function public.admin_list_audit_logs(text,boolean,integer,integer) from public, anon;
revoke all on function public.admin_list_team() from public, anon;
revoke all on function public.admin_get_overview(timestamptz,timestamptz) from public, anon;
revoke all on function public.admin_get_video_analytics(text,timestamptz,timestamptz) from public, anon;
revoke all on function public.admin_get_funnel(text,timestamptz,timestamptz) from public, anon;
revoke all on function public.admin_get_system_health(timestamptz,timestamptz) from public, anon;
revoke all on function public.admin_adjust_subscription_days(uuid,integer,text,uuid,text) from public, anon;
revoke all on function public.admin_retry_translation_job(uuid,text,uuid,text) from public, anon;
revoke all on function public.admin_set_library_video_publication(uuid,boolean,text,uuid,text) from public, anon;
revoke all on function public.admin_set_team_member(uuid,public.admin_role,public.admin_membership_status,text,uuid,text) from public, anon;

grant execute on function public.admin_get_context() to authenticated;
grant execute on function public.admin_list_users(text,jsonb,integer,integer) to authenticated;
grant execute on function public.admin_get_user_detail(uuid) to authenticated;
grant execute on function public.admin_list_subscriptions(text,text,integer,integer) to authenticated;
grant execute on function public.admin_list_payments(text,integer,integer) to authenticated;
grant execute on function public.admin_list_translation_jobs(text,boolean,integer,integer) to authenticated;
grant execute on function public.admin_list_videos(text,text,integer,integer) to authenticated;
grant execute on function public.admin_list_audit_logs(text,boolean,integer,integer) to authenticated;
grant execute on function public.admin_list_team() to authenticated;
grant execute on function public.admin_get_overview(timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_get_video_analytics(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_get_funnel(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_get_system_health(timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_adjust_subscription_days(uuid,integer,text,uuid,text) to authenticated;
grant execute on function public.admin_retry_translation_job(uuid,text,uuid,text) to authenticated;
grant execute on function public.admin_set_library_video_publication(uuid,boolean,text,uuid,text) to authenticated;
grant execute on function public.admin_set_team_member(uuid,public.admin_role,public.admin_membership_status,text,uuid,text) to authenticated;

revoke all on function public.record_product_event(uuid,text,timestamptz,uuid,uuid,text,text,text,text,jsonb) from public;
grant execute on function public.record_product_event(uuid,text,timestamptz,uuid,uuid,text,text,text,text,jsonb) to anon, authenticated;

-- Initial super-admin bootstrap is intentionally not exposed as a client RPC.
-- A trusted operator must insert the first membership with service-role/SQL:
-- insert into public.admin_memberships(user_id, role, status) values ('<auth-user-uuid>', 'super_admin', 'active');
