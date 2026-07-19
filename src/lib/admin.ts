import { AppError } from "./app-error";
import { fetchWithAuth, type AuthSession } from "./auth";
import { getBrowserEnv } from "./env";
import {
  ADMIN_ROLE_LABELS,
  isAdminRole,
  type AdminContext,
  type AdminPermission,
  type AdminRole,
} from "./admin-permissions";

export interface AdminPage<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
  pageCount: number;
}

export interface AdminMetric {
  key: string;
  value: number | null;
  previous: number | null;
  unit: "count" | "percent" | "seconds" | "currency";
  currency?: string | null;
}

export interface AdminOverview {
  from: string;
  to: string;
  previousFrom: string;
  previousTo: string;
  metrics: AdminMetric[];
  series: Array<{
    date: string;
    newUsers: number;
    activeUsers: number;
    revenue: number;
    videoStarts: number;
    videoCompletions: number;
    translationRequests: number;
    translationFailures: number;
  }>;
  incidents: AdminSystemIncident[];
  recentAudit: AdminAuditRow[];
}

export interface AdminUserRow {
  id: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  lastActivityAt: string | null;
  accountStatus: "active" | "suspended";
  acquisitionSource: string | null;
  subscriptionStatus: string | null;
  planNameFa: string | null;
  subscriptionEndsAt: string | null;
  remainingDays: number | null;
  watchedVideos: number;
  watchSeconds: number;
  uploadedVideos: number;
  completedTranslations: number;
  failedTranslations: number;
}

export interface AdminUserDetail {
  user: AdminUserRow & {
    lifetimePaymentAmount: number;
    paymentCurrency: string | null;
    referrer: string | null;
    campaign: string | null;
  };
  subscriptionTimeline: AdminSubscriptionAdjustment[];
  activity: AdminActivityRow[];
  videos: AdminVideoRow[];
}

export interface AdminSubscriptionRow {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  planId: string;
  planNameFa: string;
  planSlug: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  remainingDays: number | null;
  includedMinutes: number;
  usedMinutes: number;
  paymentReference: string | null;
  lastModificationSource: string;
  updatedAt: string;
}

export interface AdminSubscriptionAdjustment {
  id: string;
  subscriptionId: string;
  userId: string;
  adjustmentType: string;
  daysDelta: number;
  previousEndsAt: string | null;
  newEndsAt: string | null;
  reason: string;
  actorUserId: string;
  actorRole: AdminRole;
  requestId: string;
  createdAt: string;
}

export interface AdminPaymentRow {
  id: string;
  userId: string;
  displayName: string | null;
  email: string | null;
  subscriptionId: string | null;
  provider: string;
  providerReference: string;
  status: string;
  amount: number;
  currency: string;
  discountAmount: number;
  createdAt: string;
  settledAt: string | null;
  failureCode: string | null;
}

export interface AdminVideoRow {
  id: string;
  kind: "library" | "user";
  userId: string | null;
  ownerName: string | null;
  title: string | null;
  sourceType: string | null;
  category: string | null;
  status: string;
  isPublished: boolean | null;
  isFeatured: boolean | null;
  durationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  starts: number;
  completionRate: number | null;
  averageWatchSeconds: number | null;
}

export interface AdminJobRow {
  id: string;
  userId: string;
  userLabel: string | null;
  videoId: string;
  videoTitle: string | null;
  inputType: string;
  provider: string | null;
  model: string | null;
  status: string;
  stage: string;
  progressPercent: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  processingSeconds: number | null;
  attempt: number;
  maxAttempts: number;
  failureCode: string | null;
  failureMessage: string | null;
  correlationId: string | null;
  estimatedCost: number | null;
}

export interface AdminAuditRow {
  id: string;
  actorUserId: string;
  actorRole: AdminRole;
  actionType: string;
  targetEntityType: string;
  targetEntityId: string | null;
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string;
  requestId: string;
  userAgent: string | null;
  success: boolean;
  failureCode: string | null;
  createdAt: string;
}

export interface AdminTeamRow {
  userId: string;
  displayName: string | null;
  email: string | null;
  role: AdminRole;
  status: "active" | "suspended";
  createdAt: string;
  invitedBy: string | null;
  lastAdminActivityAt: string | null;
}

export interface AdminActivityRow {
  id: string;
  eventName: string;
  occurredAt: string;
  videoId: string | null;
  processingJobId: string | null;
  properties: Record<string, unknown>;
}

