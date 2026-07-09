// Video creation, upload orchestration, URL submission, job dispatch, and
// owner-scoped reads. All requests run with the signed-in user's JWT against
// PostgREST + Storage, so RLS is the source of truth for ownership.
import { AppError, logAppError, toAppError } from "./app-error";
import type { AuthSession } from "./auth";
import { getAccessPolicy } from "./access-policy";
import { getBrowserEnv } from "./env";
import { extensionOf, getVideoUploadConfig, normalizeFilenameForDisplay } from "./video-config";
import { videoStorage, type UploadProgress } from "./video-storage";
import { validateVideoSourceUrl } from "./video-sources";
import type { UserVideo, VideoJob } from "../types/database";

// ---------------------------------------------------------------------------
// Shared PostgREST helpers
// ---------------------------------------------------------------------------

function restHeaders(session: AuthSession, extra: Record<string, string> = {}): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function restError(response: Response, fallbackFa: string, context: string): Promise<AppError> {
  const payload = await response.text().catch(() => "");
  if (response.status === 401 || response.status === 403) {
    return new AppError({
      code: "ACCESS_DENIED",
      httpStatus: response.status,
      messageFa: "اجازه انجام این عملیات را ندارید. دوباره وارد حساب شوید.",
      retryable: false,
      logMessage: `${context}: PostgREST ${response.status}`,
    });
  }
  if (response.status === 429) {
    return new AppError({
      code: "RATE_LIMITED",
      httpStatus: 429,
      messageFa: "تعداد درخواست‌ها بیش از حد مجاز است. کمی بعد دوباره تلاش کنید.",
      retryable: true,
      logMessage: `${context}: rate limited`,
    });
  }
  // PostgREST wraps RAISE EXCEPTION messages; map our stable function errors.
  if (payload.includes("VIDEO_NOT_FOUND")) {
    return new AppError({
      code: "VIDEO_NOT_FOUND",
      httpStatus: 404,
      messageFa: "ویدیوی موردنظر پیدا نشد یا به شما تعلق ندارد.",
      retryable: false,
      logMessage: `${context}: video not found`,
    });
  }
  if (payload.includes("VIDEO_NOT_ENQUEUEABLE") || payload.includes("VIDEO_NOT_CANCELLABLE")) {
    return new AppError({
      code: "JOB_ALREADY_EXISTS",
      httpStatus: 409,
      messageFa: "وضعیت فعلی ویدیو اجازه این عملیات را نمی‌دهد.",
      retryable: false,
      logMessage: `${context}: invalid state transition`,
    });
  }
  if (payload.includes("VIDEO_SOURCE_MISSING")) {
    return new AppError({
      code: "STORAGE_OBJECT_MISSING",
      httpStatus: 409,
      messageFa: "فایل ویدیو هنوز به‌طور کامل آپلود نشده است.",
      retryable: true,
      logMessage: `${context}: storage object missing at enqueue`,
    });
  }
  return new AppError({
    code: "DATABASE_ERROR",
    httpStatus: response.status,
    messageFa: fallbackFa,
    retryable: response.status >= 500,
    logMessage: `${context}: PostgREST ${response.status} ${payload.slice(0, 300)}`,
  });
}

/** Exposed for tests only — maps PostgREST failures to stable AppError codes. */
export const __testMapRestError = restError;

async function restJson<T>(response: Response, fallbackFa: string, context: string): Promise<T> {
  if (!response.ok) throw await restError(response, fallbackFa, context);
  return (await response.json()) as T;
}

function rest(path: string): string {
  return `${getBrowserEnv().supabaseUrl}/rest/v1${path}`;
}

// ---------------------------------------------------------------------------
// File validation (client courtesy — the bucket re-enforces server-side)
// ---------------------------------------------------------------------------

