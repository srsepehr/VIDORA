import { hasUsableBrowserEnv, resolveBrowserEnv } from "./env-core";

export interface BrowserEnv {
  supabaseUrl: string;
  supabaseAnonKey: string;
  appUrl: string;
}

let cachedEnv: BrowserEnv | null = null;

export function getBrowserEnv(): BrowserEnv {
  if (cachedEnv) return cachedEnv;

  cachedEnv = resolveBrowserEnv(import.meta.env, window.location.origin);
  return cachedEnv;
}

export function isBackendConfigured(): boolean {
  return hasUsableBrowserEnv(import.meta.env);
}