export interface AdminRetentionPoint {
  bucket: number;
  sessions: number;
  retentionPercent: number;
}

export interface AdminVideoAnalytics {
  videoId: string | null;
  validSessions: number;
  starts: number;
  uniqueViewers: number;
  totalWatchSeconds: number;
  averageWatchSeconds: number | null;
  medianWatchSeconds: number | null;
  completionRate: number | null;
  rewatchRate: number | null;
  subtitleActivationRate: number | null;
  summaryOpenRate: number | null;
  largestDropoffBucket: number | null;
  retention: AdminRetentionPoint[];
}

export interface AdminFunnelStep {
  key: string;
  labelFa: string;
  users: number;
  stepConversion: number | null;
  totalConversion: number | null;
  dropoff: number;
  medianSecondsToNext: number | null;
}

export interface AdminFunnel {
  name: string;
  identityDefinition: string;
  steps: AdminFunnelStep[];
}

export interface AdminSystemIncident {
  id: string;
  title: string;
  status: string;
  severity: string;
  startedAt: string;
}

export interface AdminSystemHealth {
  queueDepth: number;
  oldestQueuedAt: string | null;
  runningJobs: number;
  failedJobs: number;
  translationFailureRate: number | null;
  averageProcessingSeconds: number | null;
  providerFailures: Array<{ provider: string; failed: number; total: number }>;
  incidents: AdminSystemIncident[];
}

export interface AdminMutationResult {
  ok: boolean;
  code: string;
  messageFa: string;
  auditId: string | null;
  entity?: Record<string, unknown> | null;
}

