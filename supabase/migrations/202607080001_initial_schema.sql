-- Vidora phase 1 backend foundation.
-- Apply with: supabase db push

create extension if not exists pgcrypto;

do $$
begin
  create type public.subscription_status as enum ('pending', 'active', 'expired', 'cancelled', 'payment_failed');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.video_source_type as enum ('upload', 'youtube', 'supported_url');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.video_status as enum (
    'created',
    'uploading',
    'uploaded',
    'validating',
    'queued',
    'downloading_source',
    'extracting_audio',
    'transcribing',
    'translating',
    'generating_subtitles',
    'rendering',
    'uploading_result',
    'completed',
    'failed',
    'cancelled'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.video_job_status as enum ('queued', 'running', 'completed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.sync_profile_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', ''), '')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url),
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sync_profile on auth.users;
create trigger on_auth_user_created_sync_profile
after insert on auth.users
for each row execute function public.sync_profile_from_auth_user();

drop trigger if exists on_auth_user_updated_sync_profile on auth.users;
create trigger on_auth_user_updated_sync_profile
after update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_profile_from_auth_user();

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_fa text not null,
  description_fa text not null,
  price numeric(12,2) not null check (price >= 0),
  currency text not null default 'USD',
  billing_period_days integer not null check (billing_period_days > 0),
  included_minutes integer not null check (included_minutes >= 0),
  max_file_size_bytes bigint not null check (max_file_size_bytes > 0),
  max_video_duration_seconds integer not null check (max_video_duration_seconds > 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  status public.subscription_status not null default 'pending',
  starts_at timestamptz,
  ends_at timestamptz,
  included_minutes integer not null default 0 check (included_minutes >= 0),
  used_minutes integer not null default 0 check (used_minutes >= 0),
  payment_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_valid_range check (ends_at is null or starts_at is null or ends_at > starts_at),
  constraint subscriptions_used_within_quota check (used_minutes <= included_minutes)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_type public.video_source_type not null,
  original_filename text,
  source_url text,
  storage_key text,
  output_storage_key text,
  thumbnail_storage_key text,
  title text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  mime_type text,
  status public.video_status not null default 'created',
  failure_code text,
  failure_message_fa text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint videos_upload_requires_file_or_url check (
    (source_type = 'upload' and (storage_key is not null or original_filename is not null))
    or (source_type in ('youtube', 'supported_url') and source_url is not null)
  )
);

create table if not exists public.video_jobs (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  stage public.video_status not null,
  status public.video_job_status not null default 'queued',
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  attempt integer not null default 1 check (attempt > 0),
  provider text,
  provider_job_id text,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint video_jobs_valid_range check (finished_at is null or started_at is null or finished_at >= started_at)
);

create table if not exists public.transcript_segments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  segment_index integer not null check (segment_index >= 0),
  start_ms integer not null check (start_ms >= 0),
  end_ms integer not null check (end_ms >= start_ms),
  source_text text not null,
  translated_text_fa text,
  confidence numeric(5,4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (video_id, segment_index)
);

create table if not exists public.library_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title_fa text not null,
  description_fa text,
  sort_order integer not null default 0,
  is_active boolean not null default true
);

