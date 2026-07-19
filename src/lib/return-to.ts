import { ROUTES } from "./routes";

const FALLBACK_RETURN_TO = ROUTES.dashboard;

function stripHashPrefix(value: string): string {
  return value.startsWith("#") ? value.slice(1) : value;
}

export function sanitizeReturnTo(raw: string | null | undefined, fallback: string = FALLBACK_RETURN_TO): string {
  if (!raw) return fallback;
  let decoded = raw.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return fallback;
    }
  }
  decoded = stripHashPrefix(decoded.trim());

  if (!decoded.startsWith("/") || decoded.startsWith("//") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded) || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return fallback;
  }

  const [path, query = ""] = decoded.split("?", 2);
  const safePaths = [
    /^\/admin(?:\/(?:users(?:\/[0-9a-f-]{36})?|subscriptions|payments|videos(?:\/[0-9a-f-]{36})?|analytics\/videos|analytics\/funnels|translation-jobs|system|audit-log|team|settings))?$/,
    /^\/dashboard(\/(new-translation|videos(?:\/[0-9a-f-]{36})?|saved|subscription|support|settings|profile))?$/,
    /^\/library(\/category\/[a-z0-9-]+)?$/,
    /^\/watch\/[a-z0-9-]+$/,
    /^\/subscriptions$/,
    /^\/checkout$/,
    /^\/search$/,
    /^\/$/,
  ];

  if (!safePaths.some((pattern) => pattern.test(path))) return fallback;
  if (!query) return path;

  const input = new URLSearchParams(query);
  const output = new URLSearchParams();
  const allowed = path === "/search" || path === "/admin/users" ? new Set(["q"]) : path === "/subscriptions" || path === "/checkout" ? new Set(["plan"]) : new Set<string>();
  for (const [key, value] of input.entries()) {
    if (!allowed.has(key)) return fallback;
    if (key === "plan" && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value)) return fallback;
    if (key === "q" && (value.length > 160 || /(?:javascript:|https?:|\/\/|\\)/i.test(value))) return fallback;
    output.append(key, value);
  }
  const safeQuery = output.toString();
  return safeQuery ? `${path}?${safeQuery}` : path;
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
