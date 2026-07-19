import React from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileClock,
  Gauge,
  LogOut,
  Menu,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AuthSession } from "../lib/auth";
import { getDisplayName, getUserEmail } from "../lib/auth";
import {
  adminApi,
  type AdminAuditRow,
  type AdminFunnel,
  type AdminJobRow,
  type AdminMetric,
  type AdminMutationResult,
  type AdminOverview,
  type AdminPage,
  type AdminPaymentRow,
  type AdminSubscriptionRow,
  type AdminSystemHealth,
  type AdminTeamRow,
  type AdminUserDetail,
  type AdminUserRow,
  type AdminVideoAnalytics,
  type AdminVideoRow,
} from "../lib/admin";
import {
  ADMIN_PERMISSIONS,
  ADMIN_ROLE_LABELS,
  hasAdminPermission,
  type AdminContext,
  type AdminPermission,
  type AdminRole,
} from "../lib/admin-permissions";
import { logAppError, toAppError } from "../lib/app-error";
import "./admin.css";

type RangeKey = "today" | "7d" | "30d" | "month" | "previous-month" | "custom";

interface DateRange {
  key: RangeKey;
  from: string;
  to: string;
}

interface AdminAppProps {
  session: AuthSession;
  context: AdminContext;
  onSignOut: () => void;
}

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission: AdminPermission;
}

const NAV_SECTIONS: Array<{ label: string; items: NavItem[] }> = [
  { label: "نمای کلی", items: [{ label: "مرکز عملیات", href: "#/admin", icon: Gauge, permission: ADMIN_PERMISSIONS.overviewRead }] },
  {
    label: "کاربران و درآمد",
    items: [
      { label: "کاربران", href: "#/admin/users", icon: Users, permission: ADMIN_PERMISSIONS.usersRead },
      { label: "اشتراک‌ها", href: "#/admin/subscriptions", icon: ShieldCheck, permission: ADMIN_PERMISSIONS.subscriptionsRead },
      { label: "پرداخت‌ها", href: "#/admin/payments", icon: CreditCard, permission: ADMIN_PERMISSIONS.paymentsRead },
    ],
  },
  {
    label: "محتوا و تعامل",
    items: [
      { label: "ویدئوها", href: "#/admin/videos", icon: Video, permission: ADMIN_PERMISSIONS.videosRead },
      { label: "تحلیل مشاهده", href: "#/admin/analytics/videos", icon: Activity, permission: ADMIN_PERMISSIONS.analyticsRead },
      { label: "قیف‌ها", href: "#/admin/analytics/funnels", icon: BarChart3, permission: ADMIN_PERMISSIONS.analyticsRead },
    ],
  },
  {
    label: "عملیات",
    items: [
      { label: "پردازش و ترجمه", href: "#/admin/translation-jobs", icon: FileClock, permission: ADMIN_PERMISSIONS.jobsRead },
      { label: "سلامت سیستم", href: "#/admin/system", icon: Activity, permission: ADMIN_PERMISSIONS.systemRead },
    ],
  },
  {
    label: "مدیریت",
    items: [
      { label: "گزارش مدیران", href: "#/admin/audit-log", icon: ClipboardList, permission: ADMIN_PERMISSIONS.auditRead },
      { label: "اعضای تیم", href: "#/admin/team", icon: ShieldCheck, permission: ADMIN_PERMISSIONS.teamRead },
      { label: "تنظیمات", href: "#/admin/settings", icon: Settings, permission: ADMIN_PERMISSIONS.settingsRead },
    ],
  },
];

const METRICS: Record<string, { label: string; definition: string }> = {
  totalUsers: { label: "کل کاربران", definition: "تمام حساب‌هایی که تا پایان بازه ایجاد شده‌اند." },
  newUsers: { label: "کاربران جدید", definition: "حساب‌های ایجادشده در بازه انتخابی." },
  activeUsers: { label: "کاربران فعال", definition: "کاربران یکتایی که یک رویداد معنادار در بازه داشته‌اند." },
  paidUsers: { label: "کاربران پرداخت‌کننده", definition: "کاربران یکتای دارای پرداخت موفق در بازه." },
  activeSubscriptions: { label: "اشتراک فعال", definition: "اشتراک‌های فعال و منقضی‌نشده در پایان بازه." },
  expiredSubscriptions: { label: "اشتراک منقضی", definition: "اشتراک‌هایی که در بازه به پایان رسیده‌اند." },
  conversionRate: { label: "تبدیل رایگان به پولی", definition: "نسبت پرداخت‌کنندگان جدید به کاربران جدید همان بازه." },
  revenue: { label: "درآمد اشتراک", definition: "مبلغ پرداخت‌های موفق منهای تخفیف ثبت‌شده." },
  videoStarts: { label: "شروع ویدئو", definition: "پخش‌هایی که پس از شروع واقعی رسانه ثبت شده‌اند؛ نه بارگذاری صفحه." },
  videoCompletions: { label: "تکمیل ویدئو", definition: "جلساتی که دست‌کم ۹۰٪ زمان ویدئو را به‌صورت معنادار دیده‌اند." },
  averageWatchTime: { label: "میانگین تماشا", definition: "مجموع زمان معنادار تماشا تقسیم بر تعداد شروع‌ها." },
  translationRequests: { label: "درخواست ترجمه", definition: "کارهای پردازشی ایجادشده در بازه." },
  translationSuccessRate: { label: "موفقیت ترجمه", definition: "نسبت کارهای تکمیل‌شده به تمام درخواست‌های بازه." },
  translationFailureRate: { label: "خطای ترجمه", definition: "نسبت کارهای ناموفق به تمام درخواست‌های بازه." },
  averageProcessingTime: { label: "میانگین پردازش", definition: "میانگین فاصله شروع تا پایان کارهای خاتمه‌یافته." },
  estimatedCost: { label: "هزینه تخمینی پردازش", definition: "جمع هزینه‌های ثبت‌شده توسط پردازشگر؛ در نبود داده خالی است." },
};

const STATUS_FA: Record<string, string> = {
  active: "فعال", suspended: "تعلیق", pending: "در انتظار", expired: "منقضی", cancelled: "لغوشده",
  payment_failed: "پرداخت ناموفق", queued: "در صف", running: "در حال اجرا", completed: "تکمیل‌شده",
  failed: "ناموفق", published: "منتشرشده", draft: "پیش‌نویس", archived: "بایگانی", succeeded: "موفق",
  refunded: "بازپرداخت‌شده", partially_refunded: "بازپرداخت جزئی", resolved: "رفع‌شده",
};

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateRange(key: RangeKey, custom?: Pick<DateRange, "from" | "to">): DateRange {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (key === "7d") start.setDate(start.getDate() - 6);
  if (key === "30d") start.setDate(start.getDate() - 29);
  if (key === "month") start.setDate(1);
  if (key === "previous-month") {
    start.setMonth(start.getMonth() - 1, 1);
    end.setDate(0);
    end.setHours(23, 59, 59, 999);
  }
  if (key === "custom" && custom) {
    return { key, from: new Date(`${custom.from}T00:00:00`).toISOString(), to: new Date(`${custom.to}T23:59:59.999`).toISOString() };
  }
  return { key, from: start.toISOString(), to: end.toISOString() };
}

