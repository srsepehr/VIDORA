// Frontend access to the per-video Living Note. The browser READS its own note
// rows (RLS scopes them to the owner via user_id = auth.uid()). All writes go
// through SECURITY DEFINER RPCs that re-resolve the caller from auth.uid():
// personal-text autosave and save/remove of pinned chat answers are user-authored
// and go through authenticated RPCs; the AI overview/key-points/action-items are
// privileged and are generated only via the Supabase Edge gateway -> private
// Modal note endpoint -> server-side persistence (never a direct browser->Modal
// call, and no server secret ever reaches this code).
import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";

// MUST match worker/app/note_config.py — a ready AI note produced by a different
// schema version is treated as stale (integrity is decided by version + status).
export const NOTE_SCHEMA_VERSION = "note-s1";

export const VIDEO_NOTE_URL = (import.meta.env?.VITE_VIDEO_NOTE_URL as string | undefined)
  || "https://kvqrkphoyuoblfonjcvo.supabase.co/functions/v1/video-note";

export type NoteAiState = "none" | "generating" | "ready" | "failed" | "stale";

export interface NoteCitation {
  start_ms: number;
  end_ms: number;
  source_segment_indexes: number[];
}

export interface NoteItem {
  text: string;
  citations: NoteCitation[];
}

export interface VideoNote {
  personal_text: string;
  personal_updated_at: string | null;
  ai_status: string;
  ai_overview: string | null;
  ai_key_points: NoteItem[] | null;
  ai_action_items: NoteItem[] | null;
  ai_schema_version: string | null;
  ai_generated_at: string | null;
  ai_error_code: string | null;
}

export interface SavedAnswer {
  id: string;
  message_id: string;
  question: string;
  answer: string;
  not_in_video: boolean;
  citations: NoteCitation[];
  created_at: string;
}

function restHeaders(session: AuthSession, extra: Record<string, string> = {}): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    ...extra,
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
      messageFa: accessDenied ? "اجازه دسترسی به یادداشت این ویدیو را ندارید." : "دریافت یادداشت این ویدیو ناموفق بود.",
      retryable: response.status >= 500,
      logMessage: `${context} read failed with ${response.status}`,
    });
  }
  return (await response.json()) as T;
}

