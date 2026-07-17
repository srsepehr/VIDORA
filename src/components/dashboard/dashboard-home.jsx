import React from "react";
import {
  ArrowLeft,
  Clock3,
  Crown,
  Link2,
  PlaySquare,
  Upload,
  Video,
} from "lucide-react";

function SummaryCard({ icon: Icon, label, children, className = "" }) {
  return (
    <article className={`vd-card vd-summary-card ${className}`.trim()}>
      <span className="vd-summary-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.8} /></span>
      <p className="vd-summary-label">{label}</p>
      {children}
    </article>
  );
}

function VideoThumbnail({ duration, compact = false }) {
  return (
    <div className={`vd-dashboard-thumb${compact ? " is-compact" : ""}`} aria-hidden="true">
      <span className="vd-dashboard-thumb-wave" />
      <PlaySquare size={compact ? 17 : 21} strokeWidth={1.45} />
      {duration ? <small dir="ltr">{duration}</small> : null}
    </div>
  );
}

function EmptyWork({ isFa, onStart }) {
  return (
    <div className="vd-dashboard-empty">
      <span aria-hidden="true"><Video size={23} strokeWidth={1.6} /></span>
      <div>
        <strong>{isFa ? "کاری در حال پردازش نیست" : "Nothing is processing"}</strong>
        <p>{isFa ? "برای شروع، یک فایل ویدیو یا لینک یوتیوب اضافه کنید." : "Add a video file or YouTube link to begin."}</p>
      </div>
      <button className="vd-secondary" onClick={onStart}>{isFa ? "شروع ترجمه" : "Start translation"}</button>
    </div>
  );
}

function ActiveWork({ video, isFa, onOpen }) {
  const meta = [video.sourceType, video.minutes].filter(Boolean).join(" · ");
  return (
    <div className="vd-active-work-row">
      <VideoThumbnail duration={video.durationLabel} />
      <div className="vd-active-work-copy">
        <span className="vd-processing-badge">{video.stage}</span>
        <h3 dir="auto">{video.title}</h3>
        {meta ? <p>{meta}</p> : null}
      </div>
      <div className="vd-active-progress">
        <div className="vd-active-progress-head">
          <span>{video.stage}</span>
          <span>{isFa ? "در حال انجام" : "In progress"}</span>
        </div>
        <div className="vd-meter is-indeterminate" role="progressbar" aria-label={video.stage}><span /></div>
      </div>
      <button className="vd-secondary vd-dashboard-detail" onClick={() => onOpen(video.id)}>
        {isFa ? "مشاهده جزئیات" : "View details"}
      </button>
    </div>
  );
}

function RecentVideoRow({ video, isFa, statusCopy, onOpen, onRetry }) {
  const actionLabel = video.status === "Failed"
    ? (isFa ? "تلاش مجدد" : "Retry")
    : video.status === "Ready"
      ? (isFa ? "مشاهده" : "View")
      : (isFa ? "ادامه کار" : "Continue");
  return (
    <article className="vd-recent-row">
      <VideoThumbnail duration={video.durationLabel} compact />
      <div className="vd-recent-copy">
        <h3 dir="auto">{video.title}</h3>
        <p>{video.status === "Failed" && video.failure ? video.failure : video.stage}</p>
      </div>
      <span className={`vd-status is-${video.status.toLowerCase()}`}>{statusCopy[video.status]}</span>
      <time dateTime={video.raw.created_at}>{video.relativeCreated || video.created}</time>
      <button className="vd-open" onClick={() => video.status === "Failed" ? onRetry(video) : onOpen(video.id)}>{actionLabel}</button>
    </article>
  );
}

function LoadingBlock({ isFa }) {
  return (
    <div className="vd-dashboard-empty is-loading" aria-live="polite">
      <span className="vd-skeleton-dot" />
      <div><strong>{isFa ? "در حال دریافت اطلاعات…" : "Loading your dashboard…"}</strong></div>
    </div>
  );
}