function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fa-IR", includeTime
    ? { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds).toLocaleString("fa-IR")} ثانیه`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours ? `${hours.toLocaleString("fa-IR")} ساعت و ${minutes.toLocaleString("fa-IR")} دقیقه` : `${minutes.toLocaleString("fa-IR")} دقیقه`;
}

function formatMetric(metric: AdminMetric): string {
  if (metric.value === null || metric.value === undefined) return "داده‌ای ثبت نشده";
  if (metric.unit === "percent") return `${Number(metric.value).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪`;
  if (metric.unit === "seconds") return formatDuration(Number(metric.value));
  if (metric.unit === "currency") return new Intl.NumberFormat("fa-IR", { style: "currency", currency: metric.currency || "USD", maximumFractionDigits: 2 }).format(Number(metric.value));
  return Number(metric.value).toLocaleString("fa-IR");
}

function compareMetric(metric: AdminMetric): { text: string; tone: "up" | "down" | "same" } | null {
  if (metric.value === null || metric.previous === null || metric.previous === 0) return null;
  const delta = ((metric.value - metric.previous) / Math.abs(metric.previous)) * 100;
  if (Math.abs(delta) < 0.05) return { text: "بدون تغییر", tone: "same" };
  return { text: `${Math.abs(delta).toLocaleString("fa-IR", { maximumFractionDigits: 1 })}٪ ${delta > 0 ? "افزایش" : "کاهش"}`, tone: delta > 0 ? "up" : "down" };
}

function useHash(): string {
  const [hash, setHash] = React.useState(window.location.hash || "#/admin");
  React.useEffect(() => {
    const listener = () => setHash(window.location.hash || "#/admin");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return hash;
}

function useAdminQuery<T>(load: (signal: AbortSignal) => Promise<T>, dependencies: React.DependencyList) {
  const [state, setState] = React.useState<{ loading: boolean; error: string; data: T | null }>({ loading: true, error: "", data: null });
  const [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: "" }));
    load(controller.signal)
      .then((data) => setState({ loading: false, error: "", data }))
      .catch((error) => {
        if (error?.name === "AbortError") return;
        const appError = toAppError(error);
        logAppError(appError, "AdminApp.query");
        setState({ loading: false, error: appError.messageFa, data: null });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);
  return { ...state, retry: () => setRevision((value) => value + 1) };
}

function useDebounced<T>(value: T, milliseconds = 350): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), milliseconds);
    return () => window.clearTimeout(timer);
  }, [value, milliseconds]);
  return debounced;
}

function Status({ value }: { value: string | null | undefined }) {
  const status = value || "unknown";
  return <span className={`adm-status is-${status.replace(/_/g, "-")}`}>{STATUS_FA[status] || status}</span>;
}

function CopyId({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button className="adm-copy-id" dir="ltr" title={value} onClick={() => {
      void navigator.clipboard?.writeText(value).then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      });
    }}>{copied ? "کپی شد" : value}</button>
  );
}

function StatePanel({ kind, message, onRetry }: { kind: "loading" | "empty" | "error"; message: string; onRetry?: () => void }) {
  const Icon = kind === "error" ? AlertTriangle : kind === "loading" ? RefreshCw : BookOpen;
  return (
    <div className={`adm-state is-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon size={22} className={kind === "loading" ? "adm-spin" : ""} />
      <strong>{message}</strong>
      {onRetry ? <button className="adm-button is-secondary" onClick={onRetry}><RefreshCw size={14} /> تلاش دوباره</button> : null}
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return (
    <header className="adm-page-header">
      <div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>
      {action ? <div className="adm-page-actions">{action}</div> : null}
    </header>
  );
}

function Pagination({ page, pageCount, onPage }: { page: number; pageCount: number; onPage: (page: number) => void }) {
  return (
    <div className="adm-pagination" aria-label="صفحه‌بندی">
      <button disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronRight size={16} /> قبلی</button>
      <span>صفحه {page.toLocaleString("fa-IR")} از {pageCount.toLocaleString("fa-IR")}</span>
      <button disabled={page >= pageCount} onClick={() => onPage(page + 1)}>بعدی <ChevronLeft size={16} /></button>
    </div>
  );
}

function DataTable({ children, label }: { children: React.ReactNode; label: string }) {
  return <div className="adm-table-wrap" role="region" aria-label={label} tabIndex={0}><table className="adm-table">{children}</table></div>;
}

function DateRangeControl({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const [customOpen, setCustomOpen] = React.useState(false);
  const [from, setFrom] = React.useState(isoDay(new Date(value.from)));
  const [to, setTo] = React.useState(isoDay(new Date(value.to)));
  return (
    <div className="adm-range">
      <label><span className="adm-sr-only">بازه زمانی</span><select value={value.key} onChange={(event) => {
        const key = event.target.value as RangeKey;
        if (key === "custom") setCustomOpen(true);
        else { setCustomOpen(false); onChange(dateRange(key)); }
      }}>
        <option value="today">امروز</option><option value="7d">۷ روز اخیر</option><option value="30d">۳۰ روز اخیر</option>
        <option value="month">ماه جاری</option><option value="previous-month">ماه قبل</option><option value="custom">بازه دلخواه</option>
      </select></label>
      {customOpen ? <div className="adm-range-custom"><label>از<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>تا<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button onClick={() => onChange(dateRange("custom", { from, to }))}>اعمال</button></div> : null}
    </div>
  );
}

function MetricCard({ metric }: { metric: AdminMetric }) {
  const meta = METRICS[metric.key] || { label: metric.key, definition: "تعریف این سنجه در سرویس ثبت نشده است." };
  const comparison = compareMetric(metric);
  return (
    <article className="adm-metric" title={meta.definition}>
      <div><span>{meta.label}</span><button aria-label={`تعریف ${meta.label}`}>؟</button></div>
      <strong>{formatMetric(metric)}</strong>
      <small className={comparison ? `is-${comparison.tone}` : ""}>{comparison?.text || "مقایسه قبلی در دسترس نیست"}</small>
    </article>
  );
}

function OperationsChart({ overview }: { overview: AdminOverview }) {
  const values = overview.series.map((item) => item.activeUsers);
  const max = Math.max(...values, 1);
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * 100;
    const y = 94 - (value / max) * 82;
    return `${x},${y}`;
  }).join(" ");
  return (
    <article className="adm-chart-card">
      <header><div><span>روند فعالیت</span><h2>کاربران فعال روزانه</h2></div><small>{formatDate(overview.from)} تا {formatDate(overview.to)}</small></header>
      {overview.series.length ? <div className="adm-line-chart" role="img" aria-label="نمودار کاربران فعال روزانه">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="M0 94H100" /><polyline points={points} /></svg>
        <div>{overview.series.map((item) => <span key={item.date} title={`${formatDate(item.date)}: ${item.activeUsers.toLocaleString("fa-IR")}`} style={{ height: `${Math.max(2, (item.activeUsers / max) * 100)}%` }} />)}</div>
      </div> : <StatePanel kind="empty" message="در این بازه رویداد فعالیت ثبت نشده است." />}
    </article>
  );
}

interface ConfirmState {
  title: string;
  target: string;
  current: string;
  proposed: string;
  result: string;
  actionLabel: string;
  onConfirm: (reason: string) => Promise<AdminMutationResult>;
}

function ConfirmationDialog({ state, onClose, onDone }: { state: ConfirmState; onClose: () => void; onDone: (result: AdminMutationResult) => void }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const reasonRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    reasonRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  return (
    <div className="adm-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="adm-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-confirm-title">
        <header><div><span>تأیید اقدام حساس</span><h2 id="admin-confirm-title">{state.title}</h2></div><button onClick={onClose} disabled={busy} aria-label="بستن"><X size={18} /></button></header>
        <dl><div><dt>هدف</dt><dd>{state.target}</dd></div><div><dt>وضعیت فعلی</dt><dd>{state.current}</dd></div><div><dt>تغییر پیشنهادی</dt><dd>{state.proposed}</dd></div><div><dt>نتیجه دقیق</dt><dd>{state.result}</dd></div></dl>
        <label className="adm-reason">دلیل الزامی<textarea ref={reasonRef} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="دلیل عملیاتی این تغییر را ثبت کنید…" /></label>
        {error ? <p className="adm-inline-error" role="alert">{error}</p> : null}
        <footer><button className="adm-button is-secondary" onClick={onClose} disabled={busy}>انصراف</button><button className="adm-button is-primary" disabled={busy || reason.trim().length < 5} onClick={async () => {
          setBusy(true); setError("");
          try {
            const result = await state.onConfirm(reason.trim());
            if (!result.ok) { setError(result.messageFa); return; }
            onDone(result);
          } catch (caught) { setError(toAppError(caught).messageFa); }
          finally { setBusy(false); }
        }}>{busy ? <RefreshCw size={15} className="adm-spin" /> : null}{state.actionLabel}</button></footer>
      </section>
    </div>
  );
}

