import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";

export interface TranscriptSegment {
  id: string;
  video_id: string;
  segment_index: number;
  start_ms: number;
  end_ms: number;
  source_text: string;
  translated_text_fa: string | null;
  confidence: number | null;
  source_language: string | null;
  speaker: string | null;
  translation_provider: string | null;
  translation_model: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscriptIntegrityReport {
  segments: TranscriptSegment[];
  duplicateIndexes: number[];
  invalidIndexes: number[];
  missingSourceIndexes: number[];
  missingTranslationIndexes: number[];
  isComplete: boolean;
}

function restHeaders(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function fetchTranscriptSegments(session: AuthSession, videoId: string): Promise<TranscriptSegment[]> {
  const env = getBrowserEnv();
  const select = [
    "id", "video_id", "segment_index", "start_ms", "end_ms",
    "source_text", "translated_text_fa", "confidence", "source_language",
    "speaker", "translation_provider", "translation_model", "created_at", "updated_at",
  ].join(",");
  const url = `${env.supabaseUrl}/rest/v1/transcript_segments?video_id=eq.${encodeURIComponent(videoId)}&select=${select}&order=segment_index.asc,start_ms.asc`;
  const response = await fetchWithAuth(session, url, { headers: restHeaders(session) });
  if (!response.ok) {
    const accessDenied = response.status === 401 || response.status === 403;
    throw new AppError({
      code: accessDenied ? "ACCESS_DENIED" : "DATABASE_ERROR",
      httpStatus: response.status,
      messageFa: accessDenied
        ? "اجازه مشاهده متن این ویدیو را ندارید."
        : "دریافت متن و ترجمه ویدیو ناموفق بود.",
      retryable: response.status >= 500,
      logMessage: `Transcript read failed with ${response.status}`,
    });
  }
  return (await response.json()) as TranscriptSegment[];
}

export function prepareTranscript(input: TranscriptSegment[]): TranscriptIntegrityReport {
  const segments = [...input].sort((a, b) =>
    a.segment_index - b.segment_index || a.start_ms - b.start_ms || a.end_ms - b.end_ms,
  );
  const seen = new Set<number>();
  const duplicateIndexes = new Set<number>();
  const invalidIndexes: number[] = [];
  const missingSourceIndexes: number[] = [];
  const missingTranslationIndexes: number[] = [];

  for (const segment of segments) {
    if (seen.has(segment.segment_index)) duplicateIndexes.add(segment.segment_index);
    seen.add(segment.segment_index);
    if (
      !Number.isInteger(segment.segment_index) ||
      !Number.isFinite(segment.start_ms) ||
      !Number.isFinite(segment.end_ms) ||
      segment.segment_index < 0 ||
      segment.start_ms < 0 ||
      segment.end_ms < segment.start_ms
    ) invalidIndexes.push(segment.segment_index);
    if (!segment.source_text?.trim()) missingSourceIndexes.push(segment.segment_index);
    if (!segment.translated_text_fa?.trim()) missingTranslationIndexes.push(segment.segment_index);
  }

  return {
    segments,
    duplicateIndexes: [...duplicateIndexes].sort((a, b) => a - b),
    invalidIndexes,
    missingSourceIndexes,
    missingTranslationIndexes,
    isComplete:
      segments.length > 0 &&
      duplicateIndexes.size === 0 &&
      invalidIndexes.length === 0 &&
      missingSourceIndexes.length === 0 &&
      missingTranslationIndexes.length === 0,
  };
}

export function formatTranscriptTimestamp(milliseconds: number): string {
  const safe = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  const totalSeconds = Math.floor(safe / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":")
    : [minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}

export function findActiveSegmentIndex(
  segments: TranscriptSegment[],
  timeMs: number,
  gapToleranceMs = 250,
): number {
  if (!segments.length || !Number.isFinite(timeMs) || timeMs < segments[0].start_ms) return -1;
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (segments[middle].start_ms <= timeMs) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (candidate < 0) return -1;
  const segment = segments[candidate];
  if (timeMs <= segment.end_ms) return candidate;
  const next = segments[candidate + 1];
  if (next && timeMs < next.start_ms && timeMs - segment.end_ms <= gapToleranceMs) return candidate;
  return -1;
}

export function normalizeTranscriptSearch(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u200c\u200d\u200e\u200f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function segmentMatchesQuery(segment: TranscriptSegment, query: string): boolean {
  const normalized = normalizeTranscriptSearch(query);
  if (!normalized) return true;
  return (
    normalizeTranscriptSearch(segment.source_text).includes(normalized) ||
    normalizeTranscriptSearch(segment.translated_text_fa || "").includes(normalized)
  );
}

export function findSearchRange(text: string, query: string): [number, number] | null {
  const normalizedQuery = normalizeTranscriptSearch(query);
  if (!normalizedQuery) return null;

  let normalizedText = "";
  const originalIndexes: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = normalizeTranscriptSearch(text[index]);
    if (!char) continue;
    normalizedText += char;
    originalIndexes.push(index);
  }

  const start = normalizedText.indexOf(normalizedQuery);
  if (start < 0) return null;
  const endNormalized = start + normalizedQuery.length - 1;
  return [originalIndexes[start], (originalIndexes[endNormalized] ?? originalIndexes[start]) + 1];
}

export function buildTranscriptCopy(
  segments: TranscriptSegment[],
  mode: "source" | "fa" | "both",
  includeTimestamps = false,
): string {
  return segments
    .map((segment) => {
      const prefix = includeTimestamps ? `[${formatTranscriptTimestamp(segment.start_ms)}] ` : "";
      if (mode === "source") return `${prefix}${segment.source_text.trim()}`;
      if (mode === "fa") return `${prefix}${(segment.translated_text_fa || "").trim()}`;
      return `${prefix}${segment.source_text.trim()}\n${(segment.translated_text_fa || "").trim()}`;
    })
    .filter((line) => line.trim())
    .join(mode === "both" ? "\n\n" : "\n");
}
