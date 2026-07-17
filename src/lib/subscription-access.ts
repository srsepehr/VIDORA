import type { AuthSession } from "./auth";
import type { SubscriptionSummary } from "./user-data";

export type SubscriptionState = "loading" | "guest" | "active" | "inactive";
export type AccessReason = "AUTH_REQUIRED" | "SUBSCRIPTION_REQUIRED" | "ALLOWED";

export interface EntitlementDecision {
  allowed: boolean;
  reason: AccessReason;
  messageFa: string;
}

const ALLOWED: EntitlementDecision = { allowed: true, reason: "ALLOWED", messageFa: "" };

export function isSubscriptionActive(subscription: SubscriptionSummary | null, now = Date.now()): boolean {
  if (!subscription || subscription.status !== "active") return false;
  if (!subscription.starts_at && !subscription.ends_at) return true;
  const startsAt = subscription.starts_at ? Date.parse(subscription.starts_at) : null;
  const endsAt = subscription.ends_at ? Date.parse(subscription.ends_at) : null;
  if ((startsAt !== null && !Number.isFinite(startsAt)) || (endsAt !== null && !Number.isFinite(endsAt))) return false;
  return (startsAt === null || startsAt <= now) && (endsAt === null || endsAt > now);
}

export function resolveSubscriptionState(input: {
  loading: boolean;
  session: AuthSession | null;
  subscription: SubscriptionSummary | null;
  now?: number;
}): SubscriptionState {
  if (input.loading) return "loading";
  if (!input.session) return "guest";
  return isSubscriptionActive(input.subscription, input.now) ? "active" : "inactive";
}

export function requireActiveSubscription(state: SubscriptionState): EntitlementDecision {
  if (state === "active") return ALLOWED;
  if (state === "guest") {
    return { allowed: false, reason: "AUTH_REQUIRED", messageFa: "برای ادامه ابتدا وارد حساب خود شوید." };
  }
  return {
    allowed: false,
    reason: "SUBSCRIPTION_REQUIRED",
    messageFa: "برای استفاده از این بخش، اشتراک فعال ویدورا لازم است.",
  };
}

export const canWatchLibraryVideo = requireActiveSubscription;
export const canAddVideo = requireActiveSubscription;