export function DashboardHome({
  isFa,
  t,
  loading,
  error,
  videos,
  planName,
  includedMinutes,
  remainingMinutes,
  usagePercent,
  processedCount,
  onOpenVideo,
  onRetryVideo,
  onSelectView,
  onReload,
}) {
  const activeVideo = videos.find((video) => video.status === "Processing");
  const recentVideos = videos.slice(0, 3);
  const locale = isFa ? "fa-IR" : "en-US";
  const valueOrDash = (value) => loading ? "—" : value.toLocaleString(locale);

  return (
    <div className="vd-dashboard-home">
      <section className="vd-summary-grid" aria-label={isFa ? "خلاصه حساب" : "Account summary"}>
        <SummaryCard icon={Crown} label={isFa ? "پلن فعلی" : "Current plan"} className="is-plan">
          <strong className="vd-summary-value is-text">{loading ? "—" : planName}</strong>
          <p className="vd-summary-helper">{isFa ? "برای پردازش ویدیو اشتراک تهیه کنید." : "Choose a plan to process videos."}</p>
          <button className="vd-secondary" onClick={() => onSelectView("subscription")}>
            {isFa ? "مشاهده پلن‌ها" : "View plans"}<ArrowLeft size={16} aria-hidden="true" />
          </button>
        </SummaryCard>

        <SummaryCard icon={Clock3} label={isFa ? "دقیقه باقی‌مانده" : "Minutes remaining"}>
          <strong className="vd-summary-value">{valueOrDash(remainingMinutes)} <small>{isFa ? "دقیقه" : "min"}</small></strong>
          <p className="vd-summary-helper">{isFa ? `از ${includedMinutes.toLocaleString(locale)} دقیقه` : `of ${includedMinutes.toLocaleString(locale)} minutes`}</p>
          <div className="vd-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={usagePercent}><span style={{ width: `${usagePercent}%` }} /></div>
        </SummaryCard>

        <SummaryCard icon={PlaySquare} label={isFa ? "ویدیوهای پردازش‌شده" : "Processed videos"}>
          <strong className="vd-summary-value">{valueOrDash(processedCount)}</strong>
          <p className="vd-summary-helper">{isFa ? "ویدیو" : "videos"}</p>
        </SummaryCard>
      </section>

      <section className="vd-card vd-dashboard-section vd-continue-section">
        <div className="vd-dashboard-section-head"><h2>{isFa ? "ادامه کارها" : "Continue working"}</h2></div>
        {loading ? <LoadingBlock isFa={isFa} /> : error ? (
          <div className="vd-dashboard-empty is-error">
            <div><strong>{isFa ? "دریافت اطلاعات ممکن نشد" : "Could not load dashboard"}</strong><p>{error}</p></div>
            <button className="vd-secondary" onClick={onReload}>{isFa ? "تلاش دوباره" : "Retry"}</button>
          </div>
        ) : activeVideo ? <ActiveWork video={activeVideo} isFa={isFa} onOpen={onOpenVideo} /> : <EmptyWork isFa={isFa} onStart={() => onSelectView("new-video")} />}
      </section>

      <section className="vd-card vd-dashboard-section vd-dashboard-recent">
        <div className="vd-dashboard-section-head">
          <h2>{isFa ? "ویدیوهای اخیر" : "Recent videos"}</h2>
          <button className="vd-text-action" onClick={() => onSelectView("library")}>{isFa ? "مشاهده همه" : "View all"}</button>
        </div>
        {loading ? <LoadingBlock isFa={isFa} /> : !recentVideos.length ? (
          <div className="vd-dashboard-empty"><div><strong>{isFa ? "هنوز ویدیویی ندارید" : "No videos yet"}</strong><p>{isFa ? "اولین ویدیوی خود را برای ترجمه اضافه کنید." : "Add your first video for translation."}</p></div></div>
        ) : (
          <div className="vd-recent-rows">
            {recentVideos.map((video) => <RecentVideoRow key={video.id} video={video} isFa={isFa} statusCopy={t.status} onOpen={onOpenVideo} onRetry={onRetryVideo} />)}
          </div>
        )}
      </section>

      <section className="vd-card vd-new-translation-strip">
        <span className="vd-new-translation-icon" aria-hidden="true"><Upload size={25} strokeWidth={1.55} /></span>
        <div className="vd-new-translation-copy">
          <h2>{isFa ? "ترجمه جدید" : "New translation"}</h2>
          <p>{isFa ? "فایل ویدیو یا لینک یوتیوب را وارد کنید تا ترجمه و زیرنویس ساخته شود." : "Add a video file or YouTube link to create a translation and subtitles."}</p>
        </div>
        <div className="vd-new-translation-actions">
          <button className="vd-primary" onClick={() => onSelectView("new-video")}><Upload size={17} />{isFa ? "آپلود فایل ویدیو" : "Upload video file"}</button>
          <button className="vd-secondary" onClick={() => onSelectView("new-video")}><Link2 size={17} />{isFa ? "افزودن لینک یوتیوب" : "Add YouTube link"}</button>
        </div>
      </section>
    </div>
  );
}
