import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";

export const VIDEO_CHAT_URL = (import.meta.env?.VITE_VIDEO_CHAT_URL as string | undefined)
  || "https://kvqrkphoyuoblfonjcvo.supabase.co/functions/v1/video-chat";

export interface ChatCitation {
  citation_index: number;
  start_ms: number;
  end_ms: number;
  source_segment_indexes: number[];
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  not_in_video: boolean;
  request_id: string;
  created_at: string;
  citations: ChatCitation[];
}

interface ChatSession { id: string; }

function headers(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return { apikey: env.supabaseAnonKey, Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" };
}

async function ownedRead<T>(session: AuthSession, path: string): Promise<T> {
  const env = getBrowserEnv();
  const response = await fetchWithAuth(session, `${env.supabaseUrl}/rest/v1/${path}`, { headers: headers(session) });
  if (!response.ok) throw new AppError({ code: "CHAT_ACCESS_DENIED", httpStatus: response.status,
    messageFa: "دریافت گفت‌وگوی این ویدیو ممکن نشد.", retryable: response.status >= 500,
    logMessage: `chat history read ${response.status}` });
  return (await response.json()) as T;
}

export async function fetchVideoChatHistory(session: AuthSession, videoId: string): Promise<ChatMessage[]> {
  const sessions = await ownedRead<ChatSession[]>(session,
    `video_chat_sessions?video_id=eq.${encodeURIComponent(videoId)}&select=id&limit=1`);
  if (!sessions[0]) return [];
  const messages = await ownedRead<Omit<ChatMessage, "citations">[]>(session,
    `video_chat_messages?session_id=eq.${sessions[0].id}&status=eq.complete&select=id,role,content,not_in_video,request_id,created_at&order=created_at.asc,id.asc`);
  const citations = await ownedRead<(ChatCitation & { message_id: string })[]>(session,
    `video_chat_message_citations?video_id=eq.${encodeURIComponent(videoId)}&select=message_id,citation_index,start_ms,end_ms,source_segment_indexes&order=citation_index.asc`);
  return messages.map((message) => ({ ...message,
    citations: citations.filter((citation) => citation.message_id === message.id) }));
}

const ERROR_FA: Record<string, string> = {
  CHAT_AUTH_REQUIRED: "برای پرسش از ویدیو ابتدا وارد حساب شوید.",
  CHAT_ACCESS_DENIED: "اجازه دسترسی به گفت‌وگوی این ویدیو را ندارید.",
  CHAT_INDEX_MISSING: "جست‌وجوی هوشمند این ویدیو هنوز آماده نشده است.",
  CHAT_STALE_INDEX: "جست‌وجوی هوشمند این ویدیو باید به‌روزرسانی شود.",
  CHAT_QUESTION_TOO_LONG: "پرسش بیش از حد طولانی است.",
  CHAT_RATE_LIMITED: "تعداد پرسش‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
  CHAT_REQUEST_CONFLICT: "این پرسش با شناسه تکراری نامعتبر است. دوباره ارسال کنید.",
  CHAT_PROVIDER_UNAVAILABLE: "پاسخ‌گویی هوشمند موقتاً در دسترس نیست.",\n  CHAT_GATEWAY_UPSTREAM_UNAVAILABLE: "ارتباط با سرویس پاسخ‌گویی برقرار نشد. کمی بعد دوباره تلاش کنید.",
  CHAT_INVALID_OUTPUT: "پاسخ معتبر تولید نشد. دوباره تلاش کنید.",
  CHAT_GROUNDING_FAILED: "پاسخ قابل استناد تولید نشد. دوباره تلاش کنید.",
};

export async function askVideoQuestion(session: AuthSession, videoId: string, question: string, requestId: string) {
  const response = await fetchWithAuth(session, VIDEO_CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Request-ID": requestId },
    body: JSON.stringify({ video_id: videoId, question, request_id: requestId }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code || "CHAT_PROVIDER_UNAVAILABLE";
    console.error(`[Vidora] videoChatFailure status=${response.status} code=${code}`);
    throw new AppError({ code, httpStatus: response.status,
      messageFa: payload?.error?.message_fa || ERROR_FA[code] || "در پاسخ‌گویی خطایی رخ داد.",
      retryable: response.status >= 500 || response.status === 429,
      logMessage: `video chat request failed ${response.status} ${code}` });
  }
  return payload as { status: string; session_id: string; assistant_message_id: string;
    answer: string; not_in_video: boolean; citations: ChatCitation[]; suggested_followups: string[]; reused: boolean };
}

export function formatCitation(citation: ChatCitation): string {
  const format = (ms: number) => {
    const total = Math.max(0, Math.floor(ms / 1000));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };
  const start = format(citation.start_ms);
  const end = format(citation.end_ms);
  return end === start ? start : `${start}–${end}`;
}