function OverviewPage({ session, range }: { session: AuthSession; range: DateRange }) {
  const query = useAdminQuery((signal) => adminApi.overview(session, range.from, range.to, signal), [session, range.from, range.to]);
  return <><PageHeader eyebrow="عملیات / نمای کلی" title="مرکز کنترل ویدورا" description="تصویر عملیاتی مبتنی بر داده‌های واقعی همان بازه؛ سنجه خالی با مقدار ساختگی جایگزین نمی‌شود." />
    {query.loading ? <StatePanel kind="loading" message="در حال محاسبه سنجه‌های عملیاتی…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : query.data ? <>
      {query.data.incidents.length ? <section className="adm-alert-strip"><AlertTriangle size={18} /><div><strong>{query.data.incidents.length.toLocaleString("fa-IR")} رخداد عملیاتی باز</strong><span>جزئیات در سلامت سیستم قابل بررسی است.</span></div><a href="#/admin/system">بررسی</a></section> : null}
      <section className="adm-metric-grid">{query.data.metrics.map((metric) => <MetricCard key={metric.key} metric={metric} />)}</section>
      <section className="adm-overview-grid"><OperationsChart overview={query.data} /><article className="adm-chart-card"><header><div><span>عملیات ترجمه</span><h2>حجم و خطا</h2></div></header>{query.data.series.length ? <div className="adm-bar-chart" role="img" aria-label="درخواست‌های ترجمه و خطاهای روزانه">{query.data.series.map((item) => <div key={item.date} title={`${formatDate(item.date)} — ${item.translationRequests} درخواست، ${item.translationFailures} خطا`}><span style={{ height: `${Math.max(2, item.translationRequests * 4)}px` }} /><i style={{ height: `${Math.max(0, item.translationFailures * 4)}px` }} /></div>)}</div> : <StatePanel kind="empty" message="درخواستی در این بازه ثبت نشده است." />}</article></section>
      {query.data.recentAudit.length ? <section className="adm-panel"><div className="adm-panel-title"><div><span>کنترل داخلی</span><h2>آخرین اقدامات ممتاز</h2></div><a href="#/admin/audit-log">مشاهده کامل</a></div><DataTable label="آخرین اقدامات"><thead><tr><th>اقدام</th><th>هدف</th><th>نقش</th><th>زمان</th><th>نتیجه</th></tr></thead><tbody>{query.data.recentAudit.map((row) => <tr key={row.id}><td>{row.actionType}</td><td dir="ltr">{row.targetEntityId || "—"}</td><td>{ADMIN_ROLE_LABELS[row.actorRole]}</td><td>{formatDate(row.createdAt, true)}</td><td><Status value={row.success ? "succeeded" : "failed"} /></td></tr>)}</tbody></DataTable></section> : null}
    </> : null}
  </>;
}

