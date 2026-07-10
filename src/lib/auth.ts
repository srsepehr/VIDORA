import { AppError, logAppError, mapSupabaseAuthError, toAppError, validateEmail, validatePassword } from "./app-error";
import { getBrowserEnv } from "./env";

export interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: {
    display_name?: string;
    full_name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
  app_metadata?: Record<string, unknown>;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: SupabaseUser;
}

interface AuthResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: SupabaseUser;
}

export type SignUpResult =
  | { session: AuthSession; emailConfirmationRequired: false }
  | { session: null; emailConfirmationRequired: true; email: string };

const SESSION_KEY = "vidora.supabase.session.v1";
const listeners = new Set<(session: AuthSession | null) => void>();
let refreshInFlight: Promise<AuthSession | null> | null = null;

function authHeaders(token?: string): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${token || env.supabaseAnonKey}`,
    "Content-Type": "application/json",
  };
}

function normalizeSession(payload: AuthResponse): AuthSession {
  if (!payload.access_token || !payload.refresh_token || !payload.user) {
    throw new AppError({
      code: "UNKNOWN_SERVER_ERROR",
      httpStatus: 500,
      messageFa: "پاسخ احراز هویت کامل نبود. لطفاً دوباره تلاش کنید.",
      retryable: true,
      logMessage: "Supabase auth response missing session fields",
    });
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: payload.expires_at || nowSeconds + Number(payload.expires_in || 3600),
    user: payload.user,
  };
}

function saveSession(session: AuthSession | null): void {
  if (session) window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else window.sessionStorage.removeItem(SESSION_KEY);
  listeners.forEach((listener) => listener(session));
}

export function getCachedSession(): AuthSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthSession;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function subscribeAuthState(listener: (session: AuthSession | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function requestAuth(path: string, body: Record<string, unknown>, token?: string): Promise<AuthResponse> {
  const env = getBrowserEnv();
  const response = await fetch(`${env.supabaseUrl}${path}`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as AuthResponse;
  if (!response.ok) throw mapSupabaseAuthError(response.status, payload);
  return payload;
}

function preferLatestSession(session: AuthSession | null): AuthSession | null {
  const cached = getCachedSession();
  if (!session) return cached;
  if (!cached || cached.user.id !== session.user.id) return session;
  return cached;
}

function sessionExpiredError(): AppError {
  return new AppError({
    code: "SESSION_EXPIRED",
    httpStatus: 401,
    messageFa: "نشست شما منقضی شده است. لطفاً دوباره وارد شوید.",
    retryable: false,
    logMessage: "No valid Supabase session is available",
  });
}

export async function refreshAuthSession(
  session = getCachedSession(),
  options: { force?: boolean } = {},
): Promise<AuthSession | null> {
  const candidate = preferLatestSession(session);
  if (!candidate) return null;

  const now = Math.floor(Date.now() / 1000);
  if (!options.force && candidate.expiresAt > now + 60) return candidate;
  if (refreshInFlight) return refreshInFlight;

  refreshInFlight = (async () => {
    try {
      const payload = await requestAuth("/auth/v1/token?grant_type=refresh_token", {
        refresh_token: candidate.refreshToken,
      });
      const next = normalizeSession(payload);
      saveSession(next);
      return next;
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "refreshAuthSession");

      // A second refresh may already have rotated the token. Never erase that
      // newer session because an older refresh request failed.
      const latest = getCachedSession();
      if (latest && latest.user.id === candidate.user.id && latest.refreshToken !== candidate.refreshToken) {
        return latest;
      }
      saveSession(null);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function getValidAuthSession(session = getCachedSession()): Promise<AuthSession> {
  const active = await refreshAuthSession(session);
  if (!active) throw sessionExpiredError();
  return active;
}

export async function fetchWithAuth(
  session: AuthSession,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const env = getBrowserEnv();
  const run = (active: AuthSession) => {
    const headers = new Headers(init.headers);
    headers.set("apikey", env.supabaseAnonKey);
    headers.set("Authorization", `Bearer ${active.accessToken}`);
    return fetch(input, { ...init, headers });
  };

  let active = await getValidAuthSession(session);
  let response = await run(active);
  if (response.status !== 401 && response.status !== 403) return response;

  // The server can reject a token before its local expiry (rotation, clock
  // skew, or revocation). Force one refresh and retry exactly once.
  active = await refreshAuthSession(active, { force: true }) as AuthSession;
  if (!active) throw sessionExpiredError();
  response = await run(active);
  return response;
}

export async function restoreAuthSession(): Promise<AuthSession | null> {
  return refreshAuthSession(getCachedSession());
}

export async function signInWithPassword(email: string, password: string): Promise<AuthSession> {
  const emailError = validateEmail(email);
  if (emailError) throw emailError;
  if (!password) {
    throw new AppError({
      code: "INVALID_PASSWORD",
      httpStatus: 400,
      messageFa: "رمز عبور را وارد کنید.",
      retryable: false,
      logMessage: "Missing password",
    });
  }

  const payload = await requestAuth("/auth/v1/token?grant_type=password", {
    email: email.trim(),
    password,
  });
  const session = normalizeSession(payload);
  saveSession(session);
  return session;
}

export async function signUpWithPassword(input: { email: string; password: string; displayName: string }): Promise<SignUpResult> {
  const emailError = validateEmail(input.email);
  if (emailError) throw emailError;
  const passwordError = validatePassword(input.password);
  if (passwordError) throw passwordError;

  const payload = await requestAuth("/auth/v1/signup", {
    email: input.email.trim(),
    password: input.password,
    data: { display_name: input.displayName.trim() || null },
  });
  if (payload.user && (!payload.access_token || !payload.refresh_token)) {
    saveSession(null);
    return { session: null, emailConfirmationRequired: true, email: input.email.trim() };
  }
  const session = normalizeSession(payload);
  saveSession(session);
  return { session, emailConfirmationRequired: false };
}

export async function signOut(): Promise<void> {
  const session = getCachedSession();
  try {
    if (session) {
      const env = getBrowserEnv();
      await fetch(`${env.supabaseUrl}/auth/v1/logout`, {
        method: "POST",
        headers: authHeaders(session.accessToken),
      });
    }
  } catch (error) {
    logAppError(toAppError(error), "signOut");
  } finally {
    saveSession(null);
  }
}

export function getDisplayName(session: AuthSession | null): string {
  return session?.user.user_metadata?.display_name || session?.user.user_metadata?.full_name || session?.user.email?.split("@")[0] || "Vidora";
}

export function getUserEmail(session: AuthSession | null): string {
  return session?.user.email || "";
}
