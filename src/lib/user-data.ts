import type { AuthSession } from "./auth";
import { AppError } from "./app-error";
import { getBrowserEnv } from "./env";
import type { SubscriptionStatus, UserVideo, VideoStatus } from "../types/database";

export interface SubscriptionSummary {
  id: string;
  status: SubscriptionStatus;
  included_minutes: number;
  used_minutes: number;
  ends_at: string | null;
  plans?: {
    name_fa: string;
    slug: string;
  } | null;
}

function headers(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function readJson<T>(response: Response, fallbackMessageFa: string): Promise<T> {
  if (!response.ok) {
    throw new AppError({
      code: response.status === 401 || response.status === 403 ? "UNAUTHORIZED" : "DATABASE_FAILURE",
      httpStatus: response.status,
      messageFa: fallbackMessageFa,
      retryable: response.status >= 500,
      logMessage: `PostgREST request failed with ${response.status}`,
    });
  }
  return (await response.json()) as T;
}

export async function fetchUserVideos(session: AuthSession): Promise<UserVideo[]> {
  const env = getBrowserEnv();
  const select = [
    "id",
    "user_id",
    "source_type",
    "original_filename",
    "source_url",
    "storage_key",
    "output_storage_key",
    "thumbnail_storage_key",
    "title",
    "duration_seconds",
    "file_size_bytes",
    "mime_type",
    "status",
    "failure_code",
    "failure_message_fa",
    "created_at",
    "updated_at",
    "completed_at",
  ].join(",");
  const url = `${env.supabaseUrl}/rest/v1/videos?select=${select}&order=created_at.desc&limit=50`;
  const response = await fetch(url, { headers: headers(session) });
  return readJson<UserVideo[]>(response, "دریافت ویدیوهای شما با خطا مواجه شد.");
}

export async function fetchActiveSubscription(session: AuthSession): Promise<SubscriptionSummary | null> {
  const env = getBrowserEnv();
  const url = `${env.supabaseUrl}/rest/v1/subscriptions?select=id,status,included_minutes,used_minutes,ends_at,plans(name_fa,slug)&status=eq.active&order=created_at.desc&limit=1`;
  const response = await fetch(url, { headers: headers(session) });
  const rows = await readJson<SubscriptionSummary[]>(response, "دریافت وضعیت اشتراک با خطا مواجه شد.");
  return rows[0] || null;
}

export function normalizeVideoStatus(status: VideoStatus): "Ready" | "Processing" | "Failed" {
  if (status === "completed") return "Ready";
  if (status === "failed" || status === "cancelled") return "Failed";
  return "Processing";
}