function UsersPage({ session, context, initialSearch = "" }: { session: AuthSession; context: AdminContext; initialSearch?: string }) {
  const [search, setSearch] = React.useState(initialSearch);
  const debounced = useDebounced(search);
  const [page, setPage] = React.useState(1);
  const [status, setStatus] = React.useState("");
  const [confirmation, setConfirmation] = React.useState<ConfirmState | null>(null);
  const [notice, setNotice] = React.useState("");
  React.useEffect(() => setPage(1), [debounced, status]);
  const query = useAdminQuery((signal) => adminApi.users(session, { search: debounced, filters: status ? { subscriptionStatus: status } : {}, page }, signal), [session, debounced, status, page]);
  const adjust = (user: AdminUserRow, days: number) => setConfirmation({
    title: days > 0 ? `افزودن ${days.toLocaleString("fa-IR")} روز اشتراک` : `حذف ${Math.abs(days).toLocaleString("fa-IR")} روز اشتراک`,
    target: `${user.displayName || "کاربر"} — ${user.email || user.id}`,
    current: user.subscriptionEndsAt ? `پایان ${formatDate(user.subscriptionEndsAt)}` : "اشتراک فعالی ثبت نشده است",
    proposed: `${days > 0 ? "+" : "−"}${Math.abs(days).toLocaleString("fa-IR")} روز`,
    result: days > 0 ? "تاریخ پایان تمدید می‌شود یا دسترسی مکمل ایجاد خواهد شد." : "تاریخ پایان جلو آورده می‌شود؛ اشتراک نباید در گذشته پایان یابد.",
    actionLabel: days > 0 ? "افزودن روزها" : "حذف روزها",
    onConfirm: (reason) => adminApi.adjustSubscription(session, { userId: user.id, days, reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }),
  });
  const data = query.data as AdminPage<AdminUserRow> | null;
  return <><PageHeader eyebrow="کاربران و درآمد / کاربران" title="مدیریت کاربران" description="جست‌وجوی سمت سرور بر اساس نام، ایمیل، تلفن، شناسه کاربر، پرداخت یا ویدئو." />
    {notice ? <div className="adm-notice" role="status">{notice}</div> : null}
    <section className="adm-panel"><div className="adm-toolbar"><label className="adm-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="جست‌وجوی کاربر یا شناسه…" /></label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">همه وضعیت‌های اشتراک</option><option value="active">فعال</option><option value="expired">منقضی</option><option value="never_subscribed">بدون سابقه</option></select></div>
      {query.loading ? <StatePanel kind="loading" message="در حال دریافت صفحه کاربران…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="کاربری با این معیارها پیدا نشد." /> : <><DataTable label="فهرست کاربران"><thead><tr><th>کاربر</th><th>عضویت</th><th>آخرین فعالیت</th><th>اشتراک</th><th>تماشا</th><th>ترجمه</th><th>حساب</th><th>عملیات</th></tr></thead><tbody>{data.items.map((user) => <tr key={user.id}><td><a className="adm-user-cell" href={`#/admin/users/${user.id}`}><strong>{user.displayName || "بدون نام"}</strong><span dir="ltr">{user.email || user.id}</span></a></td><td>{formatDate(user.createdAt)}</td><td>{formatDate(user.lastActivityAt, true)}</td><td><div className="adm-stack"><Status value={user.subscriptionStatus || "never"} /><small>{user.remainingDays === null ? "—" : `${user.remainingDays.toLocaleString("fa-IR")} روز`}</small></div></td><td>{formatDuration(user.watchSeconds)}</td><td><span>{user.completedTranslations.toLocaleString("fa-IR")} موفق</span>{user.failedTranslations ? <small className="adm-failure">{user.failedTranslations.toLocaleString("fa-IR")} خطا</small> : null}</td><td><Status value={user.accountStatus} /></td><td><div className="adm-row-actions"><a href={`#/admin/users/${user.id}`}>جزئیات</a>{hasAdminPermission(context, ADMIN_PERMISSIONS.subscriptionsAddDays) ? <button onClick={() => adjust(user, context.role === "support" ? 7 : 30)}>+ روز</button> : null}{hasAdminPermission(context, ADMIN_PERMISSIONS.subscriptionsRemoveDays) && user.subscriptionEndsAt ? <button onClick={() => adjust(user, -7)}>− روز</button> : null}</div></td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}
    </section>{confirmation ? <ConfirmationDialog state={confirmation} onClose={() => setConfirmation(null)} onDone={(result) => { setConfirmation(null); setNotice(result.messageFa); query.retry(); }} /> : null}</>;
}

function UserDetailPage({ session, context, userId }: { session: AuthSession; context: AdminContext; userId: string }) {
  const query = useAdminQuery((signal) => adminApi.userDetail(session, userId, signal), [session, userId]);
  const [confirmation, setConfirmation] = React.useState<ConfirmState | null>(null);
  const [notice, setNotice] = React.useState("");
  const detail = query.data as AdminUserDetail | null;
  const adjust = (days: number) => detail && setConfirmation({ title: days > 0 ? "افزودن دسترسی اشتراک" : "کاهش دسترسی اشتراک", target: `${detail.user.displayName || "کاربر"} — ${detail.user.email}`, current: detail.user.subscriptionEndsAt ? formatDate(detail.user.subscriptionEndsAt) : "بدون اشتراک", proposed: `${days > 0 ? "+" : "−"}${Math.abs(days).toLocaleString("fa-IR")} روز`, result: "تغییر در دفتر تعدیلات ثبت و همراه با گزارش حسابرسی ذخیره می‌شود.", actionLabel: "تأیید تغییر", onConfirm: (reason) => adminApi.adjustSubscription(session, { userId, days, reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }) });
  const changeStatus = () => detail && setConfirmation({ title: detail.user.accountStatus === "active" ? "تعلیق حساب کاربر" : "فعال‌سازی دوباره حساب", target: `${detail.user.displayName || "کاربر"} — ${detail.user.email}`, current: STATUS_FA[detail.user.accountStatus], proposed: detail.user.accountStatus === "active" ? "تعلیق" : "فعال", result: "وضعیت حساب در سرور تغییر می‌کند و اقدام همراه با دلیل در گزارش مدیران ثبت می‌شود. لغو نشست‌ها نیازمند Admin API سمت سرور است.", actionLabel: detail.user.accountStatus === "active" ? "تعلیق حساب" : "فعال‌سازی حساب", onConfirm: (reason) => adminApi.setUserStatus(session, { userId, status: detail.user.accountStatus === "active" ? "suspended" : "active", reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }) });
  return <><PageHeader eyebrow="کاربران / جزئیات" title={detail?.user.displayName || "پرونده کاربر"} description="نمای یکپارچه حساب، اشتراک، فعالیت معنادار و ویدئوهای کاربر." action={<a className="adm-button is-secondary" href="#/admin/users">بازگشت به کاربران</a>} />{notice ? <div className="adm-notice">{notice}</div> : null}
    {query.loading ? <StatePanel kind="loading" message="در حال دریافت پرونده کاربر…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : detail ? <div className="adm-detail-stack">
      <section className="adm-panel"><div className="adm-panel-title"><div><span>خلاصه حساب</span><h2>{detail.user.email}</h2></div><Status value={detail.user.accountStatus} /></div><dl className="adm-definition-grid"><div><dt>شناسه کاربر</dt><dd><CopyId value={detail.user.id} /></dd></div><div><dt>ثبت‌نام</dt><dd>{formatDate(detail.user.createdAt, true)}</dd></div><div><dt>آخرین ورود</dt><dd>{formatDate(detail.user.lastSignInAt, true)}</dd></div><div><dt>آخرین فعالیت</dt><dd>{formatDate(detail.user.lastActivityAt, true)}</dd></div><div><dt>پلن فعلی</dt><dd>{detail.user.planNameFa || "—"}</dd></div><div><dt>پایان اشتراک</dt><dd>{formatDate(detail.user.subscriptionEndsAt)}</dd></div><div><dt>زمان تماشا</dt><dd>{formatDuration(detail.user.watchSeconds)}</dd></div><div><dt>ویدئوهای افزوده‌شده</dt><dd>{detail.user.uploadedVideos.toLocaleString("fa-IR")}</dd></div></dl><div className="adm-action-band"><strong>اقدامات دارای گزارش حسابرسی</strong>{hasAdminPermission(context, ADMIN_PERMISSIONS.subscriptionsAddDays) ? <button onClick={() => adjust(context.role === "support" ? 7 : 30)}>افزودن روز</button> : null}{hasAdminPermission(context, ADMIN_PERMISSIONS.subscriptionsRemoveDays) && detail.user.subscriptionEndsAt ? <button onClick={() => adjust(-7)}>حذف ۷ روز</button> : null}{hasAdminPermission(context, ADMIN_PERMISSIONS.usersSuspend) ? <button onClick={changeStatus}>{detail.user.accountStatus === "active" ? "تعلیق حساب" : "فعال‌سازی حساب"}</button> : null}</div></section>
      <section className="adm-panel"><div className="adm-panel-title"><div><span>دفتر غیرقابل بازنویسی</span><h2>تاریخچه اشتراک</h2></div></div>{detail.subscriptionTimeline.length ? <DataTable label="تاریخچه اشتراک"><thead><tr><th>نوع</th><th>تغییر</th><th>پایان قبلی</th><th>پایان جدید</th><th>دلیل</th><th>زمان</th></tr></thead><tbody>{detail.subscriptionTimeline.map((item) => <tr key={item.id}><td>{item.adjustmentType}</td><td dir="ltr">{item.daysDelta > 0 ? "+" : ""}{item.daysDelta}</td><td>{formatDate(item.previousEndsAt)}</td><td>{formatDate(item.newEndsAt)}</td><td>{item.reason}</td><td>{formatDate(item.createdAt, true)}</td></tr>)}</tbody></DataTable> : <StatePanel kind="empty" message="تعدیل دستی برای این حساب ثبت نشده است." />}</section>
      <section className="adm-two-panels"><article className="adm-panel"><div className="adm-panel-title"><div><span>رفتار محصول</span><h2>فعالیت اخیر</h2></div></div>{detail.activity.length ? <ol className="adm-timeline">{detail.activity.slice(0, 30).map((event) => <li key={event.id}><i /><div><strong>{event.eventName}</strong><span>{formatDate(event.occurredAt, true)}</span></div>{event.videoId ? <CopyId value={event.videoId} /> : null}</li>)}</ol> : <StatePanel kind="empty" message="رویداد معناداری ثبت نشده است." />}</article><article className="adm-panel"><div className="adm-panel-title"><div><span>پردازش خصوصی</span><h2>ویدئوهای کاربر</h2></div></div>{detail.videos.length ? <ol className="adm-timeline">{detail.videos.map((video) => <li key={video.id}><i /><div><strong>{video.title || "بدون عنوان"}</strong><span>{formatDate(video.createdAt)} · {video.sourceType}</span></div><Status value={video.status} /></li>)}</ol> : <StatePanel kind="empty" message="ویدیویی ثبت نشده است." />}</article></section>
    </div> : null}{confirmation ? <ConfirmationDialog state={confirmation} onClose={() => setConfirmation(null)} onDone={(result) => { setConfirmation(null); setNotice(result.messageFa); query.retry(); }} /> : null}</>;
}

function SubscriptionsPage({ session }: { session: AuthSession }) {
  const [search, setSearch] = React.useState(""); const debounced = useDebounced(search); const [status, setStatus] = React.useState(""); const [page, setPage] = React.useState(1);
  const query = useAdminQuery((signal) => adminApi.subscriptions(session, { search: debounced, status, page }, signal), [session, debounced, status, page]);
  const data = query.data as AdminPage<AdminSubscriptionRow> | null;
  return <><PageHeader eyebrow="کاربران و درآمد / اشتراک‌ها" title="دفتر اشتراک‌ها" description="وضعیت جاری در کنار منبع آخرین تغییر؛ تعدیلات دستی تاریخچه را بازنویسی نمی‌کنند." /><section className="adm-panel"><div className="adm-toolbar"><label className="adm-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="کاربر یا شناسه اشتراک…" /></label><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه وضعیت‌ها</option><option value="active">فعال</option><option value="expired">منقضی</option><option value="cancelled">لغوشده</option><option value="payment_failed">پرداخت ناموفق</option></select></div>{query.loading ? <StatePanel kind="loading" message="در حال دریافت اشتراک‌ها…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="اشتراکی با این معیارها وجود ندارد." /> : <><DataTable label="اشتراک‌ها"><thead><tr><th>کاربر</th><th>پلن</th><th>وضعیت</th><th>شروع</th><th>پایان</th><th>باقی‌مانده</th><th>مصرف</th><th>منبع تغییر</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td><a href={`#/admin/users/${row.userId}`}><strong>{row.displayName || row.email}</strong></a></td><td>{row.planNameFa}</td><td><Status value={row.status} /></td><td>{formatDate(row.startsAt)}</td><td>{formatDate(row.endsAt)}</td><td>{row.remainingDays === null ? "—" : `${row.remainingDays.toLocaleString("fa-IR")} روز`}</td><td>{row.usedMinutes.toLocaleString("fa-IR")} / {row.includedMinutes.toLocaleString("fa-IR")}</td><td>{row.lastModificationSource === "admin" ? "مدیر" : "سیستم"}</td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}</section></>;
}

