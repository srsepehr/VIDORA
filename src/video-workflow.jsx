// Real video intake (file upload + URL submission) and the persisted
// processing status page for the dashboard. Uses the typed service layer —
// every state shown here is read from Supabase; there is no simulated
// progress and no timer-driven stage transition.
import React from "react";
import { CheckCircle2, Circle, Clock3, FileText, Link2, Loader2, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { logAppError, toAppError } from "./lib/app-error";
import { formatFileSize, getVideoUploadConfig } from "./lib/video-config";
import {
  cancelVideoProcessing,
  deleteVideo,
  fetchLatestJob,
  fetchVideoById,
  retryVideoProcessing,
  startVideoUpload,
  submitVideoUrl,
  validateVideoFile,
} from "./lib/video-service";

// ---------------------------------------------------------------------------
// Status metadata (labels only — state itself always comes from the backend)
// ---------------------------------------------------------------------------

export const VIDEO_STATUS_LABELS = {
  created: { fa: "ایجاد شده", en: "Created" },
  uploading: { fa: "در حال آپلود", en: "Uploading" },
  uploaded: { fa: "آپلود شد", en: "Uploaded" },
  validating: { fa: "در حال بررسی", en: "Validating" },
  queued: { fa: "در صف پردازش", en: "Queued" },
  acquiring_source: { fa: "دریافت ویدیو", en: "Acquiring source" },
  downloading_source: { fa: "دریافت ویدیو", en: "Acquiring source" },
  extracting_audio: { fa: "آماده‌سازی فایل صوتی", en: "Extracting audio" },
  transcribing: { fa: "تشخیص گفتار", en: "Transcribing" },
  translating: { fa: "ترجمه به فارسی", en: "Translating" },
  generating_subtitles: { fa: "ساخت زیرنویس", en: "Generating subtitles" },
  rendering: { fa: "آماده‌سازی نسخه نهایی", en: "Rendering" },
  uploading_result: { fa: "بارگذاری خروجی", en: "Uploading result" },
  completed: { fa: "آماده", en: "Ready" },
  failed: { fa: "ناموفق", en: "Failed" },
  cancelled: { fa: "لغو شده", en: "Cancelled" },
};

const ACTIVE_STATUSES = new Set([
  "created",
  "uploading",
  "uploaded",
  "validating",
  "queued",
  "acquiring_source",
  "downloading_source",
  "extracting_audio",
  "transcribing",
  "translating",
  "generating_subtitles",
  "rendering",
  "uploading_result",
]);

const CANCELLABLE_STATUSES = new Set(["created", "uploading", "uploaded", "validating", "queued"]);

export function statusLabel(status, isFa) {
  const entry = VIDEO_STATUS_LABELS[status] || VIDEO_STATUS_LABELS.created;
  return isFa ? entry.fa : entry.en;
}

export function isActiveVideoStatus(status) {
  return ACTIVE_STATUSES.has(status);
}

// The eight user-facing pipeline stages, mapped from backend statuses.
const PIPELINE_STAGES = [
  { fa: "دریافت و بررسی ویدیو", en: "Receive & validate video", statuses: ["created", "uploading", "uploaded", "validating", "queued", "acquiring_source", "downloading_source"] },
  { fa: "آماده‌سازی فایل صوتی", en: "Prepare audio", statuses: ["extracting_audio"] },
  { fa: "تشخیص گفتار و زمان‌بندی جمله‌ها", en: "Transcribe speech & timing", statuses: ["transcribing"] },
  { fa: "ترجمه کامل محتوا به فارسی", en: "Translate everything to Persian", statuses: ["translating"] },
  { fa: "ساخت و هماهنگ‌سازی زیرنویس", en: "Build & sync subtitles", statuses: ["generating_subtitles"] },
  { fa: "آماده‌سازی نسخه نهایی", en: "Render final version", statuses: ["rendering"] },
  { fa: "بارگذاری خروجی", en: "Upload output", statuses: ["uploading_result"] },
  { fa: "ویدیو آماده است", en: "Video is ready", statuses: ["completed"] },
];

function currentStageIndex(status) {
  const index = PIPELINE_STAGES.findIndex((stage) => stage.statuses.includes(status));
  return index === -1 ? -1 : index;
}

// ---------------------------------------------------------------------------
// Intake panel: real upload + URL submission
// ---------------------------------------------------------------------------

export function TranslationIntakePanel({ session, isFa, copy, onCreated }) {
  const config = getVideoUploadConfig();
  const fileInputRef = React.useRef(null);
  const uploadHandleRef = React.useRef(null);
  const [file, setFile] = React.useState(null);
  const [fileError, setFileError] = React.useState("");
  const [phase, setPhase] = React.useState("idle"); // idle | creating | uploading | verifying | queueing
  const [progress, setProgress] = React.useState(null);
  const [dragOver, setDragOver] = React.useState(false);

  const [url, setUrl] = React.useState("");
  const [ownershipConfirmed, setOwnershipConfirmed] = React.useState(false);
  const [urlError, setUrlError] = React.useState("");
  const [urlBusy, setUrlBusy] = React.useState(false);

  const busy = phase !== "idle";

  const acceptFile = (candidate) => {
    if (!candidate || busy) return;
    setFileError("");
    try {
      validateVideoFile(candidate);
      setFile(candidate);
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "TranslationIntakePanel.validateFile");
      setFile(null);
      setFileError(appError.messageFa);
    }
  };

  const beginUpload = () => {
    if (!file || busy) return;
    setFileError("");
    setProgress({ loadedBytes: 0, totalBytes: file.size, percent: 0 });
    const handle = startVideoUpload(session, file, {
      onPhase: setPhase,
      onProgress: setProgress,
    });
    uploadHandleRef.current = handle;
    handle.promise
      .then((video) => {
        uploadHandleRef.current = null;
        setPhase("idle");
        setFile(null);
        setProgress(null);
        onCreated(video.id);
      })
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "TranslationIntakePanel.upload");
        uploadHandleRef.current = null;
        setPhase("idle");
        setProgress(null);
        setFileError(appError.messageFa);
      });
  };

  const cancelUpload = () => {
    uploadHandleRef.current?.cancel();
  };

  const submitUrl = () => {
    if (urlBusy || busy) return;
    setUrlError("");
    setUrlBusy(true);
    submitVideoUrl(session, url, ownershipConfirmed)
      .then((video) => {
        setUrlBusy(false);
        setUrl("");
        setOwnershipConfirmed(false);
        onCreated(video.id);
      })
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "TranslationIntakePanel.submitUrl");
        setUrlBusy(false);
        setUrlError(appError.messageFa);
      });
  };

  const phaseLabel = () => {
    if (phase === "creating") return isFa ? "در حال ثبت ویدیو..." : "Creating record…";
    if (phase === "uploading") return isFa ? "در حال آپلود" : "Uploading";
    if (phase === "verifying") return isFa ? "در حال تأیید فایل..." : "Verifying file…";
    if (phase === "queueing") return isFa ? "در حال ثبت در صف پردازش..." : "Queueing…";
    return "";
  };

  return (
    <article className="vd-card vd-upload">
      <div className="vd-upload-head"><div><h2>{copy.startTitle}</h2><p>{copy.startText}</p></div></div>

      <div
        className={`vd-drop is-large${dragOver ? " is-over" : ""}`}
        onDragOver={(event) => { event.preventDefault(); if (!busy) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          acceptFile(event.dataTransfer?.files?.[0] || null);
        }}
      >
        <div>
          <span className="vd-drop-icon"><Upload size={26} strokeWidth={1.7} /></span>
          <h3>{isFa ? "آپلود فایل ویدیو" : "Upload a video file"}</h3>
          <p>{isFa ? "فایل را اینجا رها کنید یا از دستگاه انتخاب کنید." : "Drop the file here or choose it from your device."}</p>
          <p>{isFa ? `MP4، MOV یا WebM تا ${config.maxUploadSizeMb.toLocaleString("fa-IR")} مگابایت` : `MP4, MOV, or WebM up to ${config.maxUploadSizeMb} MB`}</p>
          <div className="vd-actions">
            <button className="vd-primary" disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Upload size={17} /> {isFa ? "انتخاب فایل" : "Choose file"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
            hidden
            onChange={(event) => {
              acceptFile(event.target.files?.[0] || null);
              event.target.value = "";
            }}
          />
        </div>
      </div>

      {file ? (
        <div className="vd-upload-file">
          <FileText size={18} />
          <div className="vd-upload-file-info">
            <strong dir="ltr">{file.name}</strong>
            <span>{formatFileSize(file.size, isFa ? "fa" : "en")}</span>
          </div>
          {!busy ? (
            <>
              <button className="vd-primary" onClick={beginUpload}><Upload size={15} /> {isFa ? "شروع آپلود" : "Start upload"}</button>
              <button className="vd-icon-action" aria-label={isFa ? "حذف فایل" : "Remove file"} onClick={() => { setFile(null); setFileError(""); }}><X size={15} /></button>
            </>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <div className="vd-upload-progress" aria-live="polite">
          <div className="vd-plan-line">
            <span>{phaseLabel()}</span>
            {phase === "uploading" && progress ? (
              <strong dir="ltr">
                {progress.percent}% · {formatFileSize(progress.loadedBytes, isFa ? "fa" : "en")} / {formatFileSize(progress.totalBytes, isFa ? "fa" : "en")}
              </strong>
            ) : (
              <Loader2 size={15} className="vd-spin" />
            )}
          </div>
          <div className="vd-meter"><span style={{ width: `${phase === "uploading" && progress ? progress.percent : 100}%` }} /></div>
          {phase === "uploading" ? (
            <button className="vd-secondary" onClick={cancelUpload}>{isFa ? "لغو آپلود" : "Cancel upload"}</button>
          ) : null}
        </div>
      ) : null}

      {fileError ? (
        <p className="vd-error" role="alert">
          {fileError}{" "}
          {file ? <button className="vd-linklike" onClick={beginUpload}>{isFa ? "تلاش دوباره" : "Retry"}</button> : null}
        </p>
      ) : null}

      <section className="vd-youtube-section">
        <div className="vd-youtube-copy">
          <span className="vd-inline-icon"><Link2 size={18} /></span>
          <div>
            <h3>{isFa ? "لینک ویدیوی عمومی" : "Public video URL"}</h3>
            <p>{isFa ? "لینک یوتیوب یا لینک مستقیم فایل ویدیویی (MP4، MOV، WebM) را وارد کنید." : "Paste a YouTube link or a direct video file link (MP4, MOV, WebM)."}</p>
          </div>
        </div>
        <input
          className="vd-input vd-url-input"
          value={url}
          disabled={urlBusy}
          onChange={(event) => setUrl(event.target.value)}
          type="url"
          dir="ltr"
          placeholder="https://www.youtube.com/watch?v=…"
        />
        <label className="vd-confirm-line">
          <input type="checkbox" checked={ownershipConfirmed} disabled={urlBusy} onChange={(event) => setOwnershipConfirmed(event.target.checked)} />
          <span>{isFa ? "تأیید می‌کنم مالک این محتوا هستم یا اجازه پردازش آن را دارم." : "I confirm I own this content or have permission to process it."}</span>
        </label>
        <button className="vd-primary vd-start vd-start-full" disabled={urlBusy || !url.trim()} onClick={submitUrl}>
          {urlBusy ? (isFa ? "در حال بررسی لینک..." : "Validating link…") : (isFa ? "ثبت لینک برای پردازش" : "Submit link for processing")}
        </button>
        {urlError ? <p className="vd-error" role="alert">{urlError}</p> : null}
      </section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Processing status page (#/dashboard/videos/:id)
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 5000;

export function VideoProcessingDetail({ session, videoId, isFa, onBack, onDeleted }) {
  const [state, setState] = React.useState({ loading: true, error: "", notFound: false, video: null, job: null });
  const [actionBusy, setActionBusy] = React.useState("");
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const timerRef = React.useRef(null);

  const load = React.useCallback(async () => {
    try {
      const video = await fetchVideoById(session, videoId);
      if (!video) {
        setState({ loading: false, error: "", notFound: true, video: null, job: null });
        return;
      }
      const job = await fetchLatestJob(session, videoId).catch(() => null);
      setState({ loading: false, error: "", notFound: false, video, job });
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "VideoProcessingDetail.load");
      setState((previous) => ({ ...previous, loading: false, error: appError.messageFa }));
    }
  }, [session, videoId]);

  React.useEffect(() => {
    setState({ loading: true, error: "", notFound: false, video: null, job: null });
    load();
  }, [load]);

  // Reliable polling: refresh while the video is in an active state; stop on
  // terminal states; network errors keep the loop alive (retry next tick).
  React.useEffect(() => {
    const shouldPoll = state.video && isActiveVideoStatus(state.video.status);
    if (!shouldPoll) return undefined;
    timerRef.current = window.setInterval(load, POLL_INTERVAL_MS);
    return () => window.clearInterval(timerRef.current);
  }, [state.video, load]);

  const runAction = (name, action) => {
    if (actionBusy) return;
    setActionBusy(name);
    action()
      .then(() => load())
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, `VideoProcessingDetail.${name}`);
        setState((previous) => ({ ...previous, error: appError.messageFa }));
      })
      .finally(() => setActionBusy(""));
  };

  if (state.loading) {
    return <section className="vd-card vd-recent"><div className="vd-empty compact"><Loader2 size={26} className="vd-spin" /><h2>{isFa ? "در حال دریافت وضعیت..." : "Loading status…"}</h2></div></section>;
  }
  if (state.notFound) {
    return (
      <section className="vd-card vd-recent">
        <div className="vd-empty compact">
          <FileText size={26} />
          <h2>{isFa ? "ویدیو پیدا نشد" : "Video not found"}</h2>
          <p>{isFa ? "این ویدیو وجود ندارد یا به حساب شما تعلق ندارد." : "This video does not exist or does not belong to your account."}</p>
          <button className="vd-secondary" onClick={onBack}>{isFa ? "بازگشت به ویدیوهای من" : "Back to My Videos"}</button>
        </div>
      </section>
    );
  }

  if (!state.video) {
    // First load failed (network/server) — show the error with a retry
    // instead of pretending the video does not exist.
    return (
      <section className="vd-card vd-recent">
        <div className="vd-empty compact">
          <FileText size={26} />
          <h2>{isFa ? "دریافت وضعیت ممکن نشد" : "Could not load status"}</h2>
          <p className="vd-error" role="alert">{state.error || (isFa ? "خطای ناشناخته‌ای رخ داد." : "An unknown error occurred.")}</p>
          <div className="vd-actions">
            <button className="vd-primary" onClick={() => { setState({ loading: true, error: "", notFound: false, video: null, job: null }); load(); }}>
              <RefreshCw size={15} /> {isFa ? "تلاش دوباره" : "Retry"}
            </button>
            <button className="vd-secondary" onClick={onBack}>{isFa ? "بازگشت به ویدیوهای من" : "Back to My Videos"}</button>
          </div>
        </div>
      </section>
    );
  }

  const { video, job } = state;
  const stageIndex = video ? currentStageIndex(video.status) : -1;
  const isFailed = video?.status === "failed";
  const isCancelled = video?.status === "cancelled";
  const isCompleted = video?.status === "completed";
  const isQueuedPhase = video && ["queued", "uploaded", "created", "validating"].includes(video.status);
  const retryable = isFailed && (job ? job.retryable !== false : true);

  return (
    <section className="vd-view-stack">
      <article className="vd-card vd-recent">
        <div className="vd-detail-head">
          <div>
            <h2 dir="auto">{video.title || video.original_filename || video.source_url || (isFa ? "ویدیوی بدون عنوان" : "Untitled video")}</h2>
            <p className="vd-muted">
              {statusLabel(video.status, isFa)}
              {video.failure_message_fa && isFailed ? ` · ${video.failure_message_fa}` : ""}
            </p>
          </div>
          <div className="vd-detail-actions">
            {video && CANCELLABLE_STATUSES.has(video.status) ? (
              <button className="vd-secondary" disabled={Boolean(actionBusy)} onClick={() => runAction("cancel", () => cancelVideoProcessing(session, video.id))}>
                {actionBusy === "cancel" ? "…" : isFa ? "لغو پردازش" : "Cancel"}
              </button>
            ) : null}
            {retryable ? (
              <button className="vd-primary" disabled={Boolean(actionBusy)} onClick={() => runAction("retry", () => retryVideoProcessing(session, video.id))}>
                <RefreshCw size={15} /> {actionBusy === "retry" ? "…" : isFa ? "تلاش دوباره" : "Retry"}
              </button>
            ) : null}
            {isFailed || isCancelled || isCompleted ? (
              <button className="vd-secondary danger" disabled={Boolean(actionBusy)} onClick={() => setConfirmDelete(true)}>
                <Trash2 size={15} /> {isFa ? "حذف" : "Delete"}
              </button>
            ) : null}
          </div>
        </div>

        {isQueuedPhase ? (
          <div className="vd-queued-note">
            <p>{isFa ? "ویدیوی شما با موفقیت دریافت شده و در صف پردازش قرار دارد." : "Your video was received successfully and is waiting in the processing queue."}</p>
            <p>{isFa ? "پس از شروع پردازش، وضعیت هر مرحله در همین صفحه نمایش داده می‌شود." : "Once processing starts, each stage will update on this page."}</p>
            <p>{isFa ? "می‌توانید این صفحه را ببندید؛ پردازش در پس‌زمینه ادامه پیدا می‌کند." : "You can close this page; processing continues in the background."}</p>
          </div>
        ) : null}

        <ol className="vd-stagelist">
          {PIPELINE_STAGES.map((stage, index) => {
            const isCurrent = index === stageIndex && !isCompleted && !isFailed && !isCancelled;
            const isDone = isCompleted || (stageIndex > -1 && index < stageIndex);
            return (
              <li key={stage.fa} className={isCurrent ? "is-current" : isDone ? "is-done" : ""}>
                {isDone ? <CheckCircle2 size={17} /> : isCurrent ? <Loader2 size={17} className="vd-spin" /> : <Circle size={17} />}
                <span>{isFa ? stage.fa : stage.en}</span>
                {isCurrent && index === 0 && isQueuedPhase ? <em>{isFa ? "در صف پردازش" : "Waiting in queue"}</em> : null}
              </li>
            );
          })}
        </ol>

        {isFailed ? (
          <p className="vd-error" role="alert">
            {video.failure_message_fa || (isFa ? "پردازش این ویدیو ناموفق بود." : "Processing this video failed.")}
          </p>
        ) : null}
        {isCancelled ? <p className="vd-muted">{isFa ? "پردازش این ویدیو لغو شده است." : "Processing was cancelled."}</p> : null}
        {state.error ? <p className="vd-error" role="alert">{state.error}</p> : null}

        <div className="vd-detail-meta">
          <span><Clock3 size={14} /> {new Date(video.created_at).toLocaleString(isFa ? "fa-IR" : "en-US")}</span>
          {video.file_size_bytes ? <span dir="ltr">{formatFileSize(video.file_size_bytes, isFa ? "fa" : "en")}</span> : null}
          {video.source_url ? <span dir="ltr" className="vd-detail-url">{video.source_url}</span> : null}
          {job ? <span dir="ltr">attempt {job.attempt}/{job.max_attempts}</span> : null}
        </div>
      </article>

      {confirmDelete ? (
        <div className="vd-modal" role="dialog" aria-modal="true">
          <div className="vd-modal-card">
            <h2>{isFa ? "ویدیو حذف شود؟" : "Delete this video?"}</h2>
            <p>{isFa ? "فایل و همه اطلاعات پردازش این ویدیو برای همیشه حذف می‌شود." : "The file and all processing data will be permanently removed."}</p>
            <div className="vd-modal-actions">
              <button className="vd-secondary" onClick={() => setConfirmDelete(false)}>{isFa ? "انصراف" : "Cancel"}</button>
              <button
                className="vd-primary"
                disabled={Boolean(actionBusy)}
                onClick={() => {
                  setConfirmDelete(false);
                  runAction("delete", async () => {
                    await deleteVideo(session, video);
                    onDeleted();
                  });
                }}
              >
                {isFa ? "حذف قطعی" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
