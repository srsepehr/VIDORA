// Frontend access to server-generated video insights (Persian summary, key
// takeaways, chapters). The browser only READS rows the worker generated —
// RLS scopes them to the owner via the video relationship, and there is no
// client write path (inserts/updates are service-role RPCs only).
import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";

// MUST match worker/app/insight_config.py — a ready row produced by a
// different schema version is treated as stale (integrity is decided by
// versions + status, never by the browser guessing).
export const INSIGHT_SCHEMA_VERSION = "ins-s1";
export const INSIGHT_LANG = "fa";

export type InsightState = "none" | "generating" | "ready" | "failed" | "stale";

export interface InsightTakeaway {
  text: string;
  segment_indexes: number[];
}

export interface VideoInsight {
  status: string;
  language: string;
  short_summary: string | null;
  detailed_summary: string | null;
  key_takeaways: InsightTakeaway[] | null;
  provider: string | null;
  model: string | null;
  schema_version: string | null;
  source_segment_count: number | null;
  generated_at: string | null;
}

export interface VideoChapter {
  chapter_index: number;
  title: string;
  description: string | null;
  start_ms: number;
  end_ms: number;
  source_segment_indexes: number[] | null;
}

function restHeaders(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function ownedRead<T>(session: AuthSession, path: string, context: string): Promise<T> {
  const env = getBrowserEnv();
  const response = await fetchWithAuth(session, `${env.supabaseUrl}/rest/v1/${path}`, {
    headers: restHeaders(session),
  });
  if (!response.ok) {
    const accessDenied = response.status === 401 || response.status === 403;
    throw new AppError({
      code: accessDenied ? "ACCESS_DENIED" : "DATABASE_ERROR",
      httpStatus: response.status,
      messageFa: accessDenied
        ? "اجازه دسترسی به خلاصه این ویدیو را ندارید."
        : "دریافت خلاصه و فصل‌های ویدیو ناموفق بود.",
      retryable: response.status >= 500,
      logMessage: `${context} read failed with ${response.status}`,
    });
  }
  return (await response.json()) as T;
}

export async function fetchVideoInsight(session: AuthSession, videoId: string): Promise<VideoInsight | null> {
  const select = [
    "status", "language", "short_summary", "detailed_summary", "key_takeaways",
    "provider", "model", "schema_version", "source_segment_count", "generated_at",
  ].join(",");
  const rows = await ownedRead<VideoInsight[]>(
    session,
    `video_insights?video_id=eq.${encodeURIComponent(videoId)}&language=eq.${INSIGHT_LANG}&select=${select}`,
    "Insight",
  );
  return rows[0] || null;
}

export async function fetchVideoChapters(session: AuthSession, videoId: string): Promise<VideoChapter[]> {
  const select = "chapter_index,title,description,start_ms,end_ms,source_segment_indexes";
  return ownedRead<VideoChapter[]>(
    session,
    `video_chapters?video_id=eq.${encodeURIComponent(videoId)}&select=${select}&order=chapter_index.asc`,
    "Chapters",
  );
}

/** Single user-facing state derived from the persisted row. */
export function deriveInsightState(insight: VideoInsight | null): InsightState {
  if (!insight) return "none";
  if (insight.status === "ready") {
    return insight.schema_version === INSIGHT_SCHEMA_VERSION ? "ready" : "stale";
  }
  if (insight.status === "generating") return "generating";
  if (insight.status === "stale") return "stale";
  if (insight.status === "failed") return "failed";
  return "none";
}

export const INSIGHT_STATE_FA: Record<InsightState, string> = {
  none: "خلاصه این ویدیو هنوز ساخته نشده است.",
  generating: "خلاصه و نکات کلیدی در حال آماده‌سازی است.",
  ready: "خلاصه این ویدیو آماده است.",
  failed: "ساخت خلاصه انجام نشد؛ متن و زیرنویس همچنان در دسترس است.",
  stale: "متن ویدیو تغییر کرده و خلاصه باید دوباره ساخته شود.",
};

/** First supporting segment's start time for a takeaway, or null when the
 * takeaway has no real supporting timestamp (then no seek action is shown). */
export function takeawaySeekMs(
  takeaway: InsightTakeaway,
  segments: Array<{ segment_index: number; start_ms: number }>,
): number | null {
  const refs = takeaway.segment_indexes || [];
  for (const index of [...refs].sort((a, b) => a - b)) {
    const segment = segments.find((s) => s.segment_index === index);
    if (segment) return segment.start_ms;
  }
  return null;
}

/** Index of the chapter containing timeMs (chapters are chronological and
 * non-overlapping), or -1. */
export function activeChapterIndex(chapters: VideoChapter[], timeMs: number): number {
  for (let i = 0; i < chapters.length; i += 1) {
    if (timeMs >= chapters[i].start_ms && timeMs < chapters[i].end_ms) return i;
  }
  return -1;
}
