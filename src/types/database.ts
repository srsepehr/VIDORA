export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type SubscriptionStatus = "pending" | "active" | "expired" | "cancelled" | "payment_failed";

export type VideoSourceType = "upload" | "youtube" | "supported_url";

export type VideoStatus =
  | "created"
  | "uploading"
  | "uploaded"
  | "validating"
  | "queued"
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
  thumbnail_storage_key: string | null;
  title: string | null;
  duration_seconds: number | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  status: VideoStatus;
  failure_code: string | null;
  failure_message_fa: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}
