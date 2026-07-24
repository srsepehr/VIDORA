import React from "react";
import {
  ArrowLeft,
  Bookmark,
  CircleHelp,
  Clock3,
  Link2,
  PlaySquare,
  Plus,
  Upload,
  UploadCloud,
  Video,
} from "lucide-react";

// Thumbnails come from the real record only. Vidora does not resolve a public
// URL for `thumbnail_storage_key` yet, so the tile stays a monochrome
// placeholder and the duration badge is rendered only when the stored
// duration is real.
function VideoThumb({ duration, compact = false, wide = false }) {
  const className = ["vd-dashboard-thumb", compact ? "is-compact" : "", wide ? "is-wide" : ""].filter(Boolean).join(" ");
  return (
    <div className={className} aria-hidden="true">
      <span className="vd-dashboard-thumb-wave" />
      <PlaySquare size={compact ? 17 : 20} strokeWidth={1.45} />
      {duration ? <small dir="ltr">{duration}</small> : null}
    </div>
  );
}

function ActionCard({ icon: Icon, title, description, onClick, tone = "light" }) {
  return (
    <button type="button" className={`vd-action-card${tone === "dark" ? " is-primary" : ""}`} onClick={onClick}>
      <span className="vd-action-card-top">
        <span className="vd-action-card-icon" aria-hidden="true"><Icon size={19} strokeWidth={1.7} /></span>
        <span className="vd-action-card-title">{title}</span>
      </span>
      <span className="vd-action-card-text">{description}</span>
      <ArrowLeft className="vd-action-card-arrow" size={17} strokeWidth={1.6} aria-hidden="true" />
    </button>
  );
}

