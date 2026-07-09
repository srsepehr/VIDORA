const FALLBACK_RETURN_TO = "/dashboard";

function stripHashPrefix(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}

export function sanitizeReturnTo(raw: string | null | undefined, fallback = FALLBACK_RETURN_TO): string {
  if (!raw) return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  decoded = stripHashPrefix(decoded.trim());

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return fallback;
  }

  const [path, query = ""] = decoded.split("?");
  const safePaths = [
    /^\/dashboard(\/(new-translation|videos|saved|subscription|support|settings))?$/,
    /^\/library(\/category\/[a-z0-9-]+)?$/,
    /^\/watch\/[a-z0-9-]+$/,
    /^\/$/,
  ];

  if (!safePaths.some((pattern) => pattern.test(path))) return fallback;
  return query ? `${path}?${query}` : path;
}

export function getReturnToFromHash(fallback = FALLBACK_RETURN_TO): string {
  const query = window.location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  return sanitizeReturnTo(params.get("returnTo") || params.get("redirect"), fallback);
}

export function getCurrentInternalPath(): string {
  const hash = window.location.hash || "#/";
  const path = stripHashPrefix(hash);
  return sanitizeReturnTo(path, FALLBACK_RETURN_TO);
}

export function toHash(returnTo: string): string {
  return `#${sanitizeReturnTo(returnTo)}`;
}

export function loginHashFor(returnTo: string): string {
  return `#/login?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`;
}