function PaymentsPage({ session }: { session: AuthSession }) {
  const [status, setStatus] = React.useState(""); const [page, setPage] = React.useState(1);
  const query = useAdminQuery((signal) => adminApi.payments(session, { status, page }, signal), [session, status, page]);
  const data = query.data as AdminPage<AdminPaymentRow> | null;
  return <><PageHeader eyebrow="کاربران و درآمد / پرداخت‌ها" title="پرداخت و درآمد" description="فقط شناسه‌های مجاز ارائه‌دهنده نگهداری می‌شوند؛ اطلاعات کارت در ویدورا ذخیره یا نمایش داده نمی‌شود." /><section className="adm-constraint"><AlertTriangle size={17} /><div><strong>درگاه پرداخت هنوز متصل نشده است</strong><span>جدول و قرارداد امن آماده است، اما تا استقرار webhook معتبر هیچ درآمدی ثبت نخواهد شد.</span></div></section><section className="adm-panel"><div className="adm-toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه وضعیت‌ها</option><option value="succeeded">موفق</option><option value="failed">ناموفق</option><option value="pending">در انتظار</option><option value="refunded">بازپرداخت</option></select></div>{query.loading ? <StatePanel kind="loading" message="در حال دریافت دفتر پرداخت…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="پرداخت واقعی در این بازه ثبت نشده است." /> : <><DataTable label="پرداخت‌ها"><thead><tr><th>کاربر</th><th>ارائه‌دهنده</th><th>مرجع</th><th>وضعیت</th><th>مبلغ</th><th>تخفیف</th><th>زمان</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td><a href={`#/admin/users/${row.userId}`}>{row.displayName || row.email}</a></td><td>{row.provider}</td><td><CopyId value={row.providerReference} /></td><td><Status value={row.status} /></td><td>{new Intl.NumberFormat("fa-IR", { style: "currency", currency: row.currency }).format(row.amount)}</td><td>{row.discountAmount.toLocaleString("fa-IR")}</td><td>{formatDate(row.createdAt, true)}</td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}</section></>;
}