create table if not exists public.library_videos (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.library_categories(id) on delete restrict,
  title_fa text not null,
  description_fa text not null,
  thumbnail_url text not null,
  video_url text,
  subtitle_url text,
  duration_seconds integer not null check (duration_seconds > 0),
  is_premium boolean not null default false,
  is_published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists plans_active_sort_idx on public.plans (is_active, sort_order);
create index if not exists subscriptions_user_status_idx on public.subscriptions (user_id, status);
create index if not exists subscriptions_plan_idx on public.subscriptions (plan_id);
create index if not exists videos_user_created_idx on public.videos (user_id, created_at desc);
create index if not exists videos_user_status_idx on public.videos (user_id, status);
create index if not exists video_jobs_user_created_idx on public.video_jobs (user_id, created_at desc);
create index if not exists video_jobs_video_idx on public.video_jobs (video_id);
create index if not exists transcript_segments_video_idx on public.transcript_segments (video_id, segment_index);
create index if not exists library_categories_active_sort_idx on public.library_categories (is_active, sort_order);
create index if not exists library_videos_category_sort_idx on public.library_videos (category_id, is_published, sort_order);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles for each row execute function public.set_updated_at();

drop trigger if exists plans_set_updated_at on public.plans;
create trigger plans_set_updated_at before update on public.plans for each row execute function public.set_updated_at();

drop trigger if exists subscriptions_set_updated_at on public.subscriptions;
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();

drop trigger if exists videos_set_updated_at on public.videos;
create trigger videos_set_updated_at before update on public.videos for each row execute function public.set_updated_at();

drop trigger if exists video_jobs_set_updated_at on public.video_jobs;
create trigger video_jobs_set_updated_at before update on public.video_jobs for each row execute function public.set_updated_at();

drop trigger if exists transcript_segments_set_updated_at on public.transcript_segments;
create trigger transcript_segments_set_updated_at before update on public.transcript_segments for each row execute function public.set_updated_at();

drop trigger if exists library_videos_set_updated_at on public.library_videos;
create trigger library_videos_set_updated_at before update on public.library_videos for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.videos enable row level security;
alter table public.video_jobs enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.library_categories enable row level security;
alter table public.library_videos enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists plans_public_read_active on public.plans;
create policy plans_public_read_active on public.plans for select to anon, authenticated using (is_active = true);

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

drop policy if exists videos_select_own on public.videos;
create policy videos_select_own on public.videos for select to authenticated using (user_id = auth.uid());

drop policy if exists videos_insert_own_created on public.videos;
create policy videos_insert_own_created on public.videos for insert to authenticated with check (
  user_id = auth.uid()
  and status in ('created', 'uploading')
);

drop policy if exists video_jobs_select_own on public.video_jobs;
create policy video_jobs_select_own on public.video_jobs for select to authenticated using (user_id = auth.uid());

drop policy if exists transcript_segments_select_own on public.transcript_segments;
create policy transcript_segments_select_own on public.transcript_segments for select to authenticated using (
  exists (
    select 1 from public.videos
    where videos.id = transcript_segments.video_id
      and videos.user_id = auth.uid()
  )
);

drop policy if exists library_categories_public_active on public.library_categories;
create policy library_categories_public_active on public.library_categories for select to anon, authenticated using (is_active = true);

-- Direct library_videos reads are intentionally not granted publicly because
-- premium rows may contain media URLs. Public clients should query the view.
drop view if exists public.library_video_metadata;
create view public.library_video_metadata as
select
  lv.id,
  lv.category_id,
  lc.slug as category_slug,
  lc.title_fa as category_title_fa,
  lv.title_fa,
  lv.description_fa,
  lv.thumbnail_url,
  lv.duration_seconds,
  lv.is_premium,
  lv.sort_order,
  lv.created_at,
  lv.updated_at
from public.library_videos lv
join public.library_categories lc on lc.id = lv.category_id
where lv.is_published = true and lc.is_active = true;

revoke all on public.library_videos from anon, authenticated;
grant select on public.library_video_metadata to anon, authenticated;
grant select on public.library_categories to anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert on public.videos to authenticated;
grant select on public.video_jobs to authenticated;
grant select on public.transcript_segments to authenticated;

insert into public.plans (slug, name_fa, description_fa, price, currency, billing_period_days, included_minutes, max_file_size_bytes, max_video_duration_seconds, is_active, sort_order)
values
  ('free', 'رایگان', 'برای شروع و تست Vidora', 0, 'USD', 30, 120, 524288000, 1800, true, 10),
  ('pro', 'حرفه‌ای', 'برای یادگیری و ترجمه منظم ویدیوها', 19, 'USD', 30, 2000, 2147483648, 7200, true, 20),
  ('team', 'تیمی', 'برای تیم‌های آموزشی و محصولی', 49, 'USD', 30, 8000, 5368709120, 14400, true, 30)
on conflict (slug) do update set
  name_fa = excluded.name_fa,
  description_fa = excluded.description_fa,
  price = excluded.price,
  currency = excluded.currency,
  billing_period_days = excluded.billing_period_days,
  included_minutes = excluded.included_minutes,
  max_file_size_bytes = excluded.max_file_size_bytes,
  max_video_duration_seconds = excluded.max_video_duration_seconds,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order;

insert into public.library_categories (slug, title_fa, description_fa, sort_order, is_active)
values
  ('artificial-intelligence', 'هوش مصنوعی', 'ابزارها، پژوهش‌ها، شرکت‌ها و آینده هوش مصنوعی', 10, true),
  ('startups-business', 'استارتاپ و کسب‌وکار', 'محصول‌سازی، قیمت‌گذاری، رشد و تصمیم‌گیری', 20, true),
  ('technology', 'فناوری', 'روندهای تکنولوژی و ابزارهای جدید', 30, true),
  ('product-design', 'طراحی محصول', 'ساخت تجربه کاربری، محصول و سیستم‌های طراحی', 40, true),
  ('company-stories', 'داستان شرکت‌ها', 'روایت شکل‌گیری و رشد شرکت‌های اثرگذار', 50, true),
  ('founders', 'بنیان‌گذاران', 'زندگی و مسیر سازندگان بزرگ', 60, true),
  ('science-future', 'علم و آینده', 'علم، آینده‌پژوهی و تغییرات جهان', 70, true),
  ('language-learning', 'آموزش زبان', 'یادگیری زبان با ویدیوهای واقعی', 80, true)
on conflict (slug) do update set
  title_fa = excluded.title_fa,
  description_fa = excluded.description_fa,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('vidora-video-uploads', 'vidora-video-uploads', false, 5368709120, array['video/mp4', 'video/quicktime', 'video/webm']),
  ('vidora-video-results', 'vidora-video-results', false, 5368709120, array['video/mp4', 'text/vtt', 'application/x-subrip', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_upload_own_video_sources on storage.objects;
create policy storage_upload_own_video_sources on storage.objects for insert to authenticated with check (
  bucket_id = 'vidora-video-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists storage_read_own_video_sources on storage.objects;
create policy storage_read_own_video_sources on storage.objects for select to authenticated using (
  bucket_id = 'vidora-video-uploads'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists storage_read_own_video_results on storage.objects;
create policy storage_read_own_video_results on storage.objects for select to authenticated using (
  bucket_id = 'vidora-video-results'
  and (storage.foldername(name))[1] = auth.uid()::text
);
