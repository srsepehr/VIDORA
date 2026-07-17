import { sanitizeReturnTo } from "./return-to";
import { ROUTES } from "./routes";

export const AUTH_INTENTS = ["general-entry", "watch-video", "buy-subscription", "add-video"] as const;
export type AuthIntentName = (typeof AUTH_INTENTS)[number];

export interface AuthIntent {
  intent: AuthIntentName;
  returnTo: string;
  planSlug?: string;
  createdAt: number;
  expiresAt: number;
}

const STORAGE_KEY = "vidora.auth.intent.v1";
const INTENT_TTL_MS = 30 * 60 * 1000;
const PLAN_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function isAuthIntentName(value: unknown): value is AuthIntentName {
  return typeof value === "string" && (AUTH_INTENTS as readonly string[]).includes(value);
}

export function sanitizePlanSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return PLAN_SLUG.test(normalized) ? normalized : undefined;
}

export function createAuthIntent(input: {
  intent: AuthIntentName;
  returnTo?: string;
  planSlug?: string;
  now?: number;
}): AuthIntent {
  const now = input.now ?? Date.now();
  return {
    intent: input.intent,
    returnTo: sanitizeReturnTo(input.returnTo, ROUTES.dashboard),
    ...(sanitizePlanSlug(input.planSlug) ? { planSlug: sanitizePlanSlug(input.planSlug) } : {}),
    createdAt: now,
    expiresAt: now + INTENT_TTL_MS,
  };
}

export function persistAuthIntent(intent: AuthIntent): AuthIntent {
  storage()?.setItem(STORAGE_KEY, JSON.stringify(intent));
  return intent;
}

export function readAuthIntent(now = Date.now()): AuthIntent | null {
  const value = storage()?.getItem(STORAGE_KEY);
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AuthIntent>;
    if (!isAuthIntentName(parsed.intent) || typeof parsed.expiresAt !== "number" || parsed.expiresAt <= now) {
      clearAuthIntent();
      return null;
    }
    const planSlug = sanitizePlanSlug(parsed.planSlug);
    return {
      intent: parsed.intent,
      returnTo: sanitizeReturnTo(parsed.returnTo, ROUTES.dashboard),
      ...(planSlug ? { planSlug } : {}),
      createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : now,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    clearAuthIntent();
    return null;
  }
}

export function consumeAuthIntent(now = Date.now()): AuthIntent | null {
  const value = readAuthIntent(now);
  clearAuthIntent();
  return value;
}

export function clearAuthIntent(): void {
  storage()?.removeItem(STORAGE_KEY);
}

export function buildAuthHash(input: {
  intent: AuthIntentName;
  returnTo?: string;
  planSlug?: string;
  mode?: "login" | "signup";
}): string {
  const record = persistAuthIntent(createAuthIntent(input));
  const params = new URLSearchParams({ returnTo: record.returnTo, intent: record.intent });
  if (record.planSlug) params.set("plan", record.planSlug);
  return `#/${input.mode === "signup" ? "signup" : "login"}?${params.toString()}`;
}

export function readAuthIntentFromHash(): AuthIntent {
  const query = typeof window === "undefined" ? "" : window.location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const stored = readAuthIntent();
  const intent = isAuthIntentName(params.get("intent")) ? params.get("intent") as AuthIntentName : stored?.intent || "general-entry";
  const returnTo = sanitizeReturnTo(params.get("returnTo") || stored?.returnTo, ROUTES.dashboard);
  const planSlug = sanitizePlanSlug(params.get("plan")) || stored?.planSlug;
  return createAuthIntent({ intent, returnTo, planSlug });
}
