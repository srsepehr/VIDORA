import { getBrowserEnv, isBackendConfigured } from "./env";

export interface PublicLibraryVideo {
  id: string;
  category_id: string;
  category_slug: string;
  category_title_fa: string;
  title_fa: string;
  description_fa: string;
  thumbnail_url: string;
  duration_seconds: number;
  is_premium: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export async function fetchPublishedLibraryVideos(signal?: AbortSignal): Promise<PublicLibraryVideo[]> {
  if (!isBackendConfigured()) return [];

  const env = getBrowserEnv();
  const select = [
    "id",
    "category_id",
    "category_slug",
    "category_title_fa",
    "title_fa",
    "description_fa",
    "thumbnail_url",
    "duration_seconds",
    "is_premium",
    "sort_order",
    "created_at",
    "updated_at",
  ].join(",");
  const response = await fetch(
    `${env.supabaseUrl}/rest/v1/library_video_metadata?select=${select}&order=sort_order.asc,created_at.desc`,
    {
      signal,
      headers: {
        apikey: env.supabaseAnonKey,
        Authorization: `Bearer ${env.supabaseAnonKey}`,
      },
    },
  );

  if (!response.ok) throw new Error(`Library metadata request failed with ${response.status}`);
  return (await response.json()) as PublicLibraryVideo[];
}
