// Product-level access policy. New paid operations resolve the current
// server-trusted subscription; ownership of existing private records remains
// enforced independently by RLS and private storage paths.
import type { AuthSession } from "./auth";
import { getCachedSession } from "./auth";
import { fetchActiveSubscription } from "./user-data";
import { isSubscriptionActive } from "./subscription-access";

export interface AccessDecision {
  allowed: boolean;
  /** Stable machine reason, e.g. "AUTH_REQUIRED"; empty when allowed. */
  reason: string;
  /** Persian message safe to show the user; empty when allowed. */
  messageFa: string;
}

export interface ProductAccessPolicy {
  canUploadVideo(userId: string): Promise<AccessDecision>;
  canSubmitVideoUrl(userId: string): Promise<AccessDecision>;
  canViewProcessedVideo(userId: string, videoId: string): Promise<AccessDecision>;
}

const ALLOWED: AccessDecision = { allowed: true, reason: "", messageFa: "" };
const AUTH_REQUIRED: AccessDecision = {
  allowed: false,
  reason: "AUTH_REQUIRED",
  messageFa: "برای ادامه ابتدا وارد حساب خود شوید.",
};
const SUBSCRIPTION_REQUIRED: AccessDecision = {
  allowed: false,
  reason: "SUBSCRIPTION_REQUIRED",
  messageFa: "برای افزودن و پردازش ویدیوی جدید، اشتراک فعال ویدورا لازم است.",
};

function sessionUserId(session: AuthSession | null): string {
  return session?.user.id || "";
}

/**
 * Test/compatibility policy: any authenticated user is allowed. Production
 * uses SubscriptionAwareAccessPolicy below.
 */
export class AllowAuthenticatedAccessPolicy implements ProductAccessPolicy {
  constructor(private readonly resolveSession: () => AuthSession | null = getCachedSession) {}

  private decide(userId: string): AccessDecision {
    const session = this.resolveSession();
    if (!session || !sessionUserId(session) || sessionUserId(session) !== userId) return AUTH_REQUIRED;
    return ALLOWED;
  }

  async canUploadVideo(userId: string): Promise<AccessDecision> {
    return this.decide(userId);
  }

  async canSubmitVideoUrl(userId: string): Promise<AccessDecision> {
    return this.decide(userId);
  }

  async canViewProcessedVideo(userId: string, _videoId: string): Promise<AccessDecision> {
    // Record-level ownership is enforced by RLS; a non-owned videoId simply
    // does not resolve. Feature-level access only requires authentication.
    return this.decide(userId);
  }
}

export class SubscriptionAwareAccessPolicy implements ProductAccessPolicy {
  constructor(
    private readonly resolveSession: () => AuthSession | null = getCachedSession,
    private readonly resolveSubscription = fetchActiveSubscription,
  ) {}

  private sessionFor(userId: string): AuthSession | null {
    const session = this.resolveSession();
    return session && sessionUserId(session) === userId ? session : null;
  }

  private async paidAction(userId: string): Promise<AccessDecision> {
    const session = this.sessionFor(userId);
    if (!session) return AUTH_REQUIRED;
    const subscription = await this.resolveSubscription(session);
    return isSubscriptionActive(subscription) ? ALLOWED : SUBSCRIPTION_REQUIRED;
  }

  async canUploadVideo(userId: string): Promise<AccessDecision> {
    return this.paidAction(userId);
  }

  async canSubmitVideoUrl(userId: string): Promise<AccessDecision> {
    return this.paidAction(userId);
  }

  async canViewProcessedVideo(userId: string, _videoId: string): Promise<AccessDecision> {
    // Existing private outputs remain owner-accessible. RLS and storage paths
    // enforce ownership; a subscription never grants access to another user.
    return this.sessionFor(userId) ? ALLOWED : AUTH_REQUIRED;
  }
}

let activePolicy: ProductAccessPolicy = new SubscriptionAwareAccessPolicy();

export function getAccessPolicy(): ProductAccessPolicy {
  return activePolicy;
}

/** Swap point for the future subscription-aware policy (and for tests). */
export function setAccessPolicy(policy: ProductAccessPolicy): void {
  activePolicy = policy;
}
