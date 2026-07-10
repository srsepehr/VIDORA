// Frontend subtitle-artifact access. The browser only CONSUMES artifacts that
// the server-side worker generated — it never generates authoritative subtitle
// files. Ownership is enforced by RLS on subtitle_artifacts and by the private
// results bucket's read policy, not by any path in this file.
import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";
import { RESULTS_BUCKET } from "./video-config";
import { createSignedUrlForBucket } from "./video-storage";

// MUST match worker/app/subtitle_config.py BUILDER_VERSION. A mismatch means the
// stored artifact was built by a different builder and is treated as stale.
export const SUBTITLE_BUILDER_VERSION = "sub-v1";
export const SUBTITLE_LANG = "fa";
export const SUBTITLE_LABEL = "فارسی";
const SUBTITLE_URL_TTL_SECONDS = 300;

export type SubtitleFormat = "vtt" | "srt";
export type SubtitleState = "ready" | "generating" | "failed" | "stale" | "none";

export interface SubtitleArtifact {
  format: SubtitleFormat;
  language: string;
  status: string;
  content_hash: string | null;
  builder_version: string | null;
  cue_count: number | null;
  storage_path: string | null;
  validation_warnings: unknown;
  error_code: string | null;
}

export interface SubtitleAvailability {
  state: SubtitleState;
  vtt: SubtitleArtifact | null;
  srt: SubtitleArtifact | null;
}

function restHeaders(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

export async function fetchSubtitleArtifacts(session: AuthSession, videoId: string): Promise<SubtitleArtifact[]> {
  const env = getBrowserEnv();
  const select = [
    "format", "language", "status", "content_hash", "builder_version",
    "cue_count", "storage_path", "validation_warnings", "error_code",
  ].join(",");
  const url = `${env.supabaseUrl}/rest/v1/subtitle_artifacts?video_id=eq.${encodeURIComponent(videoId)}&language=eq.${SUBTITLE_LANG}&select=${select}`;
  const response = await fetchWithAuth(session, url, { headers: restHeaders(session) });
  if (!response.ok) {
    if (response.status === 404) return [];
    const accessDenied = response.status === 401 || response.status === 403;
    throw new AppError({
      code: accessDenied ? "ACCESS_DENIED" : "DATABASE_ERROR",
      httpStatus: response.status,
      messageFa: accessDenied ? "اجازه دسترسی به زیرنویس این ویدیو را ندارید." : "دریافت وضعیت زیرنویس ناموفق بود.",
      retryable: response.status >= 500,
      logMessage: `Subtitle artifacts read failed with ${response.status}`,
    });
  }
  return (await response.json()) as SubtitleArtifact[];
}

/** Derive the single user-facing subtitle state from the artifact rows. A ready
 * artifact built by a different builder version is reported stale (integrity is
 * decided by builder_version + DB status, never by filename). */
export function deriveSubtitleAvailability(artifacts: SubtitleArtifact[]): SubtitleAvailability {
  const vtt = artifacts.find((a) => a.format === "vtt") || null;
  const srt = artifacts.find((a) => a.format === "srt") || null;
  let state: SubtitleState = "none";
  if (vtt) {
    if (vtt.status === "ready") {
      state = vtt.builder_version === SUBTITLE_BUILDER_VERSION ? "ready" : "stale";
    } else if (vtt.status === "generating") {
      state = "generating";
    } else if (vtt.status === "stale") {
      state = "stale";
    } else if (vtt.status === "failed") {
      state = "failed";
    }
  }
  return { state, vtt, srt };
}

export function isSubtitleDownloadable(artifact: SubtitleArtifact | null): boolean {
  return Boolean(artifact && artifact.status === "ready" && artifact.storage_path);
}

export function subtitleFilename(format: SubtitleFormat): string {
  return `vidora-fa.${format}`;
}

/** Short-lived signed URL for a subtitle object in the private results bucket.
 * Never persist the returned URL. */
export async function createSubtitleSignedUrl(session: AuthSession, storagePath: string): Promise<string> {
  return createSignedUrlForBucket(session, RESULTS_BUCKET, storagePath, SUBTITLE_URL_TTL_SECONDS);
}

/** Securely download an artifact: fresh signed URL at call time -> Blob -> save.
 * The raw storage path is never shown and the signed URL is not persisted. */
export async function downloadSubtitleArtifact(session: AuthSession, artifact: SubtitleArtifact): Promise<void> {
  if (!isSubtitleDownloadable(artifact) || !artifact.storage_path) {
    throw new AppError({
      code: "STORAGE_OBJECT_MISSING",
      httpStatus: 404,
      messageFa: "فایل زیرنویس برای دانلود آماده نیست.",
      retryable: false,
      logMessage: "Subtitle artifact not downloadable",
    });
  }
  const signedUrl = await createSubtitleSignedUrl(session, artifact.storage_path);
  const response = await fetch(signedUrl);
  if (!response.ok) {
    throw new AppError({
      code: "STORAGE_FAILURE",
      httpStatus: response.status,
      messageFa: "دانلود فایل زیرنویس ناموفق بود. دوباره تلاش کنید.",
      retryable: response.status >= 500,
      logMessage: `Subtitle download failed with ${response.status}`,
    });
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = subtitleFilename(artifact.format);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
