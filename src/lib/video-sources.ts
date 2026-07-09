// URL source adapters. In this phase adapters only classify and validate —
// nothing is downloaded in the browser. The future worker will use the same
// classification to pick an acquisition strategy.
import { AppError } from "./app-error";
import type { VideoSourceType } from "../types/database";

export interface SourceValidationResult {
  sourceType: Extract<VideoSourceType, "youtube" | "direct_media_url">;
  normalizedUrl: string;
  /** Best-effort display title derived from the URL (never trusted). */
  suggestedTitle: string;
}

export interface VideoSourceAdapter {
  canHandle(url: URL): boolean;
  validate(url: URL): Promise<SourceValidationResult>;
}

const FA = {
  invalid: "لینک واردشده معتبر نیست.",
  unsupported: "این لینک در حال حاضر پشتیبانی نمی‌شود.",
  privateSource: "ویدیو خصوصی است یا برای دسترسی به آن نیاز به ورود وجود دارد.",
  unreachable: "امکان دریافت ویدیو از این لینک وجود ندارد.",
  unsafe: "این آدرس به دلایل امنیتی قابل پردازش نیست.",
};

function fail(code: "INVALID_URL" | "UNSUPPORTED_SOURCE" | "UNSAFE_URL" | "SOURCE_PRIVATE", messageFa: string, log: string): AppError {
  return new AppError({ code, httpStatus: 400, messageFa, retryable: false, logMessage: log });
}

// ---------------------------------------------------------------------------
// SSRF guard: the URL will eventually be fetched by a trusted worker, so the
// frontend must never accept loopback, private-network, or cloud-metadata
// addresses, embedded credentials, or non-HTTPS schemes.
// ---------------------------------------------------------------------------

const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^0\.0\.0\.0$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/, // link-local, incl. cloud metadata 169.254.169.254
  /^metadata\.google\.internal$/i,
];

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

export function assertSafePublicUrl(url: URL): void {
  if (url.username || url.password) {
    throw fail("UNSAFE_URL", FA.unsafe, "URL contains embedded credentials");
  }
  if (url.protocol !== "https:") {
    throw fail("UNSAFE_URL", FA.unsafe, `Refused non-HTTPS scheme ${url.protocol}`);
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname.startsWith("[")) {
    // Refuse all IPv6 literals: loopback/ULA/link-local cannot be reliably
    // distinguished in the browser, and public services use hostnames.
    throw fail("UNSAFE_URL", FA.unsafe, "Refused IPv6 literal host");
  }
  for (const pattern of PRIVATE_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      throw fail("UNSAFE_URL", FA.unsafe, `Refused private/loopback host ${hostname}`);
    }
  }
  if (isIpLiteral(hostname)) {
    // Public-IP literals are also refused: redirect/rebind tricks are cheap
    // and legitimate video sources are hostname-based.
    throw fail("UNSAFE_URL", FA.unsafe, `Refused IP-literal host ${hostname}`);
  }
  if (!hostname.includes(".")) {
    throw fail("UNSAFE_URL", FA.unsafe, `Refused single-label host ${hostname}`);
  }
}

// ---------------------------------------------------------------------------
// YouTube adapter — public watch/short/live URLs.
// ---------------------------------------------------------------------------

const YT_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"]);

export function extractYoutubeVideoId(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (host.endsWith("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
  if (url.pathname === "/watch") return url.searchParams.get("v") || "";
  const shortMatch = /^\/(shorts|live|embed)\/([\w-]+)/.exec(url.pathname);
  return shortMatch ? shortMatch[2] : "";
}

export const youtubeAdapter: VideoSourceAdapter = {
  canHandle(url: URL): boolean {
    return YT_HOSTS.has(url.hostname.toLowerCase());
  },
  async validate(url: URL): Promise<SourceValidationResult> {
    assertSafePublicUrl(url);
    const videoId = extractYoutubeVideoId(url);
    if (!/^[\w-]{6,20}$/.test(videoId)) {
      throw fail("INVALID_URL", FA.invalid, "YouTube URL has no parseable video id");
    }
    // Playlists without a video, channels, etc. are handled above; private or
    // deleted videos can only be detected by the worker at acquisition time.
    return {
      sourceType: "youtube",
      normalizedUrl: `https://www.youtube.com/watch?v=${videoId}`,
      suggestedTitle: `YouTube · ${videoId}`,
    };
  },
};

// ---------------------------------------------------------------------------
// Direct media file adapter — public HTTPS links ending in a known container.
// ---------------------------------------------------------------------------

const DIRECT_MEDIA_EXTENSIONS = ["mp4", "mov", "webm"];

export const directMediaAdapter: VideoSourceAdapter = {
  canHandle(url: URL): boolean {
    const path = url.pathname.toLowerCase();
    return DIRECT_MEDIA_EXTENSIONS.some((ext) => path.endsWith(`.${ext}`));
  },
  async validate(url: URL): Promise<SourceValidationResult> {
    assertSafePublicUrl(url);
    const filename = url.pathname.split("/").filter(Boolean).pop() || "video";
    return {
      sourceType: "direct_media_url",
      normalizedUrl: url.toString(),
      suggestedTitle: decodeURIComponent(filename).slice(0, 120),
    };
  },
};

// Platforms we recognize but intentionally do not support yet. Users get an
// honest "not supported" instead of a fake acceptance.
const KNOWN_UNSUPPORTED_HOSTS = [
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "fb.watch",
  "x.com",
  "twitter.com",
  "aparat.com",
  "vimeo.com",
  "twitch.tv",
  "dailymotion.com",
];

const ADAPTERS: VideoSourceAdapter[] = [youtubeAdapter, directMediaAdapter];

export async function validateVideoSourceUrl(rawUrl: string): Promise<SourceValidationResult> {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw fail("INVALID_URL", FA.invalid, "Empty URL");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw fail("INVALID_URL", FA.invalid, "URL constructor rejected input");
  }

  assertSafePublicUrl(url);

  const adapter = ADAPTERS.find((candidate) => candidate.canHandle(url));
  if (adapter) return adapter.validate(url);

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (KNOWN_UNSUPPORTED_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw fail("UNSUPPORTED_SOURCE", FA.unsupported, `Known unsupported platform ${hostname}`);
  }
  throw fail("UNSUPPORTED_SOURCE", FA.unsupported, `No adapter for host ${hostname}`);
}

export const SOURCE_ERRORS_FA = FA;