function rpcHeaders(session: AuthSession): HeadersInit {
  const env = getBrowserEnv();
  return {
    apikey: env.supabaseAnonKey,
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function rpc<T>(
  session: AuthSession,
  functionName: string,
  body: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const env = getBrowserEnv();
  const response = await fetchWithAuth(session, `${env.supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: rpcHeaders(session),
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const serverCode = typeof payload?.code === "string" ? payload.code : "";
    const forbidden = response.status === 401 || response.status === 403 || serverCode === "42501";
    throw new AppError({
      code: forbidden ? "UNAUTHORIZED" : "DATABASE_FAILURE",
      httpStatus: forbidden ? 403 : response.status,
      messageFa: forbidden
        ? "شما مجوز دسترسی به این بخش مدیریتی را ندارید."
        : "دریافت اطلاعات مدیریتی با خطا مواجه شد.",
      retryable: response.status >= 500,
      logMessage: `Admin RPC ${functionName} failed with ${response.status}/${serverCode || "unknown"}`,
    });
  }
  return payload as T;
}

function normalizePage<T>(payload: Partial<AdminPage<T>>): AdminPage<T> {
  const page = Math.max(1, Number(payload.page || 1));
  const perPage = Math.max(1, Number(payload.perPage || 25));
  const total = Math.max(0, Number(payload.total || 0));
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    page,
    perPage,
    total,
    pageCount: Math.max(1, Number(payload.pageCount || Math.ceil(total / perPage) || 1)),
  };
}

export async function fetchAdminContext(session: AuthSession, signal?: AbortSignal): Promise<AdminContext> {
  const payload = await rpc<{
    userId: string;
    role: string;
    roleLabelFa?: string;
    permissions: string[];
    membershipStatus: string;
  }>(session, "admin_get_context", {}, signal);
  if (!isAdminRole(payload.role) || payload.membershipStatus !== "active") {
    throw new AppError({
      code: "UNAUTHORIZED",
      httpStatus: 403,
      messageFa: "دسترسی مدیریتی برای این حساب فعال نیست.",
      retryable: false,
      logMessage: "Admin context returned an invalid or inactive role",
    });
  }
  return {
    userId: payload.userId,
    role: payload.role,
    roleLabelFa: payload.roleLabelFa || ADMIN_ROLE_LABELS[payload.role],
    permissions: payload.permissions as AdminPermission[],
    membershipStatus: "active",
  };
}

export const adminApi = {
  overview: (session: AuthSession, from: string, to: string, signal?: AbortSignal) =>
    rpc<AdminOverview>(session, "admin_get_overview", { p_from: from, p_to: to }, signal),

  users: async (session: AuthSession, input: { search?: string; filters?: Record<string, unknown>; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminUserRow>>(session, "admin_list_users", {
      p_search: input.search || null,
      p_filters: input.filters || {},
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  userDetail: (session: AuthSession, userId: string, signal?: AbortSignal) =>
    rpc<AdminUserDetail>(session, "admin_get_user_detail", { p_user_id: userId }, signal),

  subscriptions: async (session: AuthSession, input: { search?: string; status?: string; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminSubscriptionRow>>(session, "admin_list_subscriptions", {
      p_search: input.search || null,
      p_status: input.status || null,
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  payments: async (session: AuthSession, input: { status?: string; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminPaymentRow>>(session, "admin_list_payments", {
      p_status: input.status || null,
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  videos: async (session: AuthSession, input: { kind?: string; status?: string; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminVideoRow>>(session, "admin_list_videos", {
      p_kind: input.kind || "all",
      p_status: input.status || null,
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  jobs: async (session: AuthSession, input: { status?: string; longRunning?: boolean; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminJobRow>>(session, "admin_list_translation_jobs", {
      p_status: input.status || null,
      p_long_running: Boolean(input.longRunning),
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  audits: async (session: AuthSession, input: { search?: string; success?: boolean; page?: number; perPage?: number }, signal?: AbortSignal) =>
    normalizePage(await rpc<AdminPage<AdminAuditRow>>(session, "admin_list_audit_logs", {
      p_search: input.search || null,
      p_success: input.success ?? null,
      p_page: input.page || 1,
      p_per_page: input.perPage || 25,
    }, signal)),

  team: (session: AuthSession, signal?: AbortSignal) =>
    rpc<{ items: AdminTeamRow[] }>(session, "admin_list_team", {}, signal),

  videoAnalytics: (session: AuthSession, input: { videoId?: string; from: string; to: string }, signal?: AbortSignal) =>
    rpc<AdminVideoAnalytics>(session, "admin_get_video_analytics", {
      p_video_id: input.videoId || null,
      p_from: input.from,
      p_to: input.to,
    }, signal),

  funnel: (session: AuthSession, input: { name: string; from: string; to: string }, signal?: AbortSignal) =>
    rpc<AdminFunnel>(session, "admin_get_funnel", { p_name: input.name, p_from: input.from, p_to: input.to }, signal),

  systemHealth: (session: AuthSession, from: string, to: string, signal?: AbortSignal) =>
    rpc<AdminSystemHealth>(session, "admin_get_system_health", { p_from: from, p_to: to }, signal),

  adjustSubscription: (session: AuthSession, input: { userId: string; days: number; reason: string; requestId: string; userAgent: string }) =>
    rpc<AdminMutationResult>(session, "admin_adjust_subscription_days", {
      p_user_id: input.userId,
      p_days: input.days,
      p_reason: input.reason,
      p_request_id: input.requestId,
      p_user_agent: input.userAgent,
    }),

  setUserStatus: (session: AuthSession, input: { userId: string; status: "active" | "suspended"; reason: string; requestId: string; userAgent: string }) =>
    rpc<AdminMutationResult>(session, "admin_set_user_status", {
      p_user_id: input.userId,
      p_status: input.status,
      p_reason: input.reason,
      p_request_id: input.requestId,
      p_user_agent: input.userAgent,
    }),

  retryJob: (session: AuthSession, input: { jobId: string; reason: string; requestId: string; userAgent: string }) =>
    rpc<AdminMutationResult>(session, "admin_retry_translation_job", {
      p_job_id: input.jobId,
      p_reason: input.reason,
      p_request_id: input.requestId,
      p_user_agent: input.userAgent,
    }),

  setLibraryPublication: (session: AuthSession, input: { videoId: string; published: boolean; reason: string; requestId: string; userAgent: string }) =>
    rpc<AdminMutationResult>(session, "admin_set_library_video_publication", {
      p_video_id: input.videoId,
      p_published: input.published,
      p_reason: input.reason,
      p_request_id: input.requestId,
      p_user_agent: input.userAgent,
    }),

  setTeamMember: (session: AuthSession, input: { userId: string; role: AdminRole; status: "active" | "suspended"; reason: string; requestId: string; userAgent: string }) =>
    rpc<AdminMutationResult>(session, "admin_set_team_member", {
      p_user_id: input.userId,
      p_role: input.role,
      p_status: input.status,
      p_reason: input.reason,
      p_request_id: input.requestId,
      p_user_agent: input.userAgent,
    }),
};
