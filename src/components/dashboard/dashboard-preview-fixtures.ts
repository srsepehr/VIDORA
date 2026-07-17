import type { AuthSession } from "../../lib/auth";
import type { SubscriptionSummary } from "../../lib/user-data";
import type { UserVideo } from "../../types/database";

export interface DashboardPreviewVideoMetadata {
  action?: "open" | "continue";
  displayStatusEn: string;
  displayStatusFa: string;
  format: string;
  progressPercent?: number;
  resolution: string;
}

export interface DashboardPreviewVideo extends UserVideo {
  preview: DashboardPreviewVideoMetadata;
}

export interface DashboardPreviewFixture {
  processedCount: number;
  session: AuthSession;
  subscription: SubscriptionSummary;
  videos: DashboardPreviewVideo[];
}

const userId = "00000000-0000-4000-8000-000000000001";

function video(
  input: Pick<UserVideo, "id" | "title" | "status" | "source_type" | "duration_seconds" | "created_at"> & {
    original_filename?: string;
    preview: DashboardPreviewVideoMetadata;
  },
): DashboardPreviewVideo {
  return {
    id: input.id,
    user_id: userId,
    source_type: input.source_type,
    original_filename: input.original_filename || null,
    source_url: input.source_type === "youtube" ? "https://www.youtube.com/watch?v=vidora-preview" : null,
    storage_key: input.source_type === "upload" ? `preview/${input.id}.mp4` : null,
    output_storage_key: input.status === "completed" ? `preview/${input.id}-translated.mp4` : null,
    subtitle_vtt_storage_key: input.status === "completed" ? `preview/${input.id}.vtt` : null,
    subtitle_srt_storage_key: input.status === "completed" ? `preview/${input.id}.srt` : null,
    thumbnail_storage_key: null,
    title: input.title,
    duration_seconds: input.duration_seconds,
    file_size_bytes: 184_000_000,
    mime_type: "video/mp4",
    detected_language: "en",
    status: input.status,
    failure_code: null,
    failure_message_fa: null,
    created_at: input.created_at,
    updated_at: input.created_at,
    completed_at: input.status === "completed" ? input.created_at : null,
    preview: input.preview,
  };
}

export const dashboardPreviewFixture: DashboardPreviewFixture = {
  session: {
    accessToken: "development-preview-no-network",
    refreshToken: "development-preview-no-network",
    expiresAt: 4_102_444_800,
    user: {
      id: userId,
      email: "sepehr.preview@example.com",
      user_metadata: { display_name: "Sepehr" },
    },
  },
  subscription: {
    id: "00000000-0000-4000-8000-000000000010",
    status: "active",
    starts_at: "2026-07-17T00:00:00.000Z",
    included_minutes: 120,
    used_minutes: 35,
    ends_at: "2026-08-17T00:00:00.000Z",
    plans: { name_fa: "پلن حرفه‌ای", slug: "pro" },
  },
  processedCount: 4,
  videos: [
    video({
      id: "00000000-0000-4000-8000-000000000101",
      title: "How AI Agents Work",
      status: "translating",
      source_type: "upload",
      duration_seconds: 1122,
      created_at: "2026-07-17T08:30:00.000Z",
      original_filename: "how-ai-agents-work.mp4",
      preview: {
        action: "open",
        displayStatusFa: "در حال پردازش",
        displayStatusEn: "Processing",
        format: "MP4",
        resolution: "1280×720",
        progressPercent: 68,
      },
    }),
    video({
      id: "00000000-0000-4000-8000-000000000102",
      title: "The Future of AI",
      status: "completed",
      source_type: "youtube",
      duration_seconds: 1335,
      created_at: "2026-07-16T10:15:00.000Z",
      preview: {
        action: "open",
        displayStatusFa: "زیرنویس آماده است",
        displayStatusEn: "Subtitles ready",
        format: "MP4",
        resolution: "1920×1080",
      },
    }),
    video({
      id: "00000000-0000-4000-8000-000000000103",
      title: "Build a SaaS in 30 Days",
      status: "uploaded",
      source_type: "upload",
      duration_seconds: 1008,
      created_at: "2026-07-15T13:40:00.000Z",
      original_filename: "build-a-saas.mp4",
      preview: {
        action: "continue",
        displayStatusFa: "آماده ادامه کار",
        displayStatusEn: "Ready to continue",
        format: "MP4",
        resolution: "1280×720",
      },
    }),
  ],
};