export function validateVideoFile(file: File): void {
  const config = getVideoUploadConfig();
  if (file.size === 0) {
    throw new AppError({
      code: "FILE_EMPTY",
      httpStatus: 400,
      messageFa: "فایل انتخاب‌شده خالی است.",
      retryable: false,
      logMessage: "Empty file rejected",
    });
  }
  const extension = extensionOf(file.name);
  const mimeOk = !file.type || config.allowedMimeTypes.includes(file.type);
  if (!config.allowedExtensions.includes(extension) || !mimeOk) {
    throw new AppError({
      code: "FILE_TYPE_UNSUPPORTED",
      httpStatus: 400,
      messageFa: "فرمت این فایل پشتیبانی نمی‌شود. فقط MP4، MOV یا WebM مجاز است.",
      retryable: false,
      logMessage: `Rejected type ext=${extension} mime=${file.type}`,
    });
  }
  if (file.size > config.maxUploadSizeBytes) {
    throw new AppError({
      code: "FILE_TOO_LARGE",
      httpStatus: 400,
      messageFa: `حجم فایل بیشتر از حد مجاز (${config.maxUploadSizeMb} مگابایت) است.`,
      retryable: false,
      logMessage: `Rejected size ${file.size}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Job dispatcher — database-backed durable queue.
// Chosen because: the repo is a static SPA + Supabase (no extra infra), the
// queue row lives in Postgres with RLS + unique active-job index (idempotent,
// at-least-once), and the future worker can lease jobs via
// lease_expires_at/heartbeat_at with service-role access. Swapping to
// QStash/BullMQ later only means replacing this implementation.
// ---------------------------------------------------------------------------

export interface EnqueueVideoInput {
  session: AuthSession;
  videoId: string;
}

export interface DispatchResult {
  job: VideoJob;
}

export interface VideoJobDispatcher {
  enqueueVideoProcessing(input: EnqueueVideoInput): Promise<DispatchResult>;
}

export class SupabaseQueueDispatcher implements VideoJobDispatcher {
  async enqueueVideoProcessing({ session, videoId }: EnqueueVideoInput): Promise<DispatchResult> {
    const response = await fetch(rest("/rpc/enqueue_video_processing"), {
      method: "POST",
      headers: restHeaders(session),
      body: JSON.stringify({ p_video_id: videoId }),
    });
    const job = await restJson<VideoJob>(response, "ثبت ویدیو در صف پردازش ناموفق بود.", "enqueueVideoProcessing");
    return { job };
  }
}

export const jobDispatcher: VideoJobDispatcher = new SupabaseQueueDispatcher();

// ---------------------------------------------------------------------------
// Video records
// ---------------------------------------------------------------------------

async function insertVideo(session: AuthSession, row: Record<string, unknown>): Promise<UserVideo> {
  const response = await fetch(rest("/videos"), {
    method: "POST",
    headers: restHeaders(session, { Prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!response.ok) {
    const error = await restError(response, "ثبت ویدیو ناموفق بود.", "insertVideo");
    throw error.code === "DATABASE_ERROR" ? new AppError({ ...error, code: "VIDEO_CREATE_FAILED", messageFa: "ثبت ویدیو ناموفق بود.", httpStatus: error.httpStatus, retryable: error.retryable }) : error;
  }
  const rows = (await response.json()) as UserVideo[];
  if (!rows[0]) {
    throw new AppError({
      code: "VIDEO_CREATE_FAILED",
      httpStatus: 500,
      messageFa: "ثبت ویدیو ناموفق بود.",
      retryable: true,
      logMessage: "Insert returned no representation",
    });
  }
  return rows[0];
}

async function patchVideo(session: AuthSession, videoId: string, patch: Record<string, unknown>): Promise<void> {
  const response = await fetch(rest(`/videos?id=eq.${videoId}`), {
    method: "PATCH",
    headers: restHeaders(session),
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await restError(response, "به‌روزرسانی ویدیو ناموفق بود.", "patchVideo");
}

export async function fetchVideoById(session: AuthSession, videoId: string): Promise<UserVideo | null> {
  const response = await fetch(rest(`/videos?id=eq.${encodeURIComponent(videoId)}&select=*`), {
    headers: restHeaders(session),
  });
  const rows = await restJson<UserVideo[]>(response, "دریافت اطلاعات ویدیو ناموفق بود.", "fetchVideoById");
  return rows[0] || null;
}

export async function fetchLatestJob(session: AuthSession, videoId: string): Promise<VideoJob | null> {
  const response = await fetch(rest(`/video_jobs?video_id=eq.${encodeURIComponent(videoId)}&select=*&order=created_at.desc&limit=1`), {
    headers: restHeaders(session),
  });
  const rows = await restJson<VideoJob[]>(response, "دریافت وضعیت پردازش ناموفق بود.", "fetchLatestJob");
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Upload flow
// ---------------------------------------------------------------------------

export interface UploadFlowCallbacks {
  onProgress: (progress: UploadProgress) => void;
  onPhase: (phase: "creating" | "uploading" | "verifying" | "queueing" | "done") => void;
}

export interface UploadFlowHandle {
  promise: Promise<UserVideo>;
  cancel: () => void;
}

export function startVideoUpload(session: AuthSession, file: File, callbacks: UploadFlowCallbacks): UploadFlowHandle {
  let abortUpload: (() => void) | null = null;
  let cancelled = false;

  const promise = (async () => {
    const decision = await getAccessPolicy().canUploadVideo(session.user.id);
    if (!decision.allowed) {
      throw new AppError({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
        messageFa: decision.messageFa || "برای ادامه ابتدا وارد حساب خود شوید.",
        retryable: false,
        logMessage: `Access policy denied upload: ${decision.reason}`,
      });
    }
    validateVideoFile(file);

    callbacks.onPhase("creating");
    const displayName = normalizeFilenameForDisplay(file.name);
    const video = await insertVideo(session, {
      user_id: session.user.id,
      source_type: "upload",
      original_filename: displayName,
      title: displayName.replace(/\.[a-z0-9]+$/i, ""),
      mime_type: file.type || null,
      file_size_bytes: file.size,
      status: "uploading",
    });

    const target = videoStorage.createUploadTarget({ userId: session.user.id, videoId: video.id, filename: file.name });

    callbacks.onPhase("uploading");
    const handle = videoStorage.uploadObject(session, target, file, callbacks.onProgress);
    abortUpload = handle.abort;
    if (cancelled) handle.abort();
    try {
      await handle.promise;
    } catch (error) {
      // Best-effort: keep the row but mark it failed/cancelled so the list is honest.
      const appError = toAppError(error);
      const isCancel = appError.code === "UPLOAD_CANCELLED";
      await patchVideo(session, video.id, {
        status: isCancel ? "cancelled" : "failed",
        failure_code: appError.code,
        failure_message_fa: appError.messageFa,
      }).catch((patchError) => logAppError(toAppError(patchError), "startVideoUpload.markFailed"));
      throw appError;
    }

    callbacks.onPhase("verifying");
    const exists = await videoStorage.objectExists(session, target.storageKey);
    if (!exists) {
      throw new AppError({
        code: "STORAGE_OBJECT_MISSING",
        httpStatus: 500,
        messageFa: "فایل آپلودشده در فضای ذخیره‌سازی پیدا نشد. دوباره تلاش کنید.",
        retryable: true,
        logMessage: "Uploaded object missing at verification",
      });
    }
    await patchVideo(session, video.id, { storage_key: target.storageKey, status: "uploaded" });

    callbacks.onPhase("queueing");
    await jobDispatcher.enqueueVideoProcessing({ session, videoId: video.id });

    callbacks.onPhase("done");
    return { ...video, storage_key: target.storageKey, status: "queued" as const };
  })();

  return {
    promise,
    cancel: () => {
      cancelled = true;
      abortUpload?.();
    },
  };
}

// ---------------------------------------------------------------------------
// URL submission flow
// ---------------------------------------------------------------------------

export async function submitVideoUrl(session: AuthSession, rawUrl: string, ownershipConfirmed: boolean): Promise<UserVideo> {
  const decision = await getAccessPolicy().canSubmitVideoUrl(session.user.id);
  if (!decision.allowed) {
    throw new AppError({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
      messageFa: decision.messageFa || "برای ادامه ابتدا وارد حساب خود شوید.",
      retryable: false,
      logMessage: `Access policy denied URL submit: ${decision.reason}`,
    });
  }
  if (!ownershipConfirmed) {
    throw new AppError({
      code: "TERMS_REQUIRED",
      httpStatus: 400,
      messageFa: "برای ادامه، مالکیت یا اجازه پردازش این محتوا را تأیید کنید.",
      retryable: false,
      logMessage: "Ownership confirmation missing",
    });
  }

  const result = await validateVideoSourceUrl(rawUrl);
  const video = await insertVideo(session, {
    user_id: session.user.id,
    source_type: result.sourceType,
    source_url: result.normalizedUrl,
    title: result.suggestedTitle,
    status: "created",
  });
  await jobDispatcher.enqueueVideoProcessing({ session, videoId: video.id });
  return { ...video, status: "queued" as const };
}

// ---------------------------------------------------------------------------
// List / detail / cancel / retry / delete
// ---------------------------------------------------------------------------

export interface VideoListPage {
  videos: UserVideo[];
  total: number;
}

export async function fetchVideosPage(session: AuthSession, offset: number, limit: number): Promise<VideoListPage> {
  const response = await fetch(rest(`/videos?select=*&order=created_at.desc&offset=${offset}&limit=${limit}`), {
    headers: restHeaders(session, { Prefer: "count=exact" }),
  });
  const videos = await restJson<UserVideo[]>(response, "دریافت فهرست ویدیوها ناموفق بود.", "fetchVideosPage");
  const range = response.headers.get("content-range") || "";
  const total = Number.parseInt(range.split("/")[1] || "", 10);
  return { videos, total: Number.isFinite(total) ? total : videos.length };
}

export async function cancelVideoProcessing(session: AuthSession, videoId: string): Promise<void> {
  const response = await fetch(rest("/rpc/cancel_video_processing"), {
    method: "POST",
    headers: restHeaders(session),
    body: JSON.stringify({ p_video_id: videoId }),
  });
  if (!response.ok) throw await restError(response, "لغو پردازش ناموفق بود.", "cancelVideoProcessing");
}

export async function retryVideoProcessing(session: AuthSession, videoId: string): Promise<VideoJob> {
  const { job } = await jobDispatcher.enqueueVideoProcessing({ session, videoId });
  return job;
}

const DELETABLE_STATUSES = new Set(["created", "uploading", "uploaded", "queued", "failed", "cancelled", "completed"]);

export async function deleteVideo(session: AuthSession, video: UserVideo): Promise<void> {
  if (!DELETABLE_STATUSES.has(video.status)) {
    throw new AppError({
      code: "ACCESS_DENIED",
      httpStatus: 409,
      messageFa: "در میانه پردازش نمی‌توان ویدیو را حذف کرد. ابتدا پردازش را لغو کنید.",
      retryable: false,
      logMessage: `Refused delete in status ${video.status}`,
    });
  }
  if (video.storage_key) {
    await videoStorage.deleteObject(session, video.storage_key).catch((error) => {
      // Losing the object delete is acceptable; the row delete is the source
      // of truth and orphan cleanup belongs to the worker phase.
      logAppError(toAppError(error), "deleteVideo.storage");
    });
  }
  const response = await fetch(rest(`/videos?id=eq.${encodeURIComponent(video.id)}`), {
    method: "DELETE",
    headers: restHeaders(session),
  });
  if (!response.ok) throw await restError(response, "حذف ویدیو ناموفق بود.", "deleteVideo");
}