function VideosPage({ session, context }: { session: AuthSession; context: AdminContext }) {
  const [kind, setKind] = React.useState("all"); const [status, setStatus] = React.useState(""); const [page, setPage] = React.useState(1); const [confirmation, setConfirmation] = React.useState<ConfirmState | null>(null); const [notice, setNotice] = React.useState("");
  const query = useAdminQuery((signal) => adminApi.videos(session, { kind, status, page }, signal), [session, kind, status, page]); const data = query.data as AdminPage<AdminVideoRow> | null;
  const publication = (video: AdminVideoRow) => setConfirmation({ title: video.isPublished ? "توقف انتشار ویدئو" : "انتشار ویدئو", target: video.title || video.id, current: video.isPublished ? "منتشرشده" : "پیش‌نویس", proposed: video.isPublished ? "عدم انتشار" : "انتشار عمومی", result: "متادیتای کتابخانه به‌روزرسانی و اقدام در گزارش مدیران ثبت می‌شود.", actionLabel: video.isPublished ? "توقف انتشار" : "انتشار", onConfirm: (reason) => adminApi.setLibraryPublication(session, { videoId: video.id, published: !video.isPublished, reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }) });
  return <><PageHeader eyebrow="محتوا و تعامل / ویدئوها" title="مدیریت محتوا و ویدئو" description="ویدئوهای کتابخانه و ورودی‌های خصوصی کاربران در یک نمای مجوزمحور؛ داده خصوصی فقط برای نقش‌های لازم." />{notice ? <div className="adm-notice">{notice}</div> : null}<section className="adm-panel"><div className="adm-toolbar"><select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">همه منابع</option><option value="library">کتابخانه</option><option value="user">کاربر</option></select><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه وضعیت‌ها</option><option value="published">منتشرشده</option><option value="draft">پیش‌نویس</option><option value="completed">آماده</option><option value="failed">ناموفق</option></select></div>{query.loading ? <StatePanel kind="loading" message="در حال دریافت ویدئوها…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="ویدیویی با این معیارها ثبت نشده است." /> : <><DataTable label="ویدئوها"><thead><tr><th>ویدئو</th><th>نوع</th><th>دسته</th><th>وضعیت</th><th>مدت</th><th>شروع</th><th>تکمیل</th><th>به‌روزرسانی</th><th>عملیات</th></tr></thead><tbody>{data.items.map((video) => <tr key={`${video.kind}-${video.id}`}><td><strong>{video.title || "بدون عنوان"}</strong><CopyId value={video.id} /></td><td>{video.kind === "library" ? "کتابخانه" : "خصوصی کاربر"}</td><td>{video.category || "—"}</td><td><Status value={video.status} /></td><td>{formatDuration(video.durationSeconds)}</td><td>{video.starts.toLocaleString("fa-IR")}</td><td>{video.completionRate === null ? "—" : `${video.completionRate.toLocaleString("fa-IR")}٪`}</td><td>{formatDate(video.updatedAt)}</td><td>{video.kind === "library" && hasAdminPermission(context, ADMIN_PERMISSIONS.videosManage) ? <button className="adm-text-button" onClick={() => publication(video)}>{video.isPublished ? "عدم انتشار" : "انتشار"}</button> : "—"}</td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}</section>{confirmation ? <ConfirmationDialog state={confirmation} onClose={() => setConfirmation(null)} onDone={(result) => { setConfirmation(null); setNotice(result.messageFa); query.retry(); }} /> : null}</>;
}

function JobsPage({ session, context }: { session: AuthSession; context: AdminContext }) {
  const [status, setStatus] = React.useState(""); const [longRunning, setLongRunning] = React.useState(false); const [page, setPage] = React.useState(1); const [confirmation, setConfirmation] = React.useState<ConfirmState | null>(null); const [notice, setNotice] = React.useState("");
  const query = useAdminQuery((signal) => adminApi.jobs(session, { status, longRunning, page }, signal), [session, status, longRunning, page]); const data = query.data as AdminPage<AdminJobRow> | null;
  const retry = (job: AdminJobRow) => setConfirmation({ title: "تلاش مجدد پردازش", target: `${job.videoTitle || job.videoId} — کار ${job.id}`, current: `${STATUS_FA[job.status] || job.status} / تلاش ${job.attempt.toLocaleString("fa-IR")}`, proposed: "ایجاد یا استفاده از یک کار زنده یکتا", result: "اگر کار فعال وجود داشته باشد کار تکراری ساخته نمی‌شود؛ در غیر این صورت ویدئو دوباره در صف قرار می‌گیرد.", actionLabel: "ثبت تلاش مجدد", onConfirm: (reason) => adminApi.retryJob(session, { jobId: job.id, reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }) });
  return <><PageHeader eyebrow="عملیات / پردازش و ترجمه" title="صف ترجمه" description="وضعیت واقعی خط پردازش، تلاش‌ها، زمان اجرا و خطاهای پاک‌سازی‌شده؛ بدون نمایش stack trace یا اعتبارنامه." />{notice ? <div className="adm-notice">{notice}</div> : null}<section className="adm-panel"><div className="adm-toolbar"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">همه وضعیت‌ها</option><option value="queued">در صف</option><option value="running">در حال اجرا</option><option value="completed">تکمیل</option><option value="failed">ناموفق</option></select><label className="adm-check"><input type="checkbox" checked={longRunning} onChange={(e) => setLongRunning(e.target.checked)} /> فقط کارهای طولانی</label></div>{query.loading ? <StatePanel kind="loading" message="در حال دریافت صف پردازش…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="کاری با این معیارها وجود ندارد." /> : <><DataTable label="کارهای ترجمه"><thead><tr><th>کار / ویدئو</th><th>کاربر</th><th>مرحله</th><th>پیشرفت</th><th>زمان اجرا</th><th>تلاش</th><th>ارائه‌دهنده</th><th>خطا</th><th>عملیات</th></tr></thead><tbody>{data.items.map((job) => <tr key={job.id}><td><strong>{job.videoTitle || "بدون عنوان"}</strong><CopyId value={job.id} /></td><td><a href={`#/admin/users/${job.userId}`}>{job.userLabel || job.userId}</a></td><td><div className="adm-stack"><Status value={job.status} /><small>{job.stage}</small></div></td><td><span dir="ltr">{job.progressPercent}%</span></td><td>{formatDuration(job.processingSeconds)}</td><td>{job.attempt.toLocaleString("fa-IR")} / {job.maxAttempts.toLocaleString("fa-IR")}</td><td>{job.provider || "self-hosted"}<small>{job.model || "—"}</small></td><td>{job.failureCode ? <span title={job.failureMessage || ""}>{job.failureCode}</span> : "—"}</td><td>{["failed", "cancelled"].includes(job.status) && hasAdminPermission(context, ADMIN_PERMISSIONS.jobsRetry) ? <button className="adm-text-button" onClick={() => retry(job)}>تلاش مجدد</button> : "—"}</td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}</section>{confirmation ? <ConfirmationDialog state={confirmation} onClose={() => setConfirmation(null)} onDone={(result) => { setConfirmation(null); setNotice(result.messageFa); query.retry(); }} /> : null}</>;
}

function VideoAnalyticsPage({ session, range }: { session: AuthSession; range: DateRange }) {
  const [videoId, setVideoId] = React.useState(""); const debounced = useDebounced(videoId, 500);
  const query = useAdminQuery((signal) => adminApi.videoAnalytics(session, { videoId: debounced || undefined, from: range.from, to: range.to }, signal), [session, debounced, range.from, range.to]); const data = query.data as AdminVideoAnalytics | null;
  const points = data?.retention || [];
  return <><PageHeader eyebrow="محتوا و تعامل / تحلیل مشاهده" title="کیفیت تماشا و ریزش" description="Retention از جلسات واقعی و آستانه‌های ۵٪ زمان تماشای معنادار محاسبه می‌شود؛ seek زمان دیده‌نشده را اضافه نمی‌کند." /><section className="adm-panel"><div className="adm-toolbar"><label className="adm-search"><Search size={16} /><input value={videoId} onChange={(e) => setVideoId(e.target.value)} placeholder="شناسه ویدئو برای تحلیل اختصاصی…" dir="ltr" /></label></div>{query.loading ? <StatePanel kind="loading" message="در حال محاسبه منحنی نگهداشت…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : data ? <><section className="adm-metric-grid is-compact">{[
        ["شروع", data.starts], ["بیننده یکتا", data.uniqueViewers], ["زمان تماشا", formatDuration(data.totalWatchSeconds)], ["میانگین", formatDuration(data.averageWatchSeconds)], ["تکمیل", data.completionRate === null ? "—" : `${data.completionRate.toLocaleString("fa-IR")}٪`], ["فعال‌سازی زیرنویس", data.subtitleActivationRate === null ? "—" : `${data.subtitleActivationRate.toLocaleString("fa-IR")}٪`],
      ].map(([label, value]) => <article className="adm-metric" key={String(label)}><div><span>{label}</span></div><strong>{typeof value === "number" ? value.toLocaleString("fa-IR") : value}</strong></article>)}</section><article className="adm-retention" role="img" aria-label="منحنی نگهداشت تماشای ویدئو"><div className="adm-retention-plot">{points.map((point) => <div key={point.bucket}><span style={{ height: `${point.retentionPercent}%` }} title={`${point.bucket}%: ${point.retentionPercent}%`} /><small>{point.bucket % 25 === 0 ? `${point.bucket.toLocaleString("fa-IR")}٪` : ""}</small></div>)}</div><footer><span>جلسه معتبر: {data.validSessions.toLocaleString("fa-IR")}</span><span>بیشترین ریزش: {data.largestDropoffBucket === null ? "—" : `${data.largestDropoffBucket.toLocaleString("fa-IR")}٪`}</span></footer></article>{!data.validSessions ? <StatePanel kind="empty" message="جلسه پخش معناداری در این بازه ثبت نشده است؛ منحنی ساختگی نمایش داده نمی‌شود." /> : null}</> : null}</section></>;
}

