import { AppError } from "./app-error";

export interface RawBrowserEnv {
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_APP_URL?: string;
}

export interface ResolvedBrowserEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function isPlaceholderValue(value: string): boolean {
  return /^(your-|replace-|changeme|todo)/i.test(value) || value.includes("your-project-ref");
}

export function resolveBrowserEnv(raw: RawBrowserEnv, fallbackAppUrl: string): ResolvedBrowserEnv {
  const supabaseUrl = raw.VITE_SUPABASE_URL?.trim() || "";
  const supabaseAnonKey = raw.VITE_SUPABASE_ANON_KEY?.trim() || "";
  const appUrl = raw.VITE_APP_URL?.trim() || fallbackAppUrl;

  if (!supabaseUrl || !supabaseAnonKey || isPlaceholderValue(supabaseUrl) || isPlaceholderValue(supabaseAnonKey)) {
    throw new AppError({
      code: "CONFIG_MISSING",
      httpStatus: 500,
      messageFa: "اتصال به سرویس احراز هویت پیکربندی نشده است.",
      retryable: false,
      logMessage: "Missing or placeholder VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY",
    });
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Invalid protocol");
  } catch (cause) {
    throw new AppError({
      code: "CONFIG_INVALID",
      httpStatus: 500,
      messageFa: "اتصال به سرویس احراز هویت پیکربندی نشده است.",
      retryable: false,
      logMessage: "Invalid VITE_SUPABASE_URL",
      cause,
    });
  }

  return {
    supabaseUrl: trimTrailingSlash(supabaseUrl),
    supabaseAnonKey,
    appUrl: trimTrailingSlash(appUrl),
  };
}

export function hasUsableBrowserEnv(raw: RawBrowserEnv): boolean {
  const supabaseUrl = raw.VITE_SUPABASE_URL?.trim() || "";
  const anonKey = raw.VITE_SUPABASE_ANON_KEY?.trim() || "";
  return Boolean(supabaseUrl && anonKey && !isPlaceholderValue(supabaseUrl) && !isPlaceholderValue(anonKey));
}
