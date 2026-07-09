export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubscriptionStatus = "pending" | "active" | "expired" | "cancelled" | "payment_failed";

export type VideoSourceType = "upload" | "youtube" | "supported_url" | "direct_media_url" | "supported_external_url";

export type VideoStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "validating"
  | "queued"
  | "acquiring_source"
  | "downloading_source"
  | "extracting_audio"
  | "transcribing"
  | "translating"
  | "generating_subtitles"
  | "rendering"
  | "uploading_result"
  | "completed"
  | "failed"
  | "cancelled";

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Plan {
  id: string;
  slug: string;
  name_fa: string;
  description_fa: string | null;
  price: number;
  currency: string;
  billing_period_days: number;
  included_minutes: number;
  max_file_size_bytes: number;
  max_video_duration_seconds: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  starts_at: string | null;
  ends_at: string | null;
  included_minutes: number;
  used_minutes: number;
  payment_reference: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserVideo {
  id: string;
  user_id: string;
  source_type: VideoSourceType;
  original_filename: string | null;
  source_url: string | null;
  storage_key: string | null;
  output_storage_key: string | null;
  subtitle_vtt_storage_key: string | null;
  subtitle_srt_storage_key: string | null;
  thumbnail_storage_key: string | null;
  title: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  detected_language: string | null;
  status: VideoStatus;
  failure_code: string | null;
  failure_message_fa: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface VideoJob {
  id: string;
  video_id: string;
  user_id: string;
  stage: VideoStatus;
  status: JobStatus;
  progress_percent: number;
  progress_current: number | null;
  progress_total: number | null;
  attempt: number;
  max_attempts: number;
  provider: string | null;
  provider_job_id: string | null;
  worker_id: string | null;
  lease_expires_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  error_code: string | null;
  error_message: string | null;
  retryable: boolean;
  created_at: string;
  updated_at: string;
}
