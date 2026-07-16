// Frontend access to adaptive learning tools (suitability profile, flashcards,
// quiz, per-user practice sessions). The browser READS canonical artifacts the
// worker generated (RLS scopes them to the video owner) and its OWN sessions
// and attempts. Quiz items are fetched with an explicit column list because the
// database grants deliberately EXCLUDE correct_choice_index and explanation —
// the correct answer only ever arrives through the submit_learning_answer RPC
// after a submission is recorded, so the browser can never read or alter it.
// Assessment and generation are privileged and run only via the Supabase Edge
// gateway -> private Modal endpoint -> server-side persistence (never a direct
// browser->Modal call, and no server secret ever reaches this code).
import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";

// MUST match worker/app/learning_config.py — ready artifacts produced by a
// different schema version are treated as stale.
export const LEARNING_ASSESS_SCHEMA_VERSION = "lrn-as1";
export const LEARNING_GEN_SCHEMA_VERSION = "lrn-gs1";

export const VIDEO_LEARNING_URL = (import.meta.env?.VITE_VIDEO_LEARNING_URL as string | undefined)
  || "https://kvqrkphoyuoblfonjcvo.supabase.co/functions/v1/video-learning";

export type LearningMode = "content" | "language" | "both";
export type ProfileState = "none" | "generating" | "ready" | "failed" | "stale";

export interface LearningProfile {
  id: string;
  status: string;
  recommended_mode: "content" | "language" | "both" | "none" | null;
  content_kind: string | null;
  content_suitability: string | null;
  language_suitability: string | null;
  reason_code: string | null;
  editorial_policy: string;
  schema_version: string | null;
  assessed_at: string | null;
}

export interface LearningSet {
  id: string;
  mode: LearningMode;
  status: string;
  schema_version: string | null;
  flashcard_count: number;
  quiz_count: number;
  generated_at: string | null;
}

export interface LearningItem {
  id: string;
  item_index: number;
  item_type: "flashcard" | "multiple_choice";
  learning_mode: "content" | "language";
  front_text: string | null;
  back_text: string | null;
  question_text: string | null;
  choices: string[] | null;
  source_segment_indexes: number[];
  start_ms: number | null;
  end_ms: number | null;
}

export interface LearningSession { id: string; status: string; }

export interface LearningAttempt {
  learning_item_id: string;
  response_type: "quiz_answer" | "flashcard_rating";
  selected_choice_index: number | null;
  flashcard_rating: "known" | "review" | null;
  is_correct: boolean | null;
}

export interface AnswerResult {
  reused: boolean;
  is_correct: boolean;
  selected_choice_index: number;
  correct_choice_index: number;
  explanation: string | null;
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
      messageFa: accessDenied ? "اجازه دسترسی به تمرین این ویدیو را ندارید." : "دریافت تمرین این ویدیو ناموفق بود.",
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
      messageFa: accessDenied ? "اجازه انجام این کار را ندارید." : fallbackFa,
      retryable: response.status >= 500,
      logMessage: `${context} rpc failed with ${response.status}`,
    });
  }
  return (await response.json().catch(() => null)) as T;
}

// ---------------------------------------------------------------------------
// Owner-scoped reads
// ---------------------------------------------------------------------------

export async function fetchLearningProfile(session: AuthSession, videoId: string): Promise<LearningProfile | null> {
  const select = [
    "id", "status", "recommended_mode", "content_kind", "content_suitability",
    "language_suitability", "reason_code", "editorial_policy", "schema_version", "assessed_at",
  ].join(",");
  const rows = await ownedRead<LearningProfile[]>(
    session,
    `video_learning_profiles?video_id=eq.${encodeURIComponent(videoId)}&select=${select}&limit=1`,
    "LearningProfile",
  );
  return rows[0] || null;
}

export async function fetchLearningSet(session: AuthSession, videoId: string, mode: LearningMode): Promise<LearningSet | null> {
  const select = "id,mode,status,schema_version,flashcard_count,quiz_count,generated_at";
  const rows = await ownedRead<LearningSet[]>(
    session,
    `video_learning_sets?video_id=eq.${encodeURIComponent(videoId)}&mode=eq.${mode}&select=${select}&limit=1`,
    "LearningSet",
  );
  return rows[0] || null;
}

