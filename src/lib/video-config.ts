// Upload limits and accepted formats for the current phase. Client-side
// enforcement is a convenience only — the storage bucket enforces MIME types
// and file size limits server-side, and RLS enforces ownership.

export interface VideoUploadConfig {
  maxUploadSizeBytes: number;
  maxUploadSizeMb: number;
  allowedMimeTypes: string[];
  allowedExtensions: string[];
}

const DEFAULT_MAX_UPLOAD_MB = 500;

export const UPLOAD_BUCKET = "vidora-video-uploads";
export const RESULTS_BUCKET = "vidora-video-results";

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export function resolveVideoUploadConfig(rawMaxMb?: string): VideoUploadConfig {
  const parsed = Number.parseInt(String(rawMaxMb ?? ""), 10);
  const maxUploadSizeMb = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_UPLOAD_MB;
  return {
    maxUploadSizeMb,
    maxUploadSizeBytes: maxUploadSizeMb * 1024 * 1024,
    allowedMimeTypes: ["video/mp4", "video/quicktime", "video/webm"],
    allowedExtensions: ["mp4", "mov", "webm"],
  };
}

export function getVideoUploadConfig(): VideoUploadConfig {
  return resolveVideoUploadConfig(import.meta.env?.VITE_MAX_UPLOAD_SIZE_MB);
}

export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension] || "application/octet-stream";
}

/** Display-only normalization. Never used for storage paths. */
export function normalizeFilenameForDisplay(filename: string): string {
  const base = filename.split(/[\\/]/).pop() || "video";
  return base.replace(/[\u0000-\u001f<>:"|?*]/g, "").slice(0, 120) || "video";
}

export function formatFileSize(bytes: number, locale: "fa" | "en" = "fa"): string {
  const units = locale === "fa" ? ["بایت", "کیلوبایت", "مگابایت", "گیگابایت"] : ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  const text = rounded.toLocaleString(locale === "fa" ? "fa-IR" : "en-US");
  return `${text} ${units[unit]}`;
}
