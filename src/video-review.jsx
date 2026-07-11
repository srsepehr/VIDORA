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
import { Download, Subtitles } from "lucide-react";
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
import {
  SUBTITLE_LABEL,
  SUBTITLE_LANG,
  createSubtitleSignedUrl,
  deriveSubtitleAvailability,
  downloadSubtitleArtifact,
  fetchSubtitleArtifacts,
  isSubtitleDownloadable,
} from "./lib/subtitle-review";
import {
  INSIGHT_STATE_FA,
  activeChapterIndex,
  deriveInsightState,
  fetchVideoChapters,
  fetchVideoInsight,
  takeawaySeekMs,
} from "./lib/insight-review";
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
  const [subtitles, setSubtitles] = React.useState({ state: "none", vtt: null, srt: null });
  const [subtitleUrl, setSubtitleUrl] = React.useState("");
  const [subtitlesOn, setSubtitlesOn] = React.useState(true);
  const [tab, setTab] = React.useState(() => {
    try {
      const stored = window.sessionStorage.getItem(`vidora.review-tab.${video.id}`);
      return ["transcript", "summary", "chapters"].includes(stored) ? stored : "transcript";
    } catch {
      return "transcript";
    }
  });
  const [insightState, setInsightState] = React.useState({ loading: true, state: "none", insight: null, chapters: [] });
  const [activeChapter, setActiveChapter] = React.useState(-1);
  const [selectedChapter, setSelectedChapter] = React.useState(-1);
  const videoRef = React.useRef(null);
  const listRef = React.useRef(null);
  const rowRefs = React.useRef(new Map());
  const mediaRetryRef = React.useRef(0);
  const subtitleRetryRef = React.useRef(0);
  const subtitleBlobRef = React.useRef("");
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

  const loadSubtitles = React.useCallback(async () => {
    try {
      const artifacts = await fetchSubtitleArtifacts(session, video.id);
      setSubtitles(deriveSubtitleAvailability(artifacts));
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.loadSubtitles");
      setSubtitles({ state: "none", vtt: null, srt: null });
    }
  }, [session, video.id]);

  const loadInsights = React.useCallback(async () => {
    setInsightState((previous) => ({ ...previous, loading: true }));
    try {
      const [insight, chapters] = await Promise.all([
        fetchVideoInsight(session, video.id),
        fetchVideoChapters(session, video.id),
      ]);
      const state = deriveInsightState(insight);
      setInsightState({ loading: false, state, insight, chapters: state === "ready" || state === "stale" ? chapters : [] });
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.loadInsights");
      // Insight availability must never block transcript review.
      setInsightState({ loading: false, state: "none", insight: null, chapters: [] });
    }
  }, [session, video.id]);

  const applySubtitleMode = React.useCallback((show) => {
    const player = videoRef.current;
    if (!player || !player.textTracks) return;
    for (const track of player.textTracks) {
      if (track.kind === "subtitles" && track.language === SUBTITLE_LANG) {
        track.mode = show ? "showing" : "hidden";
      }
    }
  }, []);

  // Fetch the private VTT through a fresh short-lived signed URL and expose it
  // to the <track> as a same-origin blob: URL. This avoids any cross-origin
  // <track> CORS requirement and keeps the signed URL out of the DOM. The
  // signed URL is never persisted.
  const loadSubtitleUrl = React.useCallback(async () => {
    if (subtitles.state !== "ready" || !subtitles.vtt?.storage_path) {
      if (subtitleBlobRef.current) { URL.revokeObjectURL(subtitleBlobRef.current); subtitleBlobRef.current = ""; }
      setSubtitleUrl("");
      return;
    }
    try {
      const signedUrl = await createSubtitleSignedUrl(session, subtitles.vtt.storage_path);
      const response = await fetch(signedUrl);
      if (!response.ok) throw new Error(`subtitle fetch ${response.status}`);
      const blob = await response.blob();
      if (subtitleBlobRef.current) URL.revokeObjectURL(subtitleBlobRef.current);
      const blobUrl = URL.createObjectURL(blob);
      subtitleBlobRef.current = blobUrl;
      setSubtitleUrl(blobUrl);
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.loadSubtitleUrl");
      setSubtitleUrl("");
    }
  }, [session, subtitles]);

  React.useEffect(() => {
    loadTranscript();
    loadSignedUrl();
    loadSubtitles();
    loadInsights();
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      if (subtitleBlobRef.current) { URL.revokeObjectURL(subtitleBlobRef.current); subtitleBlobRef.current = ""; }
    };
  }, [loadTranscript, loadSignedUrl, loadSubtitles, loadInsights]);

  React.useEffect(() => {
    try {
      window.sessionStorage.setItem(`vidora.review-tab.${video.id}`, tab);
    } catch {
      // Tab preference is non-critical.
    }
  }, [tab, video.id]);

  React.useEffect(() => {
    subtitleRetryRef.current = 0;
    loadSubtitleUrl();
  }, [loadSubtitleUrl]);

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
    const timeMs = player.currentTime * 1000;
    const nextIndex = findActiveSegmentIndex(segments, timeMs);
    setActiveIndex((current) => current === nextIndex ? current : nextIndex);
    const nextChapter = activeChapterIndex(insightState.chapters, timeMs);
    setActiveChapter((current) => current === nextChapter ? current : nextChapter);
  }, [segments, insightState.chapters]);

  const seekToMs = React.useCallback((milliseconds) => {
    const player = videoRef.current;
    if (!player) return;
    const target = Math.max(0, milliseconds / 1000);
    player.currentTime = Number.isFinite(player.duration) ? Math.min(target, player.duration) : target;
    player.focus();
  }, []);

  const seekToChapter = React.useCallback((chapter, position) => {
    setSelectedChapter(position);
    seekToMs(chapter.start_ms);
  }, [seekToMs]);

  const seekToTakeaway = React.useCallback((takeaway) => {
    // Seek to the first supporting transcript segment (reuses the transcript's
    // own seek + highlight behavior).
    const refs = [...(takeaway.segment_indexes || [])].sort((a, b) => a - b);
    for (const ref of refs) {
      const segment = segments.find((s) => s.segment_index === ref);
      if (segment) {
        seekToSegment(segment);
        return;
      }
    }
  }, [segments, seekToSegment]);

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
    applySubtitleMode(subtitlesOn);
    const resume = resumePlaybackRef.current;
    if (!player || !resume) return;
    player.currentTime = Math.min(resume.time, Number.isFinite(player.duration) ? player.duration : resume.time);
    if (resume.shouldPlay) player.play().catch(() => {});
    resumePlaybackRef.current = null;
  }, [applySubtitleMode, subtitlesOn]);

  const handleTrackLoad = React.useCallback(() => {
    applySubtitleMode(subtitlesOn);
  }, [applySubtitleMode, subtitlesOn]);

  // A genuine subtitle media-access failure (e.g. an expired signed URL) gets a
  // single fresh URL — never a regenerate, never an infinite loop.
  const handleTrackError = React.useCallback(() => {
    if (subtitleRetryRef.current >= 1 || subtitles.state !== "ready") return;
    subtitleRetryRef.current += 1;
    loadSubtitleUrl();
  }, [loadSubtitleUrl, subtitles.state]);

  const toggleSubtitles = React.useCallback(() => {
    setSubtitlesOn((previous) => {
      const next = !previous;
      applySubtitleMode(next);
      return next;
    });
  }, [applySubtitleMode]);

  const downloadSubtitle = React.useCallback(async (artifact) => {
    try {
      await downloadSubtitleArtifact(session, artifact);
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "ProcessedVideoReview.downloadSubtitle");
      announceCopy(appError.messageFa);
    }
  }, [session, announceCopy]);

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

  const subtitleStatusText = {
    ready: "زیرنویس فارسی آماده است",
    generating: "در حال آماده‌سازی زیرنویس فارسی",
    failed: "ساخت زیرنویس انجام نشد؛ ترجمه متنی همچنان در دسترس است",
    stale: "زیرنویس فارسی با متن به‌روزشده هم‌خوان نیست",
    none: "ترجمه متنی آماده است، اما فایل زیرنویس هنوز ساخته نشده",
  }[subtitles.state];

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
              >
                {subtitleUrl ? (
                  <track
                    key={subtitleUrl}
                    kind="subtitles"
                    srcLang={SUBTITLE_LANG}
                    label={SUBTITLE_LABEL}
                    src={subtitleUrl}
                    default
                    onLoad={handleTrackLoad}
                    onError={handleTrackError}
                  />
                ) : null}
              </video>
            ) : null}
            {mediaState.error ? (
              <div className="vdr-media-state is-error" role="alert">
                <Play size={25} />
                <span>{mediaState.error}</span>
                <button type="button" className="vd-secondary" onClick={() => { mediaRetryRef.current = 0; loadSignedUrl(); }}>تلاش دوباره</button>
              </div>
            ) : null}
          </div>
          <div className="vdr-subtitle-bar" data-state={subtitles.state}>
            <span className="vdr-subtitle-status">
              <Subtitles size={15} /> {subtitleStatusText}
            </span>
            <div className="vdr-subtitle-actions">
              {subtitles.state === "ready" && subtitleUrl ? (
                <button type="button" className="vd-secondary" onClick={toggleSubtitles} aria-pressed={subtitlesOn}>
                  {subtitlesOn ? "خاموش کردن زیرنویس" : "روشن کردن زیرنویس"}
                </button>
              ) : null}
              {isSubtitleDownloadable(subtitles.vtt) ? (
                <button type="button" className="vdr-download" onClick={() => downloadSubtitle(subtitles.vtt)}>
                  <Download size={14} /> دانلود WebVTT
                </button>
              ) : null}
              {isSubtitleDownloadable(subtitles.srt) ? (
                <button type="button" className="vdr-download" onClick={() => downloadSubtitle(subtitles.srt)}>
                  <Download size={14} /> دانلود SRT
                </button>
              ) : null}
            </div>
          </div>
          <div className="vdr-player-meta">
            <span>تاریخ آپلود: {new Date(video.created_at).toLocaleString("fa-IR")}</span>
            <span>منبع: {video.source_type === "upload" ? "فایل آپلودشده" : "لینک عمومی"}</span>
          </div>
        </article>

        <article className="vd-card vdr-transcript-card">
          <div className="vdr-tabs" role="tablist" aria-label="بخش‌های بررسی ویدیو">
            {[
              ["transcript", "متن و ترجمه"],
              ["summary", "خلاصه"],
              ["chapters", "فصل‌ها"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={tab === value ? "is-active" : ""}
                onClick={() => setTab(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "summary" ? (
            <div className="vdr-insight-panel" role="tabpanel" aria-label="خلاصه و نکات کلیدی">
              {insightState.loading ? (
                <p className="vdr-insight-status"><Loader2 size={16} className="vd-spin" /> در حال دریافت خلاصه...</p>
              ) : insightState.state === "ready" || insightState.state === "stale" ? (
                <>
                  {insightState.state === "stale" ? (
                    <p className="vdr-insight-status is-warning" role="status">{INSIGHT_STATE_FA.stale} نسخه قبلی در ادامه نمایش داده می‌شود.</p>
                  ) : null}
                  <section className="vdr-insight-block">
                    <h3>خلاصه کوتاه</h3>
                    <p dir="rtl">{insightState.insight?.short_summary}</p>
                  </section>
                  <section className="vdr-insight-block">
                    <h3>خلاصه کامل</h3>
                    <p dir="rtl">{insightState.insight?.detailed_summary}</p>
                  </section>
                  <section className="vdr-insight-block">
                    <h3>نکات کلیدی</h3>
                    <ul className="vdr-takeaways">
                      {(insightState.insight?.key_takeaways || []).map((takeaway, position) => (
                        <li key={position}>
                          <span dir="rtl">{takeaway.text}</span>
                          {takeawaySeekMs(takeaway, segments) !== null ? (
                            <button type="button" onClick={() => seekToTakeaway(takeaway)}>
                              <Play size={13} /> رفتن به بخش مرتبط
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                  {insightState.insight?.generated_at ? (
                    <p className="vdr-insight-meta">تاریخ ساخت: {new Date(insightState.insight.generated_at).toLocaleString("fa-IR")}</p>
                  ) : null}
                </>
              ) : (
                <p className="vdr-insight-status" role="status">{INSIGHT_STATE_FA[insightState.state]}</p>
              )}
            </div>
          ) : null}

          {tab === "chapters" ? (
            <div className="vdr-insight-panel" role="tabpanel" aria-label="فصل‌های ویدیو">
              {insightState.loading ? (
                <p className="vdr-insight-status"><Loader2 size={16} className="vd-spin" /> در حال دریافت فصل‌ها...</p>
              ) : (insightState.state === "ready" || insightState.state === "stale") && insightState.chapters.length ? (
                <>
                  {insightState.state === "stale" ? (
                    <p className="vdr-insight-status is-warning" role="status">{INSIGHT_STATE_FA.stale}</p>
                  ) : null}
                  <ol className="vdr-chapters" aria-label="فهرست فصل‌ها">
                    {insightState.chapters.map((chapter, position) => (
                      <li key={chapter.chapter_index}>
                        <button
                          type="button"
                          className={`vdr-chapter${activeChapter === position ? " is-active" : ""}${selectedChapter === position ? " is-selected" : ""}`}
                          onClick={() => seekToChapter(chapter, position)}
                        >
                          <time dir="ltr">{formatTranscriptTimestamp(chapter.start_ms)}</time>
                          <span className="vdr-chapter-copy">
                            <b dir="rtl">{chapter.title}</b>
                            {chapter.description ? <small dir="rtl">{chapter.description}</small> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <p className="vdr-insight-status" role="status">{INSIGHT_STATE_FA[insightState.state === "ready" ? "none" : insightState.state]}</p>
              )}
            </div>
          ) : null}

          {tab === "transcript" ? (<>
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
          </>) : null}
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