// NOTE: the column list is deliberate and load-bearing — the database refuses
// correct_choice_index/explanation for browser roles, so `select=*` would fail.
export async function fetchLearningItems(session: AuthSession, setId: string): Promise<LearningItem[]> {
  const select = [
    "id", "item_index", "item_type", "learning_mode", "front_text", "back_text",
    "question_text", "choices", "source_segment_indexes", "start_ms", "end_ms",
  ].join(",");
  return ownedRead<LearningItem[]>(
    session,
    `video_learning_items?learning_set_id=eq.${encodeURIComponent(setId)}&select=${select}&order=item_index.asc`,
    "LearningItems",
  );
}

export async function fetchSessionAttempts(session: AuthSession, sessionId: string): Promise<LearningAttempt[]> {
  const select = "learning_item_id,response_type,selected_choice_index,flashcard_rating,is_correct";
  return ownedRead<LearningAttempt[]>(
    session,
    `video_learning_attempts?session_id=eq.${encodeURIComponent(sessionId)}&select=${select}`,
    "LearningAttempts",
  );
}

// ---------------------------------------------------------------------------
// Session / attempt RPCs (auth.uid()-scoped, server-evaluated)
// ---------------------------------------------------------------------------

export async function startLearningSession(session: AuthSession, videoId: string, setId: string): Promise<LearningSession> {
  return callRpc<LearningSession>(session, "start_learning_session",
    { p_video_id: videoId, p_set_id: setId },
    "startLearningSession", "شروع جلسه تمرین ناموفق بود.");
}

export async function submitQuizAnswer(session: AuthSession, sessionId: string, itemId: string,
                                       choiceIndex: number): Promise<AnswerResult> {
  return callRpc<AnswerResult>(session, "submit_learning_answer",
    { p_session_id: sessionId, p_item_id: itemId, p_choice_index: choiceIndex },
    "submitQuizAnswer", "ثبت پاسخ ناموفق بود.");
}

export async function rateFlashcard(session: AuthSession, sessionId: string, itemId: string,
                                    rating: "known" | "review"): Promise<void> {
  await callRpc(session, "submit_flashcard_rating",
    { p_session_id: sessionId, p_item_id: itemId, p_rating: rating },
    "rateFlashcard", "ثبت وضعیت فلش‌کارت ناموفق بود.");
}

export async function completeLearningSession(session: AuthSession, sessionId: string): Promise<void> {
  await callRpc(session, "complete_learning_session",
    { p_session_id: sessionId },
    "completeLearningSession", "پایان جلسه تمرین ناموفق بود.");
}

// ---------------------------------------------------------------------------
// Gateway calls (assessment + generation)
// ---------------------------------------------------------------------------

const LEARNING_ERROR_FA: Record<string, string> = {
  LEARNING_AUTH_REQUIRED: "برای استفاده از تمرین ابتدا وارد حساب شوید.",
  LEARNING_ACCESS_DENIED: "اجازه دسترسی به تمرین این ویدیو را ندارید.",
  LEARNING_TRANSCRIPT_MISSING: "متن این ویدیو برای ساخت تمرین یافت نشد.",
  LEARNING_TRANSLATION_INCOMPLETE: "ترجمه فارسی این ویدیو هنوز کامل نیست.",
  LEARNING_NOT_RECOMMENDED: "برای این ویدیو تمرین آموزشی معناداری پیشنهاد نمی‌شود.",
  LEARNING_MODE_UNSUPPORTED: "این نوع تمرین برای این ویدیو پشتیبانی نمی‌شود.",
  LEARNING_INSUFFICIENT_CONTENT: "محتوای این ویدیو برای ساخت تمرین معنادار کافی نیست.",
  LEARNING_RATE_LIMITED: "کمی صبر کنید و دوباره تلاش کنید.",
  LEARNING_PROVIDER_UNAVAILABLE: "سرویس ساخت تمرین موقتاً در دسترس نیست.",
  LEARNING_INVALID_OUTPUT: "تمرین معتبری ساخته نشد. دوباره تلاش کنید.",
  LEARNING_GROUNDING_FAILED: "تمرین قابل استناد ساخته نشد. دوباره تلاش کنید.",
  LEARNING_ASSESSMENT_FAILED: "بررسی این ویدیو برای تمرین انجام نشد.",
  LEARNING_GENERATION_FAILED: "ساخت تمرین این ویدیو انجام نشد.",
};

