// Temporary product access policy. Until pricing ships, every authenticated
// user may upload and submit videos; ownership stays enforced by RLS. This
// abstraction is the single seam where plan/subscription checks will plug in
// later — upload and processing flows must only ever consult this policy and
// never hardcode access rules.
import type { AuthSession } from "./auth";
import { getCachedSession } from "./auth";

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

function sessionUserId(session: AuthSession | null): string {
  return session?.user.id || "";
}

/**
 * Development-phase policy: any authenticated user is allowed. Ownership of
 * specific records is still enforced by RLS at the data layer; this policy
 * only answers the product-level "may this user use the feature" question.
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

let activePolicy: ProductAccessPolicy = new AllowAuthenticatedAccessPolicy();

export function getAccessPolicy(): ProductAccessPolicy {
  return activePolicy;
}

/** Swap point for the future subscription-aware policy (and for tests). */
export function setAccessPolicy(policy: ProductAccessPolicy): void {
  activePolicy = policy;
}
