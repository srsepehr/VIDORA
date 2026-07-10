import React from "react";
import {
  CheckCircle2,
  Clipboard,
  Copy,
  Eye,
  FileText,
  Languages,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { logAppError, toAppError } from "./lib/app-error";
import { formatFileSize } from "./lib/video-config";
import { videoStorage } from "./lib/video-storage";
import { deleteVideo } from "./lib/video-service";
import {
  buildTranscriptCopy,
  fetchTranscriptSegments,
  findActiveSegmentIndex,
  findSearchRange,
  formatTranscriptTimestamp,
  prepareTranscript,
  segmentMatchesQuery,
} from "./lib/transcript-review";
import "./video-review.css";

const SIGNED_URL_TTL_SECONDS = 300;
const MODE_KEY_PREFIX = "vidora.transcript-mode.";

function HighlightedText({ text, query }) {
  const range = findSearchRange(text, query);
  if (!range) return text;
  return (
    <>
      {text.slice(0, range[0])}
      <mark>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

const TranscriptRow = React.memo(function TranscriptRow({
  segment,
  mode,
  query,
  active,
  selected,
  onSeek,
  onCopy,
  setRowRef,
}) {
  const timestamp = formatTranscriptTimestamp(segment.start_ms);
  return (
    <li
      ref={(node) => setRowRef(segment.id, node)}
      className={`vdr-segment${active ? " is-active" : ""}${selected ? " is-selected" : ""}`}
      data-segment-index={segment.segment_index}
    >
      <button
        type="button"
        className="vdr-segment-main"
        onClick={() => onSeek(segment)}
        aria-label={`رفتن به زمان ${timestamp}`}
      >
        <time dateTime={`PT${Math.max(0, segment.start_ms / 1000)}S`} dir="ltr">{timestamp}</time>
        <span className="vdr-segment-copy">
          {mode !== "fa" ? (
            <span className="vdr-source" dir={segment.source_language === "fa" ? "rtl" : "ltr"}>
              <HighlightedText text={segment.source_text} query={query} />
            </span>
          ) : null}
          {mode !== "source" ? (
            <span className="vdr-fa" dir="rtl">
              <HighlightedText text={segment.translated_text_fa || ""} query={query} />
            </span>
          ) : null}
        </span>
      </button>
      <div className="vdr-segment-actions" aria-label="عملیات کپی">
        {mode !== "fa" ? (
          <button type="button" title="کپی متن اصلی" aria-label="کپی متن اصلی" onClick={() => onCopy(segment.source_text, "متن اصلی کپی شد.")}>
            <Copy size={14} />
          </button>
        ) : null}
        {mode !== "source" ? (
          <button type="button" title="کپی ترجمه فارسی" aria-label="کپی ترجمه فارسی" onClick={() => onCopy(segment.translated_text_fa || "", "ترجمه فارسی کپی شد.")}>
            <Clipboard size={14} />
          </button>
        ) : null}
        {mode === "both" ? (
          <button
            type="button"
            title="کپی هر دو متن"
            aria-label="کپی هر دو متن"
            onClick={() => onCopy(`${segment.source_text}\n${segment.translated_text_fa || ""}`, "هر دو متن کپی شدند.")}
          >
            <Languages size={14} />
          </button>
        ) : null}
      </div>
    </li>
  );
});

function ReviewState({ icon, title, text, actionLabel, onAction, busy = false }) {
  return (
    <article className="vd-card vdr-state" role="status">
      {icon}
      <h2>{title}</h2>
      <p>{text}</p>
      {onAction ? (
        <button type="button" className="vd-primary" onClick={onAction} disabled={busy}>
          {busy ? <Loader2 size={15} className="vd-spin" /> : <RefreshCw size={15} />}
          {actionLabel}
        </button>
      ) : null}
    </article>
  );
}

export function ProcessedVideoReview({ session, video, job, isFa, onBack, onDeleted }) {
  const [transcriptState, setTranscriptState] = React.useState({ loading: true, error: "", report: null });
  const [mediaState, setMediaState] = React.useState({ loading: true, url: "", error: "" });
  const [mode, setMode] = React.useState(() => {
    try {
      return window.sessionStorage.getItem(`${MODE_KEY_PREFIX}${video.id}`) || "both";
    } catch {
      return "both";
    }
  });
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [selectedId, setSelectedId] = React.useState("");
  const [followPlayback, setFollowPlayback] = React.useState(true);
  const [copyNotice, setCopyNotice] = React.useState("");
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const videoRef = React.useRef(null);
  const listRef = React.useRef(null);
  const rowRefs = React.useRef(new Map());
  const mediaRetryRef = React.useRef(0);
  const resumePlaybackRef = React.useRef(null);
  const noticeTimerRef = React.useRef(null);

  const loadTranscript = React.useCallback(async () => {
    setTranscriptState({ loading: true, error: "", report: null });
    try {
      const rows = await fetchTranscriptSegments(session, video.id);
      const report = prepareTranscript(rows);
      if (report.duplicateIndexes.length || report.invalidIndexes.length || report.missingSourceIndexes.length) {
        console.error("[Vidora] transcript integrity warning", {
          videoId: video.id,
          duplicateCount: report.duplicateIndexes.length,
          invalidCount: report.invalidIndexes.length,
          missingSourceCount: report.missingSourceIndexes.length,
        });
      }
      setTranscriptState({ loading: false, error: "", report });
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.loadTranscript");
      setTranscriptState({ loading: false, error: appError.messageFa, report: null });
    }
  }, [session, video.id]);

  const loadSignedUrl = React.useCallback(async (refreshing = false) => {
    if (!video.storage_key) {
      setMediaState({
        loading: false,
        url: "",
        error: video.source_type === "upload"
          ? "فایل اصلی این ویدیو در فضای خصوصی پیدا نشد."
          : "پخش مستقیم این منبع در مرورگر پشتیبانی نمی‌شود.",
      });
      return;
    }
    setMediaState((previous) => ({ loading: true, url: refreshing ? previous.url : "", error: "" }));
    try {
      const url = await videoStorage.createSignedReadUrl(session, video.storage_key, SIGNED_URL_TTL_SECONDS);
      setMediaState({ loading: false, url, error: "" });
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.loadSignedUrl");
      setMediaState({
        loading: false,
        url: "",
        error: appError.code === "STORAGE_OBJECT_MISSING"
          ? "فایل اصلی ویدیو در فضای خصوصی پیدا نشد."
          : "دسترسی امن به فایل ویدیو ممکن نشد.",
      });
    }
  }, [session, video.storage_key, video.source_type]);

  React.useEffect(() => {
    loadTranscript();
    loadSignedUrl();
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, [loadTranscript, loadSignedUrl]);

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(`${MODE_KEY_PREFIX}${video.id}`, mode);
    } catch {
      // Display preference is non-critical.
    }
  }, [mode, video.id]);

  const segments = transcriptState.report?.segments || [];
  const filteredSegments = React.useMemo(
    () => segments.filter((segment) => segmentMatchesQuery(segment, query)),
    [segments, query],
  );

  React.useEffect(() => {
    if (!followPlayback || activeIndex < 0) return;
    const segment = segments[activeIndex];
    const row = segment ? rowRefs.current.get(segment.id) : null;
    if (!row) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
  }, [activeIndex, followPlayback, segments]);

  const announceCopy = React.useCallback((message) => {
    setCopyNotice(message);
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setCopyNotice(""), 2500);
  }, []);

  const copyText = React.useCallback(async (text, successMessage) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      announceCopy(successMessage);
    } catch {
      announceCopy("کپی متن ممکن نشد.");
    }
  }, [announceCopy]);

  const seekToSegment = React.useCallback((segment) => {
    const player = videoRef.current;
    if (!player) return;
    const target = Math.max(0, segment.start_ms / 1000);
    player.currentTime = Number.isFinite(player.duration) ? Math.min(target, player.duration) : target;
    setSelectedId(segment.id);
    setFollowPlayback(true);
    setActiveIndex(findActiveSegmentIndex(segments, segment.start_ms));
    player.focus();
  }, [segments]);

  const handleTimeUpdate = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    const nextIndex = findActiveSegmentIndex(segments, player.currentTime * 1000);
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
  }, [segments]);

  const handleMediaError = React.useCallback(() => {
    const player = videoRef.current;
    if (!video.storage_key || mediaRetryRef.current >= 1) {
      setMediaState((previous) => ({
        ...previous,
        loading: false,
        error: "پخش این فایل در مرورگر ممکن نشد یا فرمت آن پشتیبانی نمی‌شود.",
      }));
      return;
    }
    mediaRetryRef.current += 1;
    resumePlaybackRef.current = {
      time: player?.currentTime || 0,
      shouldPlay: Boolean(player && !player.paused),
    };
    loadSignedUrl(true);
  }, [loadSignedUrl, video.storage_key]);

  const handleLoadedMetadata = React.useCallback(() => {
    const player = videoRef.current;
    const resume = resumePlaybackRef.current;
    if (!player || !resume) return;
    player.currentTime = Math.min(resume.time, Number.isFinite(player.duration) ? player.duration : resume.time);
    if (resume.shouldPlay) player.play().catch(() => {});
    resumePlaybackRef.current = null;
  }, []);

  if (transcriptState.loading) {
    return <ReviewState icon={<Loader2 size={28} className="vd-spin" />} title="در حال دریافت متن و ترجمه..." text="اطلاعات پردازش‌شده از فضای امن Vidora دریافت می‌شود." />;
  }

  if (transcriptState.error) {
    return <ReviewState icon={<FileText size={28} />} title="دریافت متن ممکن نشد" text={transcriptState.error} actionLabel="تلاش دوباره" onAction={loadTranscript} />;
  }

  const report = transcriptState.report;
  if (!report || report.segments.length === 0) {
    return <ReviewState icon={<FileText size={28} />} title="متن ویدیو هنوز آماده نیست" text="هیچ بخش متنی برای این ویدیو ثبت نشده است. وضعیت پردازش را دوباره بررسی کنید." actionLabel="بررسی دوباره" onAction={loadTranscript} />;
  }

  if (report.duplicateIndexes.length || report.invalidIndexes.length || report.missingSourceIndexes.length) {
    return (
      <ReviewState
        icon={<FileText size={28} />}
        title="اطلاعات متن نیاز به بررسی دارد"
        text="ترتیب یا زمان‌بندی بعضی بخش‌ها ناسازگار است. برای جلوگیری از نمایش نادرست، مرور متن متوقف شده است."
        actionLabel="دریافت دوباره"
        onAction={loadTranscript}
      />
    );
  }

  if (!report.isComplete) {
    return (
      <ReviewState
        icon={<Languages size={28} />}
        title="ترجمه فارسی هنوز کامل نیست"
        text={`${report.missingTranslationIndexes.length.toLocaleString("fa-IR")} بخش هنوز ترجمه فارسی کامل ندارد. ترجمه متنی فقط پس از کامل شدن همه بخش‌ها برای بررسی نمایش داده می‌شود.`}
        actionLabel="بررسی دوباره"
        onAction={loadTranscript}
      />
    );
  }

  const firstSegment = segments[0];
  const confidences = segments.map((segment) => segment.confidence).filter((value) => Number.isFinite(value));
  const averageConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : null;
  const activeId = activeIndex >= 0 ? segments[activeIndex]?.id : "";
  const title = video.title || video.original_filename || "ویدیوی بدون عنوان";

  return (
    <section className="vdr-review" dir={isFa ? "rtl" : "ltr"}>
      <header className="vdr-header">
        <div>
          <span className="vdr-ready"><CheckCircle2 size={15} /> ترجمه متنی آماده بررسی است</span>
          <h2 dir="auto">{title}</h2>
          <div className="vdr-metadata">
            {video.detected_language ? <span>زبان اصلی: <b dir="ltr">{video.detected_language}</b></span> : null}
            <span>زبان ترجمه: فارسی</span>
            {video.duration_seconds ? <span>{formatTranscriptTimestamp(video.duration_seconds * 1000)}</span> : null}
            <span>{segments.length.toLocaleString("fa-IR")} بخش</span>
            {video.file_size_bytes ? <span dir="ltr">{formatFileSize(video.file_size_bytes, "fa")}</span> : null}
            {averageConfidence !== null ? <span>{Math.round(averageConfidence * 100).toLocaleString("fa-IR")}٪ اطمینان میانگین</span> : null}
          </div>
          <div className="vdr-provider-meta">
            {firstSegment.source_language ? <span>تشخیص زبان: <b dir="ltr">{firstSegment.source_language}</b></span> : null}
            {firstSegment.translation_provider ? <span>ترجمه: <b dir="ltr">{firstSegment.translation_provider}</b></span> : null}
            {firstSegment.translation_model ? <span>مدل: <b dir="ltr">{firstSegment.translation_model}</b></span> : null}
            {job?.finished_at ? <span>پایان پردازش: {new Date(job.finished_at).toLocaleString("fa-IR")}</span> : null}
          </div>
        </div>
        <div className="vdr-header-actions">
          <button type="button" className="vd-secondary" onClick={onBack}>بازگشت</button>
          <button type="button" className="vd-secondary danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 size={15} /> حذف
          </button>
        </div>
      </header>

      <div className="vdr-grid">
        <article className="vd-card vdr-player-card">
          <div className="vdr-player-shell">
            {mediaState.loading ? (
              <div className="vdr-media-state"><Loader2 size={25} className="vd-spin" /><span>در حال آماده‌سازی پخش امن...</span></div>
            ) : null}
            {mediaState.url ? (
              <video
                key={mediaState.url}
                ref={videoRef}
                className="vdr-player"
                src={mediaState.url}
                controls
                preload="metadata"
                playsInline
                onTimeUpdate={handleTimeUpdate}
                onError={handleMediaError}
                onLoadedMetadata={handleLoadedMetadata}
                aria-label={`پخش ${title}`}
              />
            ) : null}
            {mediaState.error ? (
              <div className="vdr-media-state is-error" role="alert">
                <Play size={25} />
                <span>{mediaState.error}</span>
                <button type="button" className="vd-secondary" onClick={() => { mediaRetryRef.current = 0; loadSignedUrl(); }}>تلاش دوباره</button>
              </div>
            ) : null}
          </div>
          <div className="vdr-player-meta">
            <span>تاریخ آپلود: {new Date(video.created_at).toLocaleString("fa-IR")}</span>
            <span>منبع: {video.source_type === "upload" ? "فایل آپلودشده" : "لینک عمومی"}</span>
          </div>
        </article>

        <article className="vd-card vdr-transcript-card">
          <div className="vdr-toolbar">
            <div className="vdr-search">
              <Search size={17} />
              <label className="vdr-sr-only" htmlFor={`transcript-search-${video.id}`}>جست‌وجوی متن و ترجمه</label>
              <input
                id={`transcript-search-${video.id}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="جست‌وجو در متن و ترجمه"
                type="search"
              />
              {query ? <button type="button" aria-label="پاک کردن جست‌وجو" onClick={() => setQuery("")}><X size={15} /></button> : null}
            </div>
            <span className="vdr-result-count" aria-live="polite">{filteredSegments.length.toLocaleString("fa-IR")} نتیجه</span>
          </div>

          <div className="vdr-controls">
            <div className="vdr-modes" role="group" aria-label="نوع نمایش متن">
              {[
                ["both", "هر دو متن"],
                ["source", "فقط متن اصلی"],
                ["fa", "فقط ترجمه فارسی"],
              ].map(([value, label]) => (
                <button key={value} type="button" className={mode === value ? "is-active" : ""} aria-pressed={mode === value} onClick={() => setMode(value)}>
                  {label}
                </button>
              ))}
            </div>
            <div className="vdr-copy-all">
              <button type="button" onClick={() => copyText(buildTranscriptCopy(segments, "source"), "متن کامل اصلی کپی شد.")}>
                <Copy size={14} /> کپی متن اصلی
              </button>
              <button type="button" onClick={() => copyText(buildTranscriptCopy(segments, "fa"), "ترجمه کامل فارسی کپی شد.")}>
                <Clipboard size={14} /> کپی ترجمه فارسی
              </button>
            </div>
          </div>

          {!followPlayback ? (
            <button type="button" className="vdr-follow" onClick={() => { setFollowPlayback(true); if (activeId) rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" }); }}>
              <Eye size={15} /> دنبال کردن پخش
            </button>
          ) : null}

          <ol
            ref={listRef}
            className="vdr-list"
            onWheel={() => setFollowPlayback(false)}
            onTouchStart={() => setFollowPlayback(false)}
            aria-label="بخش‌های متن و ترجمه"
          >
            {filteredSegments.length ? filteredSegments.map((segment) => (
              <TranscriptRow
                key={segment.id}
                segment={segment}
                mode={mode}
                query={query}
                active={activeId === segment.id}
                selected={selectedId === segment.id}
                onSeek={seekToSegment}
                onCopy={copyText}
                setRowRef={(id, node) => {
                  if (node) rowRefs.current.set(id, node);
                  else rowRefs.current.delete(id);
                }}
              />
            )) : (
              <li className="vdr-no-results">نتیجه‌ای در متن اصلی یا ترجمه فارسی پیدا نشد.</li>
            )}
          </ol>
        </article>
      </div>

      <p className="vdr-live" aria-live="polite">{copyNotice}</p>

      {deleteOpen ? (
        <div className="vd-modal" role="dialog" aria-modal="true" aria-labelledby="vdr-delete-title">
          <div className="vd-modal-card">
            <h2 id="vdr-delete-title">ویدیو حذف شود؟</h2>
            <p>فایل، متن و همه اطلاعات پردازش این ویدیو برای همیشه حذف می‌شود.</p>
            <div className="vd-modal-actions">
              <button type="button" className="vd-secondary" disabled={deleteBusy} onClick={() => setDeleteOpen(false)}>انصراف</button>
              <button
                type="button"
                className="vd-primary"
                disabled={deleteBusy}
                onClick={async () => {
                  setDeleteBusy(true);
                  try {
                    await deleteVideo(session, video);
                    onDeleted();
                  } catch (error) {
                    const appError = toAppError(error);
                    logAppError(appError, "ProcessedVideoReview.delete");
                    announceCopy(appError.messageFa);
                    setDeleteOpen(false);
                  } finally {
                    setDeleteBusy(false);
                  }
                }}
              >
                {deleteBusy ? <Loader2 size={15} className="vd-spin" /> : <Trash2 size={15} />} حذف قطعی
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