async function gatewayCall(session: AuthSession, payload: Record<string, unknown>, fallbackFa: string) {
  const response = await fetchWithAuth(session, VIDEO_LEARNING_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": crypto.randomUUID() },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code || "LEARNING_PROVIDER_UNAVAILABLE";
    console.error(`[Vidora] videoLearningFailure status=${response.status} code=${code}`);
    throw new AppError({
      code, httpStatus: response.status,
      messageFa: body?.error?.message_fa || LEARNING_ERROR_FA[code] || fallbackFa,
      retryable: response.status >= 500 || response.status === 429,
      logMessage: `video learning request failed ${response.status} ${code}`,
    });
  }
  return body as { status: string; recommended_mode?: string };
}

export function requestAssessment(session: AuthSession, videoId: string, force = false) {
  return gatewayCall(session, { action: "assess", video_id: videoId, force },
    "بررسی این ویدیو برای تمرین انجام نشد.");
}

export function requestGeneration(session: AuthSession, videoId: string, mode: LearningMode, force = false) {
  return gatewayCall(session, { action: "generate", video_id: videoId, mode, force },
    "ساخت تمرین این ویدیو انجام نشد.");
}

// ---------------------------------------------------------------------------
// State derivation + Persian copy
// ---------------------------------------------------------------------------

export function deriveProfileState(profile: LearningProfile | null): ProfileState {
  if (!profile) return "none";
  if (profile.status === "ready") {
    return profile.schema_version === LEARNING_ASSESS_SCHEMA_VERSION ? "ready" : "stale";
  }
  if (profile.status === "generating") return "generating";
  if (profile.status === "stale") return "stale";
  if (profile.status === "failed") return "failed";
  return "none";
}

export function deriveSetState(set: LearningSet | null): ProfileState {
  if (!set) return "none";
  if (set.status === "ready") {
    return set.schema_version === LEARNING_GEN_SCHEMA_VERSION ? "ready" : "stale";
  }
  if (set.status === "generating") return "generating";
  if (set.status === "stale") return "stale";
  if (set.status === "failed") return "failed";
  return "none";
}

/** Modes the server will accept generation for (mirror of the server rule):
 * editorial policy overrides; under auto, any non-'none' suitability keeps a
 * mode selectable even when not the recommendation. */
export function supportedModesFor(profile: LearningProfile | null): LearningMode[] {
  if (!profile) return [];
  const policy = (profile.editorial_policy || "auto").toLowerCase();
  if (policy === "disabled") return [];
  if (policy === "content") return ["content"];
  if (policy === "language") return ["language"];
  if (policy === "both") return ["content", "language", "both"];
  const modes: LearningMode[] = [];
  const contentOk = (profile.content_suitability || "none") !== "none";
  const languageOk = (profile.language_suitability || "none") !== "none";
  if (contentOk) modes.push("content");
  if (languageOk) modes.push("language");
  if (contentOk && languageOk) modes.push("both");
  return modes;
}

export const RECOMMENDATION_FA: Record<string, string> = {
  content: "برای مرور مفاهیم این ویدیو، تمرین محتوایی پیشنهاد می‌شود.",
  language: "این ویدیو برای تمرین عبارت‌ها و درک زبان مناسب است.",
  both: "می‌توانید هم محتوای ویدیو و هم زبان آن را تمرین کنید.",
  none: "برای این ویدیو تمرین آموزشی معناداری پیشنهاد نمی‌شود.",
};

export const MODE_LABEL_FA: Record<LearningMode | "watch", string> = {
  content: "یادگیری محتوای ویدیو",
  language: "تمرین زبان با این ویدیو",
  both: "هر دو",
  watch: "فقط تماشا",
};

export const PROFILE_STATE_FA: Record<ProfileState, string> = {
  none: "هنوز مناسب‌بودن این ویدیو برای تمرین بررسی نشده است.",
  generating: "در حال بررسی مناسب‌بودن این ویدیو برای تمرین…",
  ready: "بررسی تمرین این ویدیو آماده است.",
  failed: "بررسی این ویدیو برای تمرین انجام نشد؛ سایر بخش‌ها در دسترس‌اند.",
  stale: "محتوای ویدیو تغییر کرده و بررسی تمرین باید دوباره انجام شود.",
};

/** First citation start for a learning item, or null (then no seek action). */
export function learningItemSeekMs(item: Pick<LearningItem, "start_ms">): number | null {
  return typeof item.start_ms === "number" ? item.start_ms : null;
}
