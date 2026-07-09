// Private video object storage over the Supabase Storage REST API.
// Uploads authenticate with the signed-in user's JWT, so the per-user folder
// RLS policies on storage.objects enforce ownership — no service-role key is
// ever needed (or allowed) in the browser. The adapter interface is
// deliberately provider-shaped so a future S3/R2 backend can replace it.
import { AppError } from "./app-error";
import type { AuthSession } from "./auth";
import { getBrowserEnv } from "./env";
import { UPLOAD_BUCKET, extensionOf } from "./video-config";

export interface CreateUploadTargetInput {
  userId: string;
  videoId: string;
  filename: string;
}

export interface UploadTarget {
  bucket: string;
  /** users/{userId}/videos/{videoId}/source/{randomId}.{ext} */
  storageKey: string;
}

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface UploadHandle {
  promise: Promise<void>;
  abort: () => void;
}

export interface VideoStorage {
  createUploadTarget(input: CreateUploadTargetInput): UploadTarget;
  uploadObject(session: AuthSession, target: UploadTarget, file: File, onProgress: (p: UploadProgress) => void): UploadHandle;
  createSignedReadUrl(session: AuthSession, storageKey: string, expiresInSeconds: number): Promise<string>;
  objectExists(session: AuthSession, storageKey: string): Promise<boolean>;
  deleteObject(session: AuthSession, storageKey: string): Promise<void>;
}

const SAFE_SEGMENT = /^[a-z0-9-]+$/i;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "");
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Storage keys are built exclusively from server-issued UUIDs plus a random
 * id — never from user-provided filenames — so path traversal is impossible
 * by construction. This function still validates its inputs defensively.
 */
export function buildSourceStorageKey(userId: string, videoId: string, filename: string): string {
  if (!SAFE_SEGMENT.test(userId) || !SAFE_SEGMENT.test(videoId)) {
    throw new AppError({
      code: "STORAGE_UPLOAD_FAILED",
      httpStatus: 400,
      messageFa: "امکان آماده‌سازی آپلود وجود ندارد. دوباره تلاش کنید.",
      retryable: false,
      logMessage: "Refused unsafe storage key segment",
    });
  }
  const extension = extensionOf(filename);
  const safeExtension = /^[a-z0-9]{2,5}$/.test(extension) ? extension : "bin";
  return `${userId}/videos/${videoId}/source/${randomId()}.${safeExtension}`;
}

function storageUrl(path: string): string {
  return `${getBrowserEnv().supabaseUrl}/storage/v1${path}`;
}

function storageHeaders(session: AuthSession): Record<string, string> {
  return {
    apikey: getBrowserEnv().supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
  };
}

export class SupabaseVideoStorage implements VideoStorage {
  createUploadTarget(input: CreateUploadTargetInput): UploadTarget {
    return {
      bucket: UPLOAD_BUCKET,
      storageKey: buildSourceStorageKey(input.userId, input.videoId, input.filename),
    };
  }

  uploadObject(session: AuthSession, target: UploadTarget, file: File, onProgress: (p: UploadProgress) => void): UploadHandle {
    // XMLHttpRequest is used deliberately: fetch() exposes no upload-progress
    // events, and progress here must be real transferred bytes.
    const xhr = new XMLHttpRequest();
    const promise = new Promise<void>((resolve, reject) => {
      xhr.open("POST", storageUrl(`/object/${target.bucket}/${target.storageKey}`), true);
      const headers = storageHeaders(session);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.setRequestHeader("x-upsert", "false");

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        onProgress({
          loadedBytes: event.loaded,
          totalBytes: event.total,
          percent: Math.min(100, Math.floor((event.loaded / event.total) * 100)),
        });
      };
      xhr.onerror = () =>
        reject(
          new AppError({
            code: "NETWORK_ERROR",
            httpStatus: 0,
            messageFa: "در حین آپلود، ارتباط با سرور قطع شد. اتصال اینترنت را بررسی و دوباره تلاش کنید.",
            retryable: true,
            logMessage: "Upload network error",
          }),
        );
      xhr.onabort = () =>
        reject(
          new AppError({
            code: "UPLOAD_CANCELLED",
            httpStatus: 0,
            messageFa: "آپلود لغو شد.",
            retryable: true,
            logMessage: "Upload aborted by user",
          }),
        );
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress({ loadedBytes: file.size, totalBytes: file.size, percent: 100 });
          resolve();
          return;
        }
        reject(
          new AppError({
            code: xhr.status === 401 || xhr.status === 403 ? "ACCESS_DENIED" : "STORAGE_UPLOAD_FAILED",
            httpStatus: xhr.status,
            messageFa:
              xhr.status === 401 || xhr.status === 403
                ? "اجازه آپلود این فایل را ندارید. دوباره وارد حساب شوید."
                : "آپلود فایل ناموفق بود. دوباره تلاش کنید.",
            retryable: xhr.status >= 500,
            logMessage: `Storage upload failed with ${xhr.status}`,
          }),
        );
      };
      xhr.send(file);
    });
    return { promise, abort: () => xhr.abort() };
  }

  async createSignedReadUrl(session: AuthSession, storageKey: string, expiresInSeconds: number): Promise<string> {
    const response = await fetch(storageUrl(`/object/sign/${UPLOAD_BUCKET}/${storageKey}`), {
      method: "POST",
      headers: { ...storageHeaders(session), "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });
    if (!response.ok) {
      throw new AppError({
        code: response.status === 404 ? "STORAGE_OBJECT_MISSING" : "STORAGE_FAILURE",
        httpStatus: response.status,
        messageFa: "دسترسی به فایل ممکن نیست.",
        retryable: response.status >= 500,
        logMessage: `Sign URL failed with ${response.status}`,
      });
    }
    const payload = (await response.json()) as { signedURL?: string };
    if (!payload.signedURL) {
      throw new AppError({
        code: "STORAGE_FAILURE",
        httpStatus: 500,
        messageFa: "دسترسی به فایل ممکن نیست.",
        retryable: true,
        logMessage: "Sign URL response missing signedURL",
      });
    }
    return `${getBrowserEnv().supabaseUrl}/storage/v1${payload.signedURL}`;
  }

  async objectExists(session: AuthSession, storageKey: string): Promise<boolean> {
    const response = await fetch(storageUrl(`/object/info/authenticated/${UPLOAD_BUCKET}/${storageKey}`), {
      headers: storageHeaders(session),
    });
    return response.ok;
  }

  async deleteObject(session: AuthSession, storageKey: string): Promise<void> {
    const response = await fetch(storageUrl(`/object/${UPLOAD_BUCKET}/${storageKey}`), {
      method: "DELETE",
      headers: storageHeaders(session),
    });
    if (!response.ok && response.status !== 404) {
      throw new AppError({
        code: "STORAGE_FAILURE",
        httpStatus: response.status,
        messageFa: "حذف فایل ناموفق بود.",
        retryable: response.status >= 500,
        logMessage: `Storage delete failed with ${response.status}`,
      });
    }
  }
}

export const videoStorage: VideoStorage = new SupabaseVideoStorage();
