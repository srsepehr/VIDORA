export const ADMIN_ROLES = [
  "super_admin",
  "operations",
  "support",
  "analyst",
  "content_manager",
  "finance",
] as const;

export type AdminRole = (typeof ADMIN_ROLES)[number];

export const ADMIN_PERMISSIONS = {
  overviewRead: "overview.read",
  usersRead: "users.read",
  usersPiiRead: "users.pii.read",
  usersSuspend: "users.suspend",
  subscriptionsRead: "subscriptions.read",
  subscriptionsAddDays: "subscriptions.days.add",
  subscriptionsRemoveDays: "subscriptions.days.remove",
  subscriptionsChangePlan: "subscriptions.plan.change",
  subscriptionsCancel: "subscriptions.cancel",
  paymentsRead: "payments.read",
  paymentsExport: "payments.export",
  paymentsRefund: "payments.refund",
  videosRead: "videos.read",
  videosManage: "videos.manage",
  analyticsRead: "analytics.read",
  jobsRead: "jobs.read",
  jobsRetry: "jobs.retry",
  systemRead: "system.read",
  auditRead: "audit.read",
  teamRead: "team.read",
  teamManage: "team.manage",
  settingsRead: "settings.read",
  settingsManage: "settings.manage",
} as const;

export type AdminPermission = (typeof ADMIN_PERMISSIONS)[keyof typeof ADMIN_PERMISSIONS];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "مدیر ارشد",
  operations: "عملیات",
  support: "پشتیبانی",
  analyst: "تحلیل‌گر",
  content_manager: "مدیر محتوا",
  finance: "مالی",
};

export interface AdminContext {
  userId: string;
  role: AdminRole;
  roleLabelFa: string;
  permissions: AdminPermission[];
  membershipStatus: "active";
}

export function hasAdminPermission(
  context: Pick<AdminContext, "permissions"> | null | undefined,
  permission: AdminPermission,
): boolean {
  return Boolean(context?.permissions.includes(permission));
}

export function isAdminRole(value: unknown): value is AdminRole {
  return typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);
}