function FunnelsPage({ session, range }: { session: AuthSession; range: DateRange }) {
  const [name, setName] = React.useState("acquisition"); const query = useAdminQuery((signal) => adminApi.funnel(session, { name, from: range.from, to: range.to }, signal), [session, name, range.from, range.to]); const data = query.data as AdminFunnel | null;
  return <><PageHeader eyebrow="محتوا و تعامل / قیف‌ها" title="قیف‌های محصول" description="هر مرحله بر پایه هویت یکتای کاربر یا شناسه ناشناس و رویداد تایپ‌شده محاسبه می‌شود." /><section className="adm-panel"><div className="adm-toolbar"><select value={name} onChange={(e) => setName(e.target.value)}><option value="acquisition">جذب تا ثبت‌نام</option><option value="activation">ثبت‌نام تا فعال‌سازی</option><option value="upload">افزودن و ترجمه</option><option value="subscription">اشتراک</option></select>{data ? <small>{data.identityDefinition}</small> : null}</div>{query.loading ? <StatePanel kind="loading" message="در حال محاسبه قیف…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : data?.steps.length ? <ol className="adm-funnel">{data.steps.map((step, index) => <li key={step.key}><span>{(index + 1).toLocaleString("fa-IR")}</span><div><strong>{step.labelFa}</strong><small>{step.users.toLocaleString("fa-IR")} هویت یکتا</small></div><dl><div><dt>تبدیل مرحله</dt><dd>{step.stepConversion === null ? "—" : `${step.stepConversion.toLocaleString("fa-IR")}٪`}</dd></div><div><dt>تبدیل کل</dt><dd>{step.totalConversion === null ? "—" : `${step.totalConversion.toLocaleString("fa-IR")}٪`}</dd></div><div><dt>ریزش</dt><dd>{step.dropoff.toLocaleString("fa-IR")}</dd></div></dl></li>)}</ol> : <StatePanel kind="empty" message="برای این قیف رویداد کافی ثبت نشده است." />}</section></>;
}

function SystemPage({ session, range }: { session: AuthSession; range: DateRange }) {
  const query = useAdminQuery((signal) => adminApi.systemHealth(session, range.from, range.to, signal), [session, range.from, range.to]); const data = query.data as AdminSystemHealth | null;
  return <><PageHeader eyebrow="عملیات / سلامت سیستم" title="سلامت خط پردازش" description="خلاصه ایمن صف، خطا و زمان پردازش؛ اعتبارنامه، stack trace و جزئیات حساس زیرساخت نمایش داده نمی‌شود." />{query.loading ? <StatePanel kind="loading" message="در حال بررسی سلامت سیستم…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : data ? <><section className="adm-metric-grid is-compact">{[["عمق صف", data.queueDepth], ["کارهای در حال اجرا", data.runningJobs], ["کارهای ناموفق", data.failedJobs], ["نرخ خطا", data.translationFailureRate === null ? "—" : `${data.translationFailureRate.toLocaleString("fa-IR")}٪`], ["میانگین پردازش", formatDuration(data.averageProcessingSeconds)], ["قدیمی‌ترین کار صف", formatDate(data.oldestQueuedAt, true)]].map(([label, value]) => <article className="adm-metric" key={String(label)}><div><span>{label}</span></div><strong>{typeof value === "number" ? value.toLocaleString("fa-IR") : value}</strong></article>)}</section><section className="adm-two-panels"><article className="adm-panel"><div className="adm-panel-title"><div><span>ارائه‌دهندگان</span><h2>خطای پردازش</h2></div></div>{data.providerFailures.length ? <DataTable label="خطاهای ارائه‌دهنده"><thead><tr><th>ارائه‌دهنده</th><th>کل</th><th>ناموفق</th></tr></thead><tbody>{data.providerFailures.map((row) => <tr key={row.provider}><td>{row.provider}</td><td>{row.total.toLocaleString("fa-IR")}</td><td>{row.failed.toLocaleString("fa-IR")}</td></tr>)}</tbody></DataTable> : <StatePanel kind="empty" message="داده ارائه‌دهنده در بازه وجود ندارد." />}</article><article className="adm-panel"><div className="adm-panel-title"><div><span>رخدادهای عملیاتی</span><h2>موارد باز</h2></div></div>{data.incidents.length ? <ol className="adm-timeline">{data.incidents.map((incident) => <li key={incident.id}><i /><div><strong>{incident.title}</strong><span>{formatDate(incident.startedAt, true)}</span></div><Status value={incident.status} /></li>)}</ol> : <StatePanel kind="empty" message="رخداد بازی ثبت نشده است." />}</article></section></> : null}</>;
}

function AuditPage({ session }: { session: AuthSession }) {
  const [search, setSearch] = React.useState(""); const debounced = useDebounced(search); const [page, setPage] = React.useState(1); const query = useAdminQuery((signal) => adminApi.audits(session, { search: debounced, page }, signal), [session, debounced, page]); const data = query.data as AdminPage<AdminAuditRow> | null;
  return <><PageHeader eyebrow="مدیریت / گزارش مدیران" title="گزارش تغییرناپذیر مدیران" description="هر اقدام ممتاز با نقش، هدف، دلیل، شناسه درخواست و نتیجه ذخیره می‌شود؛ ویرایش یا حذف از رابط ممکن نیست." /><section className="adm-panel"><div className="adm-toolbar"><label className="adm-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="اقدام، هدف یا شناسه درخواست…" /></label></div>{query.loading ? <StatePanel kind="loading" message="در حال دریافت گزارش…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !data?.items.length ? <StatePanel kind="empty" message="گزارش مدیریتی ثبت نشده است." /> : <><DataTable label="گزارش مدیران"><thead><tr><th>زمان</th><th>مدیر / نقش</th><th>اقدام</th><th>هدف</th><th>دلیل</th><th>درخواست</th><th>نتیجه</th></tr></thead><tbody>{data.items.map((row) => <tr key={row.id}><td>{formatDate(row.createdAt, true)}</td><td><CopyId value={row.actorUserId} /><span>{ADMIN_ROLE_LABELS[row.actorRole]}</span></td><td>{row.actionType}</td><td>{row.targetEntityType}<small dir="ltr">{row.targetEntityId || "—"}</small></td><td>{row.reason}</td><td><CopyId value={row.requestId} /></td><td><Status value={row.success ? "succeeded" : "failed"} />{row.failureCode ? <small>{row.failureCode}</small> : null}</td></tr>)}</tbody></DataTable><Pagination page={data.page} pageCount={data.pageCount} onPage={setPage} /></>}</section></>;
}

function TeamPage({ session, context }: { session: AuthSession; context: AdminContext }) {
  const query = useAdminQuery((signal) => adminApi.team(session, signal), [session]); const [confirmation, setConfirmation] = React.useState<ConfirmState | null>(null); const [notice, setNotice] = React.useState(""); const rows = (query.data as { items: AdminTeamRow[] } | null)?.items || [];
  const change = (member: AdminTeamRow, role: AdminRole, status: "active" | "suspended") => setConfirmation({ title: "تغییر دسترسی مدیر", target: member.displayName || member.email || member.userId, current: `${ADMIN_ROLE_LABELS[member.role]} / ${STATUS_FA[member.status]}`, proposed: `${ADMIN_ROLE_LABELS[role]} / ${STATUS_FA[status]}`, result: "دسترسی سرور بلافاصله بر اساس نقش جدید ارزیابی و تغییر در گزارش مدیران ثبت می‌شود.", actionLabel: "تغییر دسترسی", onConfirm: (reason) => adminApi.setTeamMember(session, { userId: member.userId, role, status, reason, requestId: crypto.randomUUID(), userAgent: navigator.userAgent }) });
  return <><PageHeader eyebrow="مدیریت / اعضای تیم" title="نقش‌ها و دسترسی مدیران" description="عضویت مدیر فقط برای حساب موجود و توسط مدیر ارشد تغییر می‌کند؛ آخرین مدیر ارشد قابل حذف نیست." />{notice ? <div className="adm-notice">{notice}</div> : null}<section className="adm-constraint"><ShieldCheck size={18} /><div><strong>دعوت ایمیلی نیازمند Admin API سمت سرور است</strong><span>این مخزن کلید service-role را در مرورگر نگه نمی‌دارد. تا افزودن Edge endpoint، عضویت اولیه فقط از مسیر امن استقرار انجام می‌شود.</span></div></section><section className="adm-panel">{query.loading ? <StatePanel kind="loading" message="در حال دریافت اعضای تیم…" /> : query.error ? <StatePanel kind="error" message={query.error} onRetry={query.retry} /> : !rows.length ? <StatePanel kind="empty" message="عضویت مدیریتی ثبت نشده است." /> : <DataTable label="اعضای تیم"><thead><tr><th>مدیر</th><th>نقش</th><th>وضعیت</th><th>ایجاد</th><th>آخرین اقدام</th><th>عملیات</th></tr></thead><tbody>{rows.map((member) => <tr key={member.userId}><td><strong>{member.displayName || "بدون نام"}</strong><span dir="ltr">{member.email}</span></td><td>{ADMIN_ROLE_LABELS[member.role]}</td><td><Status value={member.status} /></td><td>{formatDate(member.createdAt)}</td><td>{formatDate(member.lastAdminActivityAt, true)}</td><td>{hasAdminPermission(context, ADMIN_PERMISSIONS.teamManage) ? <div className="adm-row-actions"><button onClick={() => change(member, member.role === "analyst" ? "operations" : "analyst", member.status)}>تغییر نقش</button><button onClick={() => change(member, member.role, member.status === "active" ? "suspended" : "active")}>{member.status === "active" ? "تعلیق" : "فعال‌سازی"}</button></div> : "—"}</td></tr>)}</tbody></DataTable>}</section>{confirmation ? <ConfirmationDialog state={confirmation} onClose={() => setConfirmation(null)} onDone={(result) => { setConfirmation(null); setNotice(result.messageFa); query.retry(); }} /> : null}</>;
}

function SettingsPage() {
  return <><PageHeader eyebrow="مدیریت / تنظیمات" title="تنظیمات عملیاتی" description="تنظیمات امنیتی و providerها فقط از مسیر استقرار یا RPC حسابرسی‌شده تغییر می‌کنند." /><section className="adm-two-panels"><article className="adm-panel"><div className="adm-panel-title"><div><span>محدودیت‌های امن</span><h2>قواعد اقدامات حساس</h2></div></div><dl className="adm-definition-list"><div><dt>جبران پشتیبانی</dt><dd>حداکثر ۷ روز در هر درخواست</dd></div><div><dt>تلاش مجدد ترجمه</dt><dd>یک کار زنده یکتا برای هر ویدئو</dd></div><div><dt>بازه گزارش</dt><dd>حداکثر ۳۷۰ روز</dd></div><div><dt>دلیل اقدام</dt><dd>الزامی، بین ۵ تا ۱۰۰۰ نویسه</dd></div></dl></article><article className="adm-panel"><div className="adm-panel-title"><div><span>مرز استقرار</span><h2>سرویس‌های نیازمند اتصال</h2></div></div><dl className="adm-definition-list"><div><dt>درگاه پرداخت</dt><dd>پیکربندی نشده</dd></div><div><dt>دعوت مدیر</dt><dd>نیازمند Supabase Admin API سمت سرور</dd></div><div><dt>IP حسابرسی</dt><dd>نیازمند Edge gateway مورد اعتماد</dd></div><div><dt>هزینه پردازش</dt><dd>فقط در صورت ارسال مقدار توسط worker</dd></div></dl></article></section></>;
}

function RouteDenied() {
  return <section className="adm-panel"><StatePanel kind="error" message="HTTP 403 — نقش مدیریتی شما اجازه مشاهده این بخش را ندارد." /></section>;
}

function RoutePage({ hash, session, context, range }: { hash: string; session: AuthSession; context: AdminContext; range: DateRange }) {
  const path = hash.replace(/^#/, "").split("?")[0];
  const userMatch = path.match(/^\/admin\/users\/([0-9a-f-]{36})$/i);
  const routePermission: Array<[boolean, AdminPermission]> = [
    [Boolean(userMatch) || path === "/admin/users", ADMIN_PERMISSIONS.usersRead],
    [path === "/admin/subscriptions", ADMIN_PERMISSIONS.subscriptionsRead],
    [path === "/admin/payments", ADMIN_PERMISSIONS.paymentsRead],
    [path === "/admin/videos", ADMIN_PERMISSIONS.videosRead],
    [path.startsWith("/admin/analytics/"), ADMIN_PERMISSIONS.analyticsRead],
    [path === "/admin/translation-jobs", ADMIN_PERMISSIONS.jobsRead],
    [path === "/admin/system", ADMIN_PERMISSIONS.systemRead],
    [path === "/admin/audit-log", ADMIN_PERMISSIONS.auditRead],
    [path === "/admin/team", ADMIN_PERMISSIONS.teamRead],
    [path === "/admin/settings", ADMIN_PERMISSIONS.settingsRead],
  ];
  const required = routePermission.find(([matches]) => matches)?.[1] || ADMIN_PERMISSIONS.overviewRead;
  if (!hasAdminPermission(context, required)) return <RouteDenied />;
  if (userMatch) return <UserDetailPage session={session} context={context} userId={userMatch[1]} />;
  if (path === "/admin/users") return <UsersPage session={session} context={context} initialSearch={new URLSearchParams(hash.split("?")[1] || "").get("q") || ""} />;
  if (path === "/admin/subscriptions") return <SubscriptionsPage session={session} />;
  if (path === "/admin/payments") return <PaymentsPage session={session} />;
  if (path === "/admin/videos") return <VideosPage session={session} context={context} />;
  if (path === "/admin/analytics/videos") return <VideoAnalyticsPage session={session} range={range} />;
  if (path === "/admin/analytics/funnels") return <FunnelsPage session={session} range={range} />;
  if (path === "/admin/translation-jobs") return <JobsPage session={session} context={context} />;
  if (path === "/admin/system") return <SystemPage session={session} range={range} />;
  if (path === "/admin/audit-log") return <AuditPage session={session} />;
  if (path === "/admin/team") return <TeamPage session={session} context={context} />;
  if (path === "/admin/settings") return <SettingsPage />;
  return <OverviewPage session={session} range={range} />;
}

export function AdminApp({ session, context, onSignOut }: AdminAppProps) {
  const hash = useHash();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [range, setRange] = React.useState(() => dateRange("30d"));
  const [globalSearch, setGlobalSearch] = React.useState("");
  const canSearchUsers = hasAdminPermission(context, ADMIN_PERMISSIONS.usersRead);
  const canReadSystem = hasAdminPermission(context, ADMIN_PERMISSIONS.systemRead);
  const visibleSections = NAV_SECTIONS.map((section) => ({ ...section, items: section.items.filter((item) => hasAdminPermission(context, item.permission)) })).filter((section) => section.items.length);
  React.useEffect(() => { setDrawerOpen(false); window.scrollTo(0, 0); }, [hash]);
  const sidebar = <aside className={`adm-sidebar${drawerOpen ? " is-open" : ""}`} aria-label="ناوبری مدیریت"><header><a href="#/admin" className="adm-brand"><img src={`${import.meta.env.BASE_URL}assets/logos/vidora-logo-black.png`} alt="Vidora" /><span>ADMIN / OPS</span></a><button className="adm-mobile-close" onClick={() => setDrawerOpen(false)} aria-label="بستن منو"><X size={19} /></button></header><nav>{visibleSections.map((section) => <section key={section.label}><h2>{section.label}</h2>{section.items.map((item) => { const Icon = item.icon; const active = item.href === "#/admin" ? hash === "#/admin" || hash === "#" : hash.startsWith(item.href); return <a key={item.href} href={item.href} className={active ? "is-active" : ""}><Icon size={17} /><span>{item.label}</span></a>; })}</section>)}</nav><footer><div className="adm-admin-card"><span>{getDisplayName(session)}</span><small dir="ltr">{getUserEmail(session)}</small><strong>{context.roleLabelFa}</strong></div><button onClick={onSignOut}><LogOut size={16} /> خروج از حساب</button></footer></aside>;
  return <div className="adm-root lang-fa" dir="rtl">{sidebar}{drawerOpen ? <button className="adm-drawer-scrim" onClick={() => setDrawerOpen(false)} aria-label="بستن منو" /> : null}<div className="adm-main"><div className="adm-ops-rail"><span>VIDORA OPERATIONS</span><i /> <span>{context.roleLabelFa}</span><i /><span>{formatDate(range.from)} — {formatDate(range.to)}</span></div><header className="adm-topbar"><button className="adm-menu" onClick={() => setDrawerOpen(true)} aria-label="باز کردن منو"><Menu size={20} /></button>{canSearchUsers ? <form className="adm-global-search" onSubmit={(event) => { event.preventDefault(); if (globalSearch.trim()) window.location.hash = `#/admin/users?q=${encodeURIComponent(globalSearch.trim())}`; }}><Search size={16} /><input value={globalSearch} onChange={(event) => setGlobalSearch(event.target.value)} placeholder="جست‌وجوی سراسری کاربر…" /><kbd>Enter</kbd></form> : <div className="adm-global-search is-disabled"><ShieldCheck size={16} /><span>محیط عملیات امن</span></div>}<DateRangeControl value={range} onChange={setRange} />{canReadSystem ? <a className="adm-system-link" href="#/admin/system"><Activity size={16} /><span>سلامت سیستم</span></a> : null}</header><main className="adm-content"><RoutePage hash={hash} session={session} context={context} range={range} /></main></div></div>;
}