function SectionCard({ title, actionLabel, onAction, children }) {
  return (
    <section className="vd-card vd-dashboard-section">
      <div className="vd-dashboard-section-head">
        <h2>{title}</h2>
        {actionLabel ? <button type="button" className="vd-text-action" onClick={onAction}>{actionLabel}</button> : null}
      </div>
      {children}
    </section>
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

function ErrorBlock({ isFa, error, onReload }) {
  return (
    <div className="vd-dashboard-empty is-error">
      <div>
        <strong>{isFa ? "دریافت اطلاعات ممکن نشد" : "Could not load dashboard"}</strong>
        <p>{error}</p>
      </div>
      <button type="button" className="vd-secondary" onClick={onReload}>{isFa ? "تلاش دوباره" : "Retry"}</button>
    </div>
  );
}

function ContinueRow({ video, isFa, onOpen }) {
  const locale = isFa ? "fa-IR" : "en-US";
  const hasProgress = Number.isFinite(video.progressPercent);
  const percent = hasProgress ? Math.max(0, Math.min(100, video.progressPercent)) : null;
  const meta = [video.sourceType, video.durationLabel].filter(Boolean).join(" · ");
  return (
    <button type="button" className="vd-continue-row" onClick={() => onOpen(video.id)}>
      <VideoThumb duration={video.durationLabel} compact />
      <span className="vd-continue-copy">
        <span className="vd-continue-title" dir="auto">{video.title}</span>
        <span className="vd-continue-meta">{video.stage}{meta ? ` · ${meta}` : ""}</span>
      </span>
      <span
        className={`vd-meter${hasProgress ? "" : " is-indeterminate"}`}
        role="progressbar"
        aria-label={video.stage}
        aria-valuemin={hasProgress ? 0 : undefined}
        aria-valuemax={hasProgress ? 100 : undefined}
        aria-valuenow={hasProgress ? percent : undefined}
        aria-valuetext={hasProgress ? undefined : video.stage}
      >
        <span style={hasProgress ? { width: `${percent}%` } : undefined} />
      </span>
      <span className="vd-continue-percent">{hasProgress ? `${percent.toLocaleString(locale)}${isFa ? "٪" : "%"}` : ""}</span>
    </button>
  );
}

function RecentVideoCard({ video, isFa, onOpen, onRetry }) {
  const failed = video.status === "Failed";
  const label = failed
    ? (isFa ? "تلاش مجدد" : "Retry")
    : (isFa ? "باز کردن" : "Open");
  return (
    <button
      type="button"
      className="vd-recent-card"
      aria-label={`${label}: ${video.title}`}
      onClick={() => (failed ? onRetry(video) : onOpen(video.id))}
    >
      <VideoThumb duration={video.durationLabel} wide />
      <span className="vd-recent-card-title" dir="auto">{video.title}</span>
      <span className="vd-recent-card-meta">{failed && video.failure ? video.failure : video.stage}</span>
    </button>
  );
}

export function DashboardHome({
  isFa,
  t,
  loading,
  error,
  videos,
  userName,
  onOpenVideo,
  onRetryVideo,
  onSelectView,
  onOpenGuide,
  onOpenProcessing,
  onReload,
}) {
  // Only real records feed these lists; there is no fixture fallback.
  const unfinished = videos.filter((video) => video.status === "Processing").slice(0, 3);
  const recentVideos = videos.slice(0, 5);
  const greetingName = (userName || "").trim();
  const showContinue = loading || Boolean(error) || unfinished.length > 0;

  return (
    <div className="vd-dashboard-home">
      <header className="vd-home-head">
        <div className="vd-home-head-copy">
          <h1>
            {isFa
              ? <>خوش آمدید{greetingName ? `، ${greetingName}` : ""} <span aria-hidden="true">👋</span></>
              : <>Welcome back{greetingName ? `, ${greetingName}` : ""} <span aria-hidden="true">👋</span></>}
          </h1>
          <p>
            {isFa
              ? "از اینجا می‌توانید ویدیوهای خود را مدیریت کنید و یادگیری خود را ادامه دهید."
              : "Manage your videos and continue learning from one quiet place."}
          </p>
        </div>
        <button type="button" className="vd-secondary vd-guide-button" onClick={onOpenGuide}>
          <CircleHelp size={16} strokeWidth={1.7} aria-hidden="true" />
          {isFa ? "راهنمای شروع" : "Getting started"}
        </button>
      </header>

      <section className="vd-action-grid" aria-label={isFa ? "دسترسی سریع" : "Quick actions"}>
        <ActionCard
          icon={Plus}
          tone="dark"
          title={isFa ? "ترجمه جدید" : "New translation"}
          description={isFa ? "ویدیو یا لینک یوتیوب را برای ترجمه اضافه کنید" : "Add a video file or YouTube link to translate"}
          onClick={() => onSelectView("new-video")}
        />
        <ActionCard
          icon={Bookmark}
          title={isFa ? "علاقه‌مندی‌ها" : "Favourites"}
          description={isFa ? "ویدیوهای مورد علاقه خود را ببینید" : "Open the videos you marked as favourites"}
          onClick={() => onSelectView("saved")}
        />
        <ActionCard
          icon={Clock3}
          title={isFa ? "ادامه کارها" : "Continue working"}
          description={isFa ? "ویدیوهایی که پردازش آن‌ها کامل نشده است" : "Videos whose processing is not finished yet"}
          onClick={onOpenProcessing}
        />
        <ActionCard
          icon={Video}
          title={isFa ? "ویدیوهای من" : "My videos"}
          description={isFa ? "ویدیوهای آپلودشده خود را مدیریت کنید" : "Manage the videos you uploaded"}
          onClick={() => onSelectView("library")}
        />
      </section>

      {showContinue ? (
        <SectionCard
          title={isFa ? "ادامه کارها" : "Continue working"}
          actionLabel={isFa ? "مشاهده همه" : "View all"}
          onAction={onOpenProcessing}
        >
          {loading ? <LoadingBlock isFa={isFa} /> : error ? <ErrorBlock isFa={isFa} error={error} onReload={onReload} /> : (
            <div className="vd-continue-rows">
              {unfinished.map((video) => <ContinueRow key={video.id} video={video} isFa={isFa} onOpen={onOpenVideo} />)}
            </div>
          )}
        </SectionCard>
      ) : null}

      <SectionCard
        title={isFa ? "ویدیوهای اخیر" : "Recent videos"}
        actionLabel={isFa ? "مشاهده همه" : "View all"}
        onAction={() => onSelectView("library")}
      >
        {loading ? <LoadingBlock isFa={isFa} /> : error ? <ErrorBlock isFa={isFa} error={error} onReload={onReload} /> : !recentVideos.length ? (
          <div className="vd-dashboard-empty">
            <span aria-hidden="true"><Video size={22} strokeWidth={1.6} /></span>
            <div>
              <strong>{isFa ? "هنوز ویدیویی ندارید" : "No videos yet"}</strong>
              <p>{isFa ? "اولین ویدیوی خود را برای ترجمه اضافه کنید." : "Add your first video for translation."}</p>
            </div>
            <button type="button" className="vd-secondary" onClick={() => onSelectView("new-video")}>
              {t.actions.startTranslation}
            </button>
          </div>
        ) : (
          <div className="vd-recent-grid">
            {recentVideos.map((video) => (
              <RecentVideoCard key={video.id} video={video} isFa={isFa} onOpen={onOpenVideo} onRetry={onRetryVideo} />
            ))}
          </div>
        )}
      </SectionCard>

      <section className="vd-upload-panel">
        <span className="vd-upload-panel-icon" aria-hidden="true"><UploadCloud size={27} strokeWidth={1.4} /></span>
        <div className="vd-upload-panel-copy">
          <h2>{isFa ? "ترجمه جدید" : "New translation"}</h2>
          <p>
            {isFa
              ? "فایل ویدیو یا لینک یوتیوب را انتخاب یا وارد کنید تا ترجمه و زیرنویس آن را بسازیم."
              : "Choose a video file or paste a YouTube link and we will build the translation and subtitles."}
          </p>
        </div>
        <div className="vd-upload-panel-actions">
          <button type="button" className="vd-primary" onClick={() => onSelectView("new-video")}>
            <Upload size={16} strokeWidth={1.8} aria-hidden="true" />
            {isFa ? "انتخاب فایل" : "Choose a file"}
          </button>
          <button type="button" className="vd-secondary" onClick={() => onSelectView("new-video")}>
            <Link2 size={16} strokeWidth={1.8} aria-hidden="true" />
            {isFa ? "لینک یوتیوب" : "YouTube link"}
          </button>
        </div>
      </section>
    </div>
  );
}