async function callRpc<T>(session: AuthSession, fn: string, params: Record<string, unknown>,
                          context: string, fallbackFa: string): Promise<T> {
  const env = getBrowserEnv();
  const response = await fetchWithAuth(session, `${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: restHeaders(session),
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const accessDenied = response.status === 401 || response.status === 403;
    throw new AppError({
      code: accessDenied ? "ACCESS_DENIED" : "DATABASE_ERROR",
      httpStatus: response.status,
      messageFa: accessDenied ? "اجازه انجام این تغییر را ندارید." : fallbackFa,
      retryable: response.status >= 500,
      logMessage: `${context} rpc failed with ${response.status}`,
    });
  }
  return (await response.json().catch(() => null)) as T;
}

export async function fetchVideoNote(session: AuthSession, videoId: string): Promise<VideoNote | null> {
  const select = [
    "personal_text", "personal_updated_at", "ai_status", "ai_overview",
    "ai_key_points", "ai_action_items", "ai_schema_version", "ai_generated_at", "ai_error_code",
  ].join(",");
  const rows = await ownedRead<VideoNote[]>(
    session,
    `video_notes?video_id=eq.${encodeURIComponent(videoId)}&select=${select}&limit=1`,
    "Note",
  );
  return rows[0] || null;
}

export async function fetchSavedAnswers(session: AuthSession, videoId: string): Promise<SavedAnswer[]> {
  const select = "id,message_id,question,answer,not_in_video,citations,created_at";
  return ownedRead<SavedAnswer[]>(
    session,
    `video_note_saved_answers?video_id=eq.${encodeURIComponent(videoId)}&select=${select}&order=created_at.asc`,
    "SavedAnswers",
  );
}

export async function saveNotePersonalText(session: AuthSession, videoId: string, text: string): Promise<void> {
  await callRpc(session, "upsert_video_note_personal",
    { p_video_id: videoId, p_personal_text: text },
    "saveNotePersonalText", "ذخیره یادداشت شخصی ناموفق بود.");
}

export async function saveChatAnswerToNote(session: AuthSession, videoId: string, messageId: string): Promise<void> {
  await callRpc(session, "save_video_note_answer",
    { p_video_id: videoId, p_message_id: messageId },
    "saveChatAnswerToNote", "افزودن این پاسخ به یادداشت ناموفق بود.");
}

export async function removeSavedAnswer(session: AuthSession, savedId: string): Promise<void> {
  await callRpc(session, "remove_video_note_answer",
    { p_saved_id: savedId },
    "removeSavedAnswer", "حذف این پاسخ از یادداشت ناموفق بود.");
}

const NOTE_ERROR_FA: Record<string, string> = {
  NOTE_AUTH_REQUIRED: "برای ساخت یادداشت هوشمند ابتدا وارد حساب شوید.",
  NOTE_ACCESS_DENIED: "اجازه دسترسی به یادداشت این ویدیو را ندارید.",
  NOTE_INSIGHT_MISSING: "برای ساخت یادداشت هوشمند ابتدا باید خلاصه ویدیو آماده شود.",
  NOTE_TRANSCRIPT_MISSING: "متن این ویدیو برای ساخت یادداشت یافت نشد.",
  NOTE_NO_SOURCE_MATERIAL: "هنوز محتوایی برای ساخت یادداشت هوشمند وجود ندارد.",
  NOTE_RATE_LIMITED: "کمی صبر کنید و دوباره برای ساخت یادداشت تلاش کنید.",
  NOTE_PROVIDER_UNAVAILABLE: "سرویس ساخت یادداشت موقتاً در دسترس نیست.",
  NOTE_INVALID_OUTPUT: "یادداشت معتبری ساخته نشد. دوباره تلاش کنید.",
  NOTE_GROUNDING_FAILED: "یادداشت قابل استناد ساخته نشد. دوباره تلاش کنید.",
};

export async function generateVideoNote(session: AuthSession, videoId: string, force: boolean): Promise<{ status: string }> {
  const response = await fetchWithAuth(session, VIDEO_NOTE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: JSON.stringify({ video_id: videoId, force }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code || "NOTE_PROVIDER_UNAVAILABLE";
    console.error(`[Vidora] videoNoteFailure status=${response.status} code=${code}`);
    throw new AppError({
      code, httpStatus: response.status,
      messageFa: payload?.error?.message_fa || NOTE_ERROR_FA[code] || "ساخت یادداشت هوشمند ناموفق بود.",
      retryable: response.status >= 500 || response.status === 429,
      logMessage: `video note request failed ${response.status} ${code}`,
    });
  }
  return payload as { status: string };
}

/** Single user-facing AI state derived from the persisted row. */
export function deriveNoteAiState(note: VideoNote | null): NoteAiState {
  if (!note) return "none";
  if (note.ai_status === "ready") {
    return note.ai_schema_version === NOTE_SCHEMA_VERSION ? "ready" : "stale";
  }
  if (note.ai_status === "generating") return "generating";
  if (note.ai_status === "stale") return "stale";
  if (note.ai_status === "failed") return "failed";
  return "none";
}

export const NOTE_AI_STATE_FA: Record<NoteAiState, string> = {
  none: "هنوز یادداشت هوشمندی ساخته نشده است.",
  generating: "یادداشت هوشمند در حال آماده‌سازی است.",
  ready: "یادداشت هوشمند آماده است.",
  failed: "ساخت یادداشت هوشمند انجام نشد. یادداشت شخصی و پاسخ‌های ذخیره‌شده در دسترس‌اند.",
  stale: "محتوای ویدیو تغییر کرده و یادداشت هوشمند باید دوباره ساخته شود.",
};

/** First citation start time for a note item, or null when it has no citation. */
export function noteItemSeekMs(item: NoteItem): number | null {
  const first = (item.citations || [])[0];
  return first ? first.start_ms : null;
}
