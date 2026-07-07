// Vidora user dashboard — single-sidebar, fully localized (fa/en), hash-routed.
// Language follows the site-wide selector (window.useLang / applyVidoraLang),
// so it persists across refresh and login. All copy lives in
// src/locales/{en,fa}/dashboard.json — no hardcoded UI strings in components.
// Data is mocked in-memory; swap the store handlers for real API calls later.
import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Bookmark,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  CreditCard,
  Download,
  FileText,
  Heart,
  HelpCircle,
  Home,
  Link2,
  Loader2,
  LogOut,
  Menu as MenuIcon,
  MoreHorizontal,
  Paperclip,
  Pause,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  StickyNote,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import enDict from "./locales/en/dashboard.json";
import faDict from "./locales/fa/dashboard.json";

const DICTS = { en: enDict, fa: faDict };

// ---------------------------------------------------------------------------
// i18n helpers
// ---------------------------------------------------------------------------

function lookup(dict, path) {
  return path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), dict);
}

function makeT(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return (path, params) => {
    let value = lookup(dict, path);
    if (value === undefined) value = lookup(DICTS.en, path);
    if (typeof value !== "string") return path;
    if (params) {
      for (const [key, raw] of Object.entries(params)) {
        value = value.split(`{${key}}`).join(String(raw));
      }
    }
    return value;
  };
}

const fmtNum = (lang, n) => Number(n).toLocaleString(lang === "fa" ? "fa-IR" : "en-US");
const fmtDate = (lang, iso, withYear = false) =>
  new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", {
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(iso));
const fmtClock = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const uid = () => Math.random().toString(36).slice(2, 9);

function saveTextFile(filename, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    const area = document.createElement("textarea");
    area.value = text;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

// ---------------------------------------------------------------------------
// Mock data (structured so a real API can replace it later)
// ---------------------------------------------------------------------------

const STAGES = ["uploading", "extracting", "transcribing", "translating", "subtitling", "rendering"];
const STAGE_CEILINGS = [8, 22, 45, 68, 85, 100];
const stageForProgress = (p) => STAGES[STAGE_CEILINGS.findIndex((ceil) => p < ceil)] || "rendering";

const INITIAL_VIDEOS = [
  { id: "v1", title: "AI in 2025: The Future is Now", srcLang: "en", tgtLang: "fa", durationMin: 24, addedAt: "2026-07-06", inputType: "youtube", status: "ready", progress: 100, saved: true, usedMin: 24 },
  { id: "v2", title: "Startup pricing strategy", srcLang: "en", tgtLang: "fa", durationMin: 42, addedAt: "2026-07-07", inputType: "upload", status: "processing", progress: 34, saved: false, usedMin: 42 },
  { id: "v3", title: "Sam Altman interview", srcLang: "en", tgtLang: "fa", durationMin: 55, addedAt: "2026-07-05", inputType: "youtube", status: "ready", progress: 100, saved: true, usedMin: 55 },
  { id: "v4", title: "Building AI products", srcLang: "en", tgtLang: "fa", durationMin: 31, addedAt: "2026-07-04", inputType: "upload", status: "failed", progress: 0, failReason: "network", saved: false, usedMin: 0 },
  { id: "v5", title: "Design systems for SaaS", srcLang: "en", tgtLang: "fa", durationMin: 18, addedAt: "2026-07-02", inputType: "youtube", status: "ready", progress: 100, saved: false, usedMin: 18 },
];

const INITIAL_NOTES = [
  { id: "n1", videoId: "v1", time: 214, text: "AI is not the future — it is already reshaping daily work.", createdAt: "2026-07-06" },
  { id: "n2", videoId: "v3", time: 1330, text: "Useful spoken English phrases from a long-form conversation.", createdAt: "2026-07-05" },
  { id: "n3", videoId: "v1", time: 655, text: "Learning AI tools now is a competitive advantage.", createdAt: "2026-07-06" },
];

const INITIAL_TICKETS = [
  {
    id: "t1",
    topic: "translation",
    subject: "Subtitle timing drifts near the end",
    status: "answered",
    createdAt: "2026-07-03",
    messages: [
      { from: "you", text: "On my last video the subtitles slowly go out of sync after minute 40.", at: "2026-07-03" },
      { from: "team", text: "Thanks for the report! We re-synced your video — please re-download the SRT. A fix ships this week.", at: "2026-07-04" },
    ],
  },
];

const INITIAL_NOTIFICATIONS = [
  { id: "nt1", type: "videoReady", params: { title: "Sam Altman interview" }, read: false },
  { id: "nt2", type: "renewalSoon", params: { dateISO: "2026-08-12" }, read: false },
];

const INVOICES = [
  { id: "i3", dateISO: "2026-07-12", plan: "Pro", amount: "$19", status: "paid" },
  { id: "i2", dateISO: "2026-06-12", plan: "Pro", amount: "$19", status: "paid" },
  { id: "i1", dateISO: "2026-05-12", plan: "Pro", amount: "$19", status: "paid" },
];

// Subtitle/transcript mock content, scaled to each video's duration.
const SEGMENT_TEXTS = [
  ["Artificial intelligence is not the future. It is already here.", "هوش مصنوعی آینده نیست؛ همین حالاست."],
  ["AI is changing the way we work and live.", "AI در حال تغییر شیوه کار و زندگی ماست."],
  ["New tools have made complex tasks simpler and faster.", "ابزارهای جدید، کارهای پیچیده را ساده‌تر و سریع‌تر کرده‌اند."],
  ["The job market is going through a major shift.", "بازار کار در حال یک تغییر بزرگ است."],
  ["Learning practical AI tools is the best way to start.", "یادگیری ابزارهای کاربردی AI بهترین نقطه شروع است."],
  ["You do not need a technical background to begin.", "برای شروع به پیش‌زمینه فنی نیاز نداری."],
  ["Focus on skills that compound over time.", "روی مهارت‌هایی تمرکز کن که در طول زمان انباشته می‌شوند."],
  ["Small daily practice beats occasional deep dives.", "تمرین کوتاه روزانه از مطالعه پراکنده بهتر است."],
  ["Learning AI is a big competitive advantage in the near future.", "یادگیری AI یک مزیت رقابتی بزرگ در آینده نزدیک است."],
  ["Start today. The tools are ready when you are.", "از امروز شروع کن. ابزارها آماده‌اند."],
];

function buildSegments(video) {
  const total = Math.max(video.durationMin * 60, 300);
  return SEGMENT_TEXTS.map(([src, tgt], i) => {
    const start = Math.round((total / (SEGMENT_TEXTS.length + 1)) * (i + 1));
    return { id: `${video.id}-s${i}`, start, end: start + 6, src, tgt };
  });
}

const SUMMARY = {
  keyPoints: [
    ["AI is reshaping how we work and live, right now.", "AI همین حالا در حال تغییر شیوه کار و زندگی ماست."],
    ["New tools make complex work simpler and faster.", "ابزارهای جدید، کارهای پیچیده را ساده و سریع کرده‌اند."],
    ["Learning AI early is a major competitive advantage.", "یادگیری زودهنگام AI یک مزیت رقابتی بزرگ است."],
  ],
  short: [
    "The video argues that AI is a present-day shift, not a future one, and that practical tool fluency matters more than theory.",
    "این ویدیو استدلال می‌کند که هوش مصنوعی تغییری مربوط به امروز است نه آینده، و تسلط عملی بر ابزارها مهم‌تر از تئوری است.",
  ],
  detailed: [
    "Across the talk, the speaker maps how AI systems moved from research labs into everyday workflows: writing, coding, design, and analysis. The core advice is to build a habit of using AI tools on real tasks, measure the time saved, and gradually automate repeatable parts of your work. The final section covers the near-term job market and why adaptable, tool-fluent workers will benefit most.",
    "در طول این گفتار، سخنران نشان می‌دهد سیستم‌های هوش مصنوعی چگونه از آزمایشگاه‌ها به کارهای روزمره رسیده‌اند: نوشتن، برنامه‌نویسی، طراحی و تحلیل. توصیه اصلی این است که استفاده از ابزارهای AI را روی کارهای واقعی عادت کنی، زمان صرفه‌جویی‌شده را بسنجی و بخش‌های تکراری کارت را به‌مرور خودکار کنی. بخش پایانی به بازار کار در آینده نزدیک می‌پردازد و اینکه چرا افراد منعطف و مسلط به ابزارها بیشترین بهره را می‌برند.",
  ],
  chapters: [
    [0.05, "Why now", "چرا الان"],
    [0.4, "Tools in practice", "ابزارها در عمل"],
    [0.75, "The road ahead", "مسیر پیش رو"],
  ],
};

const USER = { name: "Sepehr", fullName: "Sepehr Rahimpour", email: "sepehrrahimpour8@gmail.com" };

// ---------------------------------------------------------------------------
// Scoped styles (logical properties keep RTL correct without mirroring hacks)
// ---------------------------------------------------------------------------

const CSS = `
.dsh-root{--bg:#f6f6f8;--card:#fff;--line:#e7e7ee;--line2:#dcdce6;--ink:#18181f;--mut:#6f6f7c;--soft:#f1f1f5;
  --acc:#6d4fd8;--acc-ink:#fff;--acc-soft:#f1ecfd;--acc-line:#dcd2f7;
  --ok:#1a7f4e;--ok-soft:#e4f4ea;--bad:#c03434;--bad-soft:#fdeaea;--warn:#96650f;--warn-soft:#fdf3dd;
  min-height:100vh;background:var(--bg);color:var(--ink);font-family:var(--font-sans);display:flex}
.dsh-root *,.dsh-root *::before,.dsh-root *::after{box-sizing:border-box}
.dsh-root h1,.dsh-root h2,.dsh-root h3,.dsh-root p,.dsh-root ul{margin:0}
.dsh-root ul{padding:0;list-style:none}
.dsh-root button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:start}
.dsh-root input,.dsh-root select,.dsh-root textarea{font:inherit;color:inherit}
.dsh-root a{color:inherit;text-decoration:none}

/* ---- sidebar ---- */
.dsh-side{width:262px;flex:none;background:var(--card);border-inline-end:1px solid var(--line);display:flex;flex-direction:column;padding:18px 14px;gap:6px;transition:width .18s ease;position:sticky;top:0;height:100vh;overflow-y:auto}
.dsh-side.is-collapsed{width:76px}
.dsh-side.is-collapsed .dsh-hidecollapsed{display:none}
.dsh-logo-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 8px 14px}
.dsh-logo{font-weight:800;letter-spacing:.14em;font-size:16px}
.dsh-collapse{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;color:var(--mut)}
.dsh-collapse:hover{background:var(--soft)}
.dsh-cta{height:44px;border-radius:12px;background:var(--acc);color:var(--acc-ink);font-weight:700;font-size:14px;display:flex;align-items:center;justify-content:center;gap:9px;margin-bottom:12px;box-shadow:0 8px 18px rgba(109,79,216,.24)}
.dsh-cta:hover{background:#5f43c4}
.dsh-side.is-collapsed .dsh-cta{width:46px;margin-inline:auto}
.dsh-nav{display:grid;gap:3px}
.dsh-nav-item{height:42px;border-radius:11px;display:flex;align-items:center;gap:11px;padding-inline:12px;font-size:14px;font-weight:600;color:#43434e}
.dsh-nav-item:hover{background:var(--soft)}
.dsh-nav-item.is-active{background:var(--acc-soft);color:var(--acc)}
.dsh-nav-item svg{flex:none}
.dsh-side.is-collapsed .dsh-nav-item{justify-content:center;padding-inline:0}
.dsh-side-gap{height:14px;border-bottom:1px solid var(--line);margin:2px 8px 14px}
.dsh-side-spacer{flex:1}
.dsh-userbox{border-top:1px solid var(--line);padding-top:12px;display:grid;gap:3px}
.dsh-userinfo{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:11px}
.dsh-userinfo:hover{background:var(--soft)}
.dsh-avatar{width:36px;height:36px;border-radius:999px;background:var(--acc-soft);color:var(--acc);display:grid;place-items:center;font-weight:800;font-size:15px;flex:none;overflow:hidden}
.dsh-avatar img{width:100%;height:100%;object-fit:cover}
.dsh-avatar.is-lg{width:64px;height:64px;font-size:24px}
.dsh-username{font-size:13.5px;font-weight:700;line-height:1.25}
.dsh-userplan{font-size:11.5px;color:var(--mut)}
.dsh-side.is-collapsed .dsh-userinfo{justify-content:center;padding-inline:0}

/* ---- layout / topbar ---- */
.dsh-body{flex:1;min-width:0;display:flex;flex-direction:column}
.dsh-top{height:60px;flex:none;background:var(--card);border-bottom:1px solid var(--line);display:flex;align-items:center;gap:12px;padding-inline:22px;position:sticky;top:0;z-index:20}
.dsh-burger{display:none;width:36px;height:36px;border-radius:10px;place-items:center}
.dsh-burger:hover{background:var(--soft)}
.dsh-top-title{font-size:15px;font-weight:700}
.dsh-top-spacer{flex:1}
.dsh-iconbtn{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;color:#4a4a55;position:relative}
.dsh-iconbtn:hover{background:var(--soft)}
.dsh-dot{position:absolute;top:7px;inset-inline-end:7px;width:8px;height:8px;border-radius:999px;background:var(--acc);border:2px solid var(--card)}
.dsh-main{flex:1;padding:26px 22px 60px;overflow-x:hidden}
.dsh-wrap{max-width:1060px;margin:0 auto;display:grid;gap:18px}
.dsh-page-h h1{font-size:26px;font-weight:800;letter-spacing:-.01em}
.dsh-page-h p{margin-top:6px;color:var(--mut);font-size:14.5px;line-height:1.7}

/* ---- cards & primitives ---- */
.dsh-card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 1px 2px rgba(24,24,31,.04)}
.dsh-card h2{font-size:16px;font-weight:750}
.dsh-sub{color:var(--mut);font-size:13.5px;line-height:1.7}
.dsh-btn{height:40px;border-radius:11px;padding-inline:16px;font-size:13.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.dsh-btn.is-primary{background:var(--acc);color:#fff}
.dsh-btn.is-primary:hover{background:#5f43c4}
.dsh-btn.is-ghost{border:1px solid var(--line2);background:var(--card)}
.dsh-btn.is-ghost:hover{background:var(--soft)}
.dsh-btn.is-danger{background:var(--bad);color:#fff}
.dsh-btn.is-danger-ghost{border:1px solid #efc9c9;color:var(--bad)}
.dsh-btn.is-danger-ghost:hover{background:var(--bad-soft)}
.dsh-btn.is-sm{height:33px;padding-inline:12px;font-size:12.5px;border-radius:9px}
.dsh-btn:disabled{opacity:.5;cursor:not-allowed}
.dsh-badge{display:inline-flex;align-items:center;gap:6px;height:24px;padding-inline:9px;border-radius:999px;font-size:11.5px;font-weight:700}
.dsh-badge.is-ready{background:var(--ok-soft);color:var(--ok)}
.dsh-badge.is-processing{background:var(--acc-soft);color:var(--acc)}
.dsh-badge.is-failed{background:var(--bad-soft);color:var(--bad)}
.dsh-badge.is-neutral{background:var(--soft);color:var(--mut)}
.dsh-badge.is-warn{background:var(--warn-soft);color:var(--warn)}
.dsh-meter{height:7px;border-radius:999px;background:var(--soft);overflow:hidden}
.dsh-meter>span{display:block;height:100%;border-radius:inherit;background:var(--acc);transition:width .5s ease}
.dsh-meter.is-warn>span{background:var(--warn)}
.dsh-field{display:grid;gap:7px;font-size:13px;font-weight:650;color:#4a4a55;min-width:0}
.dsh-input,.dsh-select,.dsh-textarea{height:41px;border:1px solid var(--line2);border-radius:11px;background:var(--card);padding-inline:12px;outline:none;width:100%;font-weight:500}
.dsh-input:focus,.dsh-select:focus,.dsh-textarea:focus{border-color:var(--acc);box-shadow:0 0 0 3px var(--acc-soft)}
.dsh-textarea{height:auto;min-height:120px;padding:11px 12px;resize:vertical;line-height:1.7}
.dsh-error{color:var(--bad);font-size:12.5px;font-weight:600}
.dsh-hint{color:var(--mut);font-size:12.5px;font-weight:500}
.dsh-toggle{display:flex;align-items:center;gap:11px;font-size:13.5px;font-weight:600;color:#3c3c46}
.dsh-knob{width:38px;height:22px;border-radius:999px;background:#d6d6df;position:relative;transition:background .15s ease;flex:none}
.dsh-knob::after{content:"";position:absolute;top:3px;inset-inline-start:3px;width:16px;height:16px;border-radius:999px;background:#fff;transition:transform .15s ease;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.dsh-toggle[aria-checked="true"] .dsh-knob{background:var(--acc)}
.dsh-toggle[aria-checked="true"] .dsh-knob::after{transform:translateX(16px)}
[dir="rtl"] .dsh-toggle[aria-checked="true"] .dsh-knob::after{transform:translateX(-16px)}
.dsh-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);overflow-x:auto;scrollbar-width:none}
.dsh-tab{height:42px;padding-inline:14px;font-size:13.5px;font-weight:700;color:var(--mut);border-bottom:2px solid transparent;white-space:nowrap;display:inline-flex;align-items:center;gap:7px}
.dsh-tab.is-active{color:var(--acc);border-bottom-color:var(--acc)}
.dsh-empty{display:grid;place-items:center;text-align:center;padding:46px 20px;gap:4px}
.dsh-empty svg{color:#c9c9d4;margin-bottom:8px}
.dsh-empty h3{font-size:15.5px;font-weight:750}
.dsh-empty p{color:var(--mut);font-size:13.5px;max-width:340px;line-height:1.7}
.dsh-empty .dsh-btn{margin-top:14px}

/* ---- menus / modals / toasts ---- */
.dsh-menuwrap{position:relative}
.dsh-menu{position:absolute;top:calc(100% + 6px);inset-inline-end:0;min-width:215px;background:var(--card);border:1px solid var(--line);border-radius:13px;box-shadow:0 14px 40px rgba(24,24,31,.14);padding:6px;z-index:40;display:grid;gap:1px}
.dsh-menu-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;font-size:13px;font-weight:600;color:#3c3c46}
.dsh-menu-item:hover{background:var(--soft)}
.dsh-menu-item.is-danger{color:var(--bad)}
.dsh-menu-item.is-danger:hover{background:var(--bad-soft)}
.dsh-menu-item:disabled{opacity:.45;cursor:not-allowed}
.dsh-menu-sep{height:1px;background:var(--line);margin:5px 8px}
.dsh-overlay{position:fixed;inset:0;background:rgba(20,20,28,.42);z-index:60;display:grid;place-items:center;padding:18px}
.dsh-modal{width:min(440px,100%);background:var(--card);border-radius:18px;padding:22px;display:grid;gap:12px;box-shadow:0 30px 80px rgba(0,0,0,.28)}
.dsh-modal h2{font-size:17px;font-weight:800}
.dsh-modal p{color:var(--mut);font-size:13.5px;line-height:1.75}
.dsh-modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:6px}
.dsh-toasts{position:fixed;bottom:22px;inset-inline-end:22px;display:grid;gap:8px;z-index:80}
.dsh-toast{background:#1e1e26;color:#fff;border-radius:12px;padding:11px 15px;font-size:13.5px;font-weight:650;box-shadow:0 14px 34px rgba(0,0,0,.24);max-width:340px}

/* ---- home ---- */
.dsh-home-grid{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:18px;align-items:start}
.dsh-home-col{display:grid;gap:18px;min-width:0}
.dsh-newcta{border:1px solid var(--acc-line);background:linear-gradient(135deg,#faf8ff,#f3eefe)}
.dsh-newcta-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.dsh-newcta-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;color:var(--mut);font-size:12.5px;font-weight:600}
.dsh-activity-item{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:12px;align-items:center;padding:13px 0;border-top:1px solid var(--line)}
.dsh-activity-item:first-of-type{border-top:0}
.dsh-thumb{width:44px;height:34px;border-radius:8px;background:linear-gradient(135deg,#31313c,#8a8a99);flex:none}
.dsh-thumb.is-lg{width:66px;height:46px;border-radius:10px}
.dsh-activity-name{font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-activity-sub{margin-top:3px;font-size:12px;color:var(--mut);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dsh-usage-line{display:flex;justify-content:space-between;align-items:baseline;font-size:13px;color:var(--mut)}
.dsh-usage-line strong{color:var(--ink);font-size:14px}
.dsh-usage-big{font-size:34px;font-weight:800;letter-spacing:-.02em}
.dsh-usage-big small{font-size:14px;color:var(--mut);font-weight:600}
.dsh-notice{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--line);font-size:13px;line-height:1.6;color:#3c3c46}
.dsh-notice:first-of-type{border-top:0}
.dsh-notice svg{flex:none;margin-top:2px}

/* ---- wizard ---- */
.dsh-steps{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dsh-step{display:flex;align-items:center;gap:7px;font-size:12.5px;font-weight:700;color:var(--mut)}
.dsh-step .dsh-step-dot{width:24px;height:24px;border-radius:999px;background:var(--soft);display:grid;place-items:center;font-size:11.5px}
.dsh-step.is-active{color:var(--acc)}
.dsh-step.is-active .dsh-step-dot{background:var(--acc);color:#fff}
.dsh-step.is-done{color:var(--ok)}
.dsh-step.is-done .dsh-step-dot{background:var(--ok-soft);color:var(--ok)}
.dsh-step-line{width:18px;height:1px;background:var(--line2)}
.dsh-choice{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.dsh-choice-card{border:1px solid var(--line2);border-radius:14px;padding:18px;display:grid;gap:6px;text-align:start}
.dsh-choice-card:hover{border-color:var(--acc)}
.dsh-choice-card.is-active{border-color:var(--acc);background:var(--acc-soft)}
.dsh-choice-card h3{font-size:14.5px;font-weight:750;display:flex;align-items:center;gap:9px}
.dsh-choice-card p{font-size:12.5px;color:var(--mut);line-height:1.65}
.dsh-drop{border:1.5px dashed var(--line2);border-radius:14px;min-height:170px;display:grid;place-items:center;text-align:center;padding:22px;gap:2px}
.dsh-drop h3{font-size:14.5px;font-weight:700}
.dsh-drop p{color:var(--mut);font-size:12.5px;margin-top:4px}
.dsh-filechip{display:flex;align-items:center;gap:11px;border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.dsh-filechip .dsh-filename{font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr;unicode-bidi:plaintext}
.dsh-review-rows{display:grid;gap:0}
.dsh-review-row{display:flex;justify-content:space-between;gap:14px;padding:11px 0;border-top:1px solid var(--line);font-size:13.5px}
.dsh-review-row:first-child{border-top:0}
.dsh-review-row span{color:var(--mut)}
.dsh-review-row strong{font-weight:750}
.dsh-wizard-nav{display:flex;justify-content:space-between;gap:10px;margin-top:4px}

/* ---- videos list ---- */
.dsh-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.dsh-searchbox{flex:1;min-width:200px;display:flex;align-items:center;gap:9px;border:1px solid var(--line2);border-radius:11px;height:40px;padding-inline:12px;background:var(--card)}
.dsh-searchbox input{border:0;outline:none;background:none;flex:1;min-width:0}
.dsh-searchbox svg{color:var(--mut);flex:none}
.dsh-pills{display:flex;gap:6px;flex-wrap:wrap}
.dsh-pill{height:33px;border-radius:999px;padding-inline:13px;font-size:12.5px;font-weight:700;border:1px solid var(--line2);color:var(--mut);display:inline-flex;align-items:center}
.dsh-pill.is-active{background:var(--acc);border-color:var(--acc);color:#fff}
.dsh-video-row{display:grid;grid-template-columns:66px minmax(0,1.5fr) minmax(0,1fr) auto auto;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--line)}
.dsh-video-row:first-of-type{border-top:0}
.dsh-video-title{font-size:14px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-video-meta{margin-top:4px;font-size:12px;color:var(--mut);display:flex;gap:7px;align-items:center;flex-wrap:wrap}
.dsh-video-status{display:grid;gap:6px;min-width:0}
.dsh-video-status .dsh-meter{width:150px;max-width:100%}
.dsh-fail-reason{font-size:12px;color:var(--bad);font-weight:600}
.dsh-row-actions{display:flex;gap:7px;align-items:center}

/* ---- workspace ---- */
.dsh-ws-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.dsh-ws-head-info{flex:1;min-width:220px}
.dsh-back{display:inline-flex;align-items:center;gap:6px;color:var(--mut);font-size:12.5px;font-weight:700;margin-bottom:8px}
.dsh-back:hover{color:var(--acc)}
.dsh-ws-title{font-size:21px;font-weight:800;letter-spacing:-.01em}
.dsh-ws-meta{margin-top:7px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--mut);font-size:12.5px}
.dsh-ws-actions{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.dsh-player{background:#101016;border-radius:16px;overflow:hidden;color:#fff}
.dsh-player-stage{aspect-ratio:16/9;max-height:420px;width:100%;display:grid;place-items:center;background:radial-gradient(ellipse at 50% 30%,#2c2c3a,#101016);position:relative}
.dsh-play{width:64px;height:64px;border-radius:999px;background:rgba(255,255,255,.14);backdrop-filter:blur(4px);display:grid;place-items:center;color:#fff;border:1px solid rgba(255,255,255,.25)}
.dsh-play:hover{background:rgba(255,255,255,.24)}
.dsh-player-sub{position:absolute;bottom:16px;inset-inline:0;text-align:center;padding-inline:24px}
.dsh-player-sub span{display:inline-block;background:rgba(0,0,0,.62);border-radius:8px;padding:7px 13px;font-size:14px}
.dsh-player-bar{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#16161e}
.dsh-player-bar input[type="range"]{flex:1;accent-color:#8f75ec;height:4px}
.dsh-time{font-size:12px;color:#b9b9c6;font-variant-numeric:tabular-nums}
.dsh-seg{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:12px;padding:11px 10px;border-radius:11px;align-items:start}
.dsh-seg:hover{background:var(--soft)}
.dsh-seg.is-current{background:var(--acc-soft)}
.dsh-seg-time{font-size:11.5px;color:var(--acc);font-weight:800;font-variant-numeric:tabular-nums;padding-top:3px}
.dsh-seg-src{font-size:12.5px;color:var(--mut);line-height:1.6}
.dsh-seg-tgt{font-size:13.5px;font-weight:600;line-height:1.7;margin-top:2px}
.dsh-longtext{font-size:14px;line-height:1.95;color:#2c2c35;white-space:pre-wrap}
.dsh-ts{color:var(--acc);font-weight:800;font-size:11.5px;font-variant-numeric:tabular-nums}
.dsh-chapter{display:flex;align-items:center;gap:11px;padding:10px 10px;border-radius:11px}
.dsh-chapter:hover{background:var(--soft)}
.dsh-note{display:grid;gap:7px;padding:13px 0;border-top:1px solid var(--line)}
.dsh-note:first-of-type{border-top:0}
.dsh-note-head{display:flex;align-items:center;gap:9px;justify-content:space-between}
.dsh-note-text{font-size:13.5px;line-height:1.75}
.dsh-note-add{display:flex;gap:9px;align-items:flex-start}
.dsh-banner{display:flex;gap:10px;align-items:center;border:1px solid var(--acc-line);background:var(--acc-soft);color:var(--acc);border-radius:13px;padding:11px 14px;font-size:13px;font-weight:650}

/* ---- subscription / support / settings ---- */
.dsh-two-col{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;align-items:start}
.dsh-invoice-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:12px;align-items:center;padding:11px 0;border-top:1px solid var(--line);font-size:13px}
.dsh-invoice-row:first-of-type{border-top:0}
.dsh-plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.dsh-plan-opt{border:1px solid var(--line2);border-radius:14px;padding:16px;display:grid;gap:8px;text-align:start}
.dsh-plan-opt.is-current{border-color:var(--acc);background:var(--acc-soft)}
.dsh-plan-price{font-size:26px;font-weight:800}
.dsh-plan-price small{font-size:12.5px;color:var(--mut);font-weight:600}
.dsh-ticket{border:1px solid var(--line);border-radius:13px;overflow:hidden}
.dsh-ticket+.dsh-ticket{margin-top:10px}
.dsh-ticket-head{display:flex;align-items:center;gap:11px;padding:13px 15px;width:100%}
.dsh-ticket-head:hover{background:var(--soft)}
.dsh-ticket-body{border-top:1px solid var(--line);padding:14px 15px;display:grid;gap:12px;background:#fbfbfd}
.dsh-msg{display:grid;gap:4px}
.dsh-msg-head{font-size:12px;font-weight:800;display:flex;gap:8px;align-items:baseline}
.dsh-msg-head span{color:var(--mut);font-weight:500}
.dsh-msg p{font-size:13.5px;line-height:1.75;color:#33333d}
.dsh-msg.is-team{border-inline-start:3px solid var(--acc-line);padding-inline-start:11px}
.dsh-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.dsh-form-grid .is-full{grid-column:1/-1}
.dsh-danger-card{border-color:#f0caca;background:#fffafa}
.dsh-sessions-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--line);font-size:13.5px}
.dsh-sessions-row:first-of-type{border-top:0}

.dsh-spin{animation:dshspin 1.4s linear infinite}
@keyframes dshspin{to{transform:rotate(360deg)}}

/* ---- responsive ---- */
@media(max-width:1100px){.dsh-home-grid{grid-template-columns:1fr}.dsh-two-col{grid-template-columns:1fr}}
@media(max-width:900px){
  .dsh-side{position:fixed;inset-inline-start:0;top:0;z-index:70;transform:translateX(-102%);transition:transform .2s ease;width:272px;box-shadow:0 10px 60px rgba(0,0,0,.2)}
  [dir="rtl"] .dsh-side{transform:translateX(102%)}
  .dsh-side.is-open{transform:translateX(0)}
  [dir="rtl"] .dsh-side.is-open{transform:translateX(0)}
  .dsh-side.is-collapsed{width:272px}
  .dsh-side .dsh-hidecollapsed{display:initial}
  .dsh-burger{display:grid}
  .dsh-collapse{display:none}
  .dsh-main{padding:18px 14px 60px}
  .dsh-drawer-veil{position:fixed;inset:0;background:rgba(20,20,28,.4);z-index:65}
}
@media(max-width:760px){
  .dsh-choice,.dsh-form-grid,.dsh-plan-grid{grid-template-columns:1fr}
  .dsh-video-row{grid-template-columns:52px minmax(0,1fr) auto;row-gap:8px}
  .dsh-video-row .dsh-video-status{grid-column:1/-1}
  .dsh-video-row .dsh-video-status .dsh-meter{width:100%}
  .dsh-invoice-row{grid-template-columns:minmax(0,1fr) auto}
  .dsh-page-h h1{font-size:22px}
  .dsh-toasts{inset-inline:14px;bottom:14px}
}
`;

// ---------------------------------------------------------------------------
// Context + primitives
// ---------------------------------------------------------------------------

const Ctx = React.createContext(null);
const useDash = () => React.useContext(Ctx);

function Btn({ variant = "ghost", sm, children, ...props }) {
  return (
    <button className={`dsh-btn is-${variant}${sm ? " is-sm" : ""}`} {...props}>
      {children}
    </button>
  );
}

function Badge({ kind, children }) {
  return <span className={`dsh-badge is-${kind}`}>{children}</span>;
}

function StatusBadge({ video }) {
  const { t, lang } = useDash();
  const kind = video.status === "ready" ? "ready" : video.status === "failed" ? "failed" : "processing";
  const pct = `${fmtNum(lang, video.progress)}${lang === "fa" ? "٪" : "%"}`;
  const label = video.status === "processing" ? `${t(`status.${stageForProgress(video.progress)}`)} · ${pct}` : t(`status.${video.status}`);
  return <Badge kind={kind}>{label}</Badge>;
}

function Meter({ value, warn, label }) {
  return (
    <div className={`dsh-meter${warn ? " is-warn" : ""}`} dir="ltr" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return (
    <button type="button" className="dsh-toggle" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="dsh-knob" />
      {label}
    </button>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className="dsh-field">
      {label}
      {children}
      {error ? <span className="dsh-error">{error}</span> : hint ? <span className="dsh-hint">{hint}</span> : null}
    </label>
  );
}

function useClickOutside(onClose) {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const onDoc = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return ref;
}

function Menu({ trigger, items, ariaLabel }) {
  const [open, setOpen] = React.useState(false);
  const ref = useClickOutside(React.useCallback(() => setOpen(false), []));
  return (
    <div className="dsh-menuwrap" ref={ref}>
      <button type="button" aria-label={ariaLabel} aria-expanded={open} onClick={() => setOpen((v) => !v)} className={trigger.className} title={ariaLabel}>
        {trigger.node}
      </button>
      {open ? (
        <div className="dsh-menu" role="menu">
          {items.map((item, i) =>
            item === "sep" ? (
              <div className="dsh-menu-sep" key={`sep-${i}`} />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                disabled={item.disabled}
                className={`dsh-menu-item${item.danger ? " is-danger" : ""}`}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}

function Modal({ title, children, onClose }) {
  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dsh-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dsh-modal" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, desc, cta, onCta }) {
  return (
    <div className="dsh-empty">
      {icon}
      <h3>{title}</h3>
      <p>{desc}</p>
      {cta ? (
        <Btn variant="primary" onClick={onCta}>
          {cta}
        </Btn>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Routing helpers (hash-based, GitHub Pages friendly)
// ---------------------------------------------------------------------------

const LEGACY_ROUTES = {
  "new-video": "new-translation",
  library: "videos",
  completed: "videos?filter=ready",
  watchlist: "saved",
  notes: "saved?tab=notes",
  liked: "saved",
  usage: "subscription",
  billing: "subscription",
  profile: "settings",
};
const SECTIONS = new Set(["home", "new-translation", "videos", "saved", "subscription", "support", "settings"]);

function parseRoute() {
  const raw = window.location.hash.replace(/^#\/(?:dashboard|panel)\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  let section = segments[0] || "home";
  if (LEGACY_ROUTES[section]) {
    const target = LEGACY_ROUTES[section];
    window.location.replace(`#/dashboard/${target}`.replace(/\/home$/, ""));
    const [s, q] = target.split("?");
    return { section: s, videoId: null, query: new URLSearchParams(q || "") };
  }
  if (!SECTIONS.has(section)) section = "home";
  return { section, videoId: section === "videos" ? segments[1] || null : null, query: new URLSearchParams(queryPart || "") };
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export function VidoraDashboard() {
  const { lang, setLang } = window.useLang();
  const rtl = lang === "fa";
  const t = React.useMemo(() => makeT(lang), [lang]);

  const [route, setRoute] = React.useState(parseRoute);
  React.useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const nav = React.useCallback((path) => {
    window.location.hash = path === "home" || path === "" ? "#/dashboard" : `#/dashboard/${path}`;
  }, []);

  // -- store ---------------------------------------------------------------
  const [videos, setVideos] = React.useState(INITIAL_VIDEOS);
  const [notes, setNotes] = React.useState(INITIAL_NOTES);
  const [tickets, setTickets] = React.useState(INITIAL_TICKETS);
  const [notifications, setNotifications] = React.useState(INITIAL_NOTIFICATIONS);
  const [plan, setPlan] = React.useState({ name: "Pro", monthlyMin: 2000, usedMin: 1280, renewalISO: "2026-08-12", cancelled: false });
  const [prefs, setPrefs] = React.useState({
    name: USER.fullName,
    email: USER.email,
    avatar: null,
    defaultSource: "auto",
    defaultTarget: "fa",
    timezone: "Asia/Tehran",
    dateFormat: "auto",
    autoSubtitles: true,
    autoSummary: true,
    autoNotes: false,
    notifCompleted: true,
    notifFailed: true,
    notifLowBalance: true,
    notifRenewal: true,
    notifSupport: true,
  });

  const [toasts, setToasts] = React.useState([]);
  const showToast = React.useCallback((msg) => {
    const id = uid();
    setToasts((list) => [...list, { id, msg }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2800);
  }, []);

  const [confirmState, setConfirmState] = React.useState(null); // {title, desc, confirmLabel, danger, requireWord, onConfirm}
  const askConfirm = React.useCallback((cfg) => setConfirmState(cfg), []);

  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return window.localStorage.getItem("vidora-dash-side") === "1";
    } catch (e) {
      return false;
    }
  });
  const toggleCollapsed = () => {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem("vidora-dash-side", value ? "0" : "1");
      } catch (e) {/* ignore */}
      return !value;
    });
  };
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  React.useEffect(() => setDrawerOpen(false), [route.section, route.videoId]);

  // -- processing simulation (mock of backend progress events) --------------
  const hasProcessing = videos.some((v) => v.status === "processing");
  React.useEffect(() => {
    if (!hasProcessing) return undefined;
    const timer = window.setInterval(() => {
      setVideos((list) =>
        list.map((video) => {
          if (video.status !== "processing") return video;
          const next = Math.min(100, video.progress + 3 + Math.round(Math.random() * 5));
          if (next >= 100) {
            setNotifications((items) => [{ id: uid(), type: "videoReady", params: { title: video.title }, read: false }, ...items]);
            return { ...video, status: "ready", progress: 100 };
          }
          return { ...video, progress: next };
        }),
      );
    }, 2000);
    return () => window.clearInterval(timer);
  }, [hasProcessing]);

  // -- shared video operations ----------------------------------------------
  const updateVideo = (id, patch) => setVideos((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const removeVideo = (id) => setVideos((list) => list.filter((v) => v.id !== id));
  const retryVideo = (id) => {
    updateVideo(id, { status: "processing", progress: 4, failReason: undefined });
    showToast(t("videos.retryToast"));
  };
  const toggleSaved = (video) => {
    updateVideo(video.id, { saved: !video.saved });
    showToast(t(video.saved ? "videos.unsavedToast" : "videos.savedToast"));
  };
  const startTranslation = ({ title, srcLang, tgtLang, durationMin, inputType }) => {
    const video = {
      id: uid(),
      title,
      srcLang,
      tgtLang,
      durationMin,
      addedAt: new Date().toISOString().slice(0, 10),
      inputType,
      status: "processing",
      progress: 3,
      saved: false,
      usedMin: durationMin,
    };
    setVideos((list) => [video, ...list]);
    setPlan((p) => ({ ...p, usedMin: Math.min(p.monthlyMin, p.usedMin + durationMin) }));
    showToast(t("wizard.review.startedToast"));
    nav("videos");
  };

  const langName = (code) => t(`langNames.${code}`);
  const remainingMin = plan.monthlyMin - plan.usedMin;

  const ctx = {
    t,
    lang,
    rtl,
    setLang,
    nav,
    route,
    videos,
    updateVideo,
    removeVideo,
    retryVideo,
    toggleSaved,
    startTranslation,
    notes,
    setNotes,
    tickets,
    setTickets,
    notifications,
    setNotifications,
    plan,
    setPlan,
    prefs,
    setPrefs,
    showToast,
    askConfirm,
    langName,
    remainingMin,
  };

  const sectionTitleKey = {
    home: "nav.home",
    "new-translation": "nav.newTranslation",
    videos: "nav.myVideos",
    saved: "nav.saved",
    subscription: "nav.subscription",
    support: "nav.support",
    settings: "nav.settings",
  }[route.section];

  const page = (() => {
    if (route.section === "videos" && route.videoId) return <WorkspacePage key={route.videoId} />;
    switch (route.section) {
      case "new-translation":
        return <NewTranslationPage />;
      case "videos":
        return <VideosPage />;
      case "saved":
        return <SavedPage />;
      case "subscription":
        return <SubscriptionPage />;
      case "support":
        return <SupportPage />;
      case "settings":
        return <SettingsPage />;
      default:
        return <HomePage />;
    }
  })();

  return (
    <Ctx.Provider value={ctx}>
      <div className="dsh-root" dir={rtl ? "rtl" : "ltr"} lang={lang}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {drawerOpen ? <div className="dsh-drawer-veil" onClick={() => setDrawerOpen(false)} /> : null}
        <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapsed} drawerOpen={drawerOpen} onCloseDrawer={() => setDrawerOpen(false)} />
        <div className="dsh-body">
          <Topbar title={t(sectionTitleKey)} onOpenDrawer={() => setDrawerOpen(true)} />
          <main className="dsh-main">
            <div className="dsh-wrap">{page}</div>
          </main>
        </div>
        <div className="dsh-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div className="dsh-toast" key={toast.id}>
              {toast.msg}
            </div>
          ))}
        </div>
        {confirmState ? <ConfirmModal cfg={confirmState} onClose={() => setConfirmState(null)} /> : null}
      </div>
    </Ctx.Provider>
  );
}

function ConfirmModal({ cfg, onClose }) {
  const { t } = useDash();
  const [word, setWord] = React.useState("");
  const blocked = cfg.requireWord && word.trim() !== cfg.requireWord;
  return (
    <Modal title={cfg.title} onClose={onClose}>
      <p>{cfg.desc}</p>
      {cfg.requireWord ? <input className="dsh-input" value={word} onChange={(e) => setWord(e.target.value)} placeholder={cfg.wordPlaceholder} /> : null}
      <div className="dsh-modal-actions">
        <Btn onClick={onClose}>{t("common.cancel")}</Btn>
        <Btn
          variant={cfg.danger ? "danger" : "primary"}
          disabled={blocked}
          onClick={() => {
            onClose();
            cfg.onConfirm();
          }}
        >
          {cfg.confirmLabel}
        </Btn>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Sidebar + topbar
// ---------------------------------------------------------------------------

function Sidebar({ collapsed, onToggleCollapse, drawerOpen, onCloseDrawer }) {
  const { t, nav, route, askConfirm, plan, prefs } = useDash();
  const items = [
    { key: "home", icon: <Home size={18} strokeWidth={1.9} />, label: t("nav.home") },
    { key: "videos", icon: <Video size={18} strokeWidth={1.9} />, label: t("nav.myVideos") },
    { key: "saved", icon: <Bookmark size={18} strokeWidth={1.9} />, label: t("nav.saved") },
  ];
  const items2 = [
    { key: "subscription", icon: <CreditCard size={18} strokeWidth={1.9} />, label: t("nav.subscription") },
    { key: "support", icon: <HelpCircle size={18} strokeWidth={1.9} />, label: t("nav.support") },
  ];
  const confirmLogout = () =>
    askConfirm({
      title: t("logout.title"),
      desc: t("logout.desc"),
      confirmLabel: t("logout.confirm"),
      onConfirm: () => {
        window.location.hash = "#/login";
      },
    });
  const navItem = (item) => (
    <button
      key={item.key}
      className={`dsh-nav-item${route.section === item.key ? " is-active" : ""}`}
      onClick={() => nav(item.key)}
      title={collapsed ? item.label : undefined}
    >
      {item.icon}
      <span className="dsh-hidecollapsed">{item.label}</span>
    </button>
  );
  return (
    <aside className={`dsh-side${collapsed ? " is-collapsed" : ""}${drawerOpen ? " is-open" : ""}`} aria-label={t("app.name")}>
      <div className="dsh-logo-row">
        <span className="dsh-logo dsh-hidecollapsed">VIDORA</span>
        {!collapsed ? null : <span className="dsh-logo">V</span>}
        <button className="dsh-collapse" onClick={onToggleCollapse} aria-label={collapsed ? t("nav.expand") : t("nav.collapse")} title={collapsed ? t("nav.expand") : t("nav.collapse")}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
        <button className="dsh-collapse" style={{ display: drawerOpen ? "grid" : "none" }} onClick={onCloseDrawer} aria-label={t("nav.closeMenu")}>
          <X size={17} />
        </button>
      </div>
      <button className="dsh-cta" onClick={() => nav("new-translation")} title={t("nav.newTranslation")}>
        <Plus size={17} strokeWidth={2.4} />
        <span className="dsh-hidecollapsed">{t("nav.newTranslation")}</span>
      </button>
      <nav className="dsh-nav">{items.map(navItem)}</nav>
      <div className="dsh-side-gap" />
      <nav className="dsh-nav">{items2.map(navItem)}</nav>
      <div className="dsh-side-spacer" />
      <div className="dsh-userbox">
        <button className="dsh-userinfo" onClick={() => nav("settings")} title={prefs.name}>
          <span className="dsh-avatar">{prefs.avatar ? <img src={prefs.avatar} alt="" /> : prefs.name.charAt(0)}</span>
          <span className="dsh-hidecollapsed">
            <span className="dsh-username">{prefs.name}</span>
            <br />
            <span className="dsh-userplan">{t("userMenu.plan", { plan: t(`subscription.plans.${plan.name.toLowerCase()}`) })}</span>
          </span>
        </button>
        <button className={`dsh-nav-item${route.section === "settings" ? " is-active" : ""}`} onClick={() => nav("settings")} title={t("nav.settings")}>
          <Settings size={18} strokeWidth={1.9} />
          <span className="dsh-hidecollapsed">{t("nav.settings")}</span>
        </button>
        <button className="dsh-nav-item" onClick={confirmLogout} title={t("nav.logout")}>
          <LogOut size={18} strokeWidth={1.9} />
          <span className="dsh-hidecollapsed">{t("nav.logout")}</span>
        </button>
      </div>
    </aside>
  );
}

function Topbar({ title, onOpenDrawer }) {
  const { t, lang, nav, notifications, setNotifications, prefs, plan } = useDash();
  const unread = notifications.some((n) => !n.read);
  const noticeText = (n) => {
    if (n.type === "videoReady") return t("home.notices.videoReady", { title: n.params.title });
    if (n.type === "videoFailed") return t("home.notices.videoFailed", { title: n.params.title });
    if (n.type === "renewalSoon") return t("home.notices.renewalSoon", { date: fmtDate(lang, n.params.dateISO) });
    if (n.type === "lowMinutes") return t("home.notices.lowMinutes", { minutes: fmtNum(lang, n.params.minutes) });
    if (n.type === "supportReply") return t("home.notices.supportReply", { subject: n.params.subject });
    return "";
  };
  return (
    <header className="dsh-top">
      <button className="dsh-burger" onClick={onOpenDrawer} aria-label={t("nav.openMenu")}>
        <MenuIcon size={19} />
      </button>
      <span className="dsh-top-title">{title}</span>
      <span className="dsh-top-spacer" />
      <Menu
        ariaLabel={t("home.notifications")}
        trigger={{
          className: "dsh-iconbtn",
          node: (
            <>
              <Bell size={18} strokeWidth={1.9} />
              {unread ? <span className="dsh-dot" /> : null}
            </>
          ),
        }}
        items={
          notifications.length
            ? [
                ...notifications.slice(0, 5).map((n) => ({
                  label: noticeText(n),
                  icon: <Bell size={15} />,
                  onClick: () => setNotifications((list) => list.map((item) => (item.id === n.id ? { ...item, read: true } : item))),
                })),
                "sep",
                { label: t("home.clearAll"), icon: <Check size={15} />, onClick: () => setNotifications([]) },
              ]
            : [{ label: t("home.noNotifications"), icon: <Bell size={15} />, onClick: () => {} }]
        }
      />
      <Menu
        ariaLabel={prefs.name}
        trigger={{
          className: "dsh-iconbtn",
          node: <span className="dsh-avatar" style={{ width: 30, height: 30, fontSize: 13 }}>{prefs.avatar ? <img src={prefs.avatar} alt="" /> : prefs.name.charAt(0)}</span>,
        }}
        items={[
          { label: `${prefs.name} · ${t("userMenu.plan", { plan: t(`subscription.plans.${plan.name.toLowerCase()}`) })}`, icon: <CreditCard size={15} />, onClick: () => nav("subscription") },
          { label: t("userMenu.settings"), icon: <Settings size={15} />, onClick: () => nav("settings") },
        ]}
      />
    </header>
  );
}

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

function HomePage() {
  const { t, lang, nav, videos, plan, remainingMin, retryVideo, prefs } = useDash();
  const processing = videos.filter((v) => v.status === "processing");
  const failed = videos.filter((v) => v.status === "failed");
  const recentReady = videos.filter((v) => v.status === "ready").slice(0, 2);
  const activity = [...processing, ...failed, ...recentReady];
  const usagePct = Math.round((plan.usedMin / plan.monthlyMin) * 100);
  const low = remainingMin < plan.monthlyMin * 0.15;

  const notices = [];
  if (low) notices.push({ icon: <Clock3 size={15} color="var(--warn)" />, text: t("home.notices.lowMinutes", { minutes: fmtNum(lang, remainingMin) }) });
  notices.push({ icon: <RefreshCw size={15} color="var(--acc)" />, text: t("home.notices.renewalSoon", { date: fmtDate(lang, plan.renewalISO) }) });
  failed.forEach((v) => notices.push({ icon: <X size={15} color="var(--bad)" />, text: t("home.notices.videoFailed", { title: v.title }) }));

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("home.welcome", { name: prefs.name.split(" ")[0] })}</h1>
        <p>{t("home.subtitle")}</p>
      </div>
      <div className="dsh-home-grid">
        <div className="dsh-home-col">
          <section className="dsh-card dsh-newcta">
            <h2>{t("home.cta.title")}</h2>
            <p className="dsh-sub" style={{ marginTop: 7, maxWidth: 480 }}>
              {t("home.cta.desc")}
            </p>
            <div className="dsh-newcta-actions">
              <Btn variant="primary" onClick={() => nav("new-translation")}>
                <Upload size={16} /> {t("home.cta.upload")}
              </Btn>
              <Btn onClick={() => nav("new-translation?method=youtube")}>
                <Link2 size={16} /> {t("home.cta.paste")}
              </Btn>
            </div>
            <div className="dsh-newcta-meta">
              <span>{t("home.cta.formats")}</span>
              <span>·</span>
              <span>{t("home.cta.maxSize")}</span>
            </div>
          </section>

          <section className="dsh-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <h2>{t("home.activity.title")}</h2>
              <Btn sm onClick={() => nav("videos")}>
                {t("home.activity.viewAll")}
              </Btn>
            </div>
            <div style={{ marginTop: 8 }}>
              {activity.length === 0 ? (
                <EmptyState icon={<Loader2 size={30} />} title={t("home.activity.empty")} desc={t("home.activity.emptyDesc")} />
              ) : (
                activity.map((video) => <ActivityRow key={video.id} video={video} onRetry={() => retryVideo(video.id)} />)
              )}
            </div>
          </section>
        </div>

        <div className="dsh-home-col">
          <section className="dsh-card">
            <h2>{t("home.usage.title")}</h2>
            <p className="dsh-usage-big" style={{ marginTop: 12 }}>
              {fmtNum(lang, remainingMin)} <small>{t("common.minutes")}</small>
            </p>
            <p className="dsh-hint" style={{ marginTop: 2 }}>
              {t("home.usage.remaining")}
            </p>
            <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <div className="dsh-usage-line">
                <span>{t("home.usage.monthly")}</span>
                <strong dir="ltr">
                  {fmtNum(lang, plan.usedMin)} / {fmtNum(lang, plan.monthlyMin)}
                </strong>
              </div>
              <Meter value={usagePct} warn={low} label={t("home.usage.title")} />
              <span className="dsh-hint">{t("home.usage.renewsOn", { date: fmtDate(lang, plan.renewalISO) })}</span>
              {low ? <span className="dsh-error">{t("home.usage.lowWarning")}</span> : null}
            </div>
            <Btn style={{ marginTop: 14, width: "100%" }} onClick={() => nav("subscription")}>
              {t("home.usage.manage")}
            </Btn>
          </section>

          <section className="dsh-card">
            <h2>{t("home.notices.title")}</h2>
            <div style={{ marginTop: 6 }}>
              {notices.map((notice, i) => (
                <div className="dsh-notice" key={i}>
                  {notice.icon}
                  <span>{notice.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ActivityRow({ video, onRetry }) {
  const { t, lang, nav } = useDash();
  const eta = Math.max(1, Math.round((100 - video.progress) / 7));
  return (
    <div className="dsh-activity-item">
      <div className="dsh-thumb" />
      <div style={{ minWidth: 0 }}>
        <p className="dsh-activity-name">{video.title}</p>
        <div className="dsh-activity-sub">
          <StatusBadge video={video} />
          {video.status === "processing" ? <span>{t("status.etaShort", { minutes: fmtNum(lang, eta) })}</span> : null}
          {video.status === "failed" && video.failReason ? <span className="dsh-fail-reason">{t(`videos.failReasons.${video.failReason}`)}</span> : null}
        </div>
        {video.status === "processing" ? (
          <div style={{ marginTop: 8, maxWidth: 320 }}>
            <Meter value={video.progress} label={video.title} />
          </div>
        ) : null}
      </div>
      {video.status === "failed" ? (
        <Btn sm onClick={onRetry}>
          <RefreshCw size={14} /> {t("videos.actions.retry")}
        </Btn>
      ) : (
        <Btn sm variant={video.status === "ready" ? "primary" : "ghost"} onClick={() => nav(`videos/${video.id}`)}>
          {video.status === "ready" ? t("videos.actions.open") : t("videos.actions.viewProgress")}
        </Btn>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New translation wizard
// ---------------------------------------------------------------------------

const YT_RE = /^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/)[\w-]{6,}/;

function NewTranslationPage() {
  const { t, lang, route, prefs, remainingMin, startTranslation, langName } = useDash();
  const steps = ["method", "file", "languages", "outputs", "review"];
  const [step, setStep] = React.useState(0);
  const [method, setMethod] = React.useState(route.query.get("method") === "youtube" ? "youtube" : "upload");
  const [file, setFile] = React.useState(null); // {name, sizeMB, durationMin}
  const [uploadPct, setUploadPct] = React.useState(null); // null | number | "failed"
  const [url, setUrl] = React.useState("");
  const [srcLang, setSrcLang] = React.useState(prefs.defaultSource);
  const [tgtLang, setTgtLang] = React.useState(prefs.defaultTarget);
  const [outputs, setOutputs] = React.useState({ subtitles: true, transcript: true, translation: true, summary: prefs.autoSummary, notes: prefs.autoNotes, srtFile: true, videoFile: false });
  const [error, setError] = React.useState("");
  const fileInput = React.useRef(null);
  const uploadTimer = React.useRef(null);

  React.useEffect(() => () => window.clearInterval(uploadTimer.current), []);

  const beginUpload = (picked) => {
    const ext = picked.name.split(".").pop().toLowerCase();
    if (!["mp4", "mov", "webm"].includes(ext)) return setError(t("wizard.file.invalidType"));
    if (picked.size > 2 * 1024 * 1024 * 1024) return setError(t("wizard.file.tooLarge"));
    setError("");
    const durationMin = 12 + (picked.size % 47);
    setFile({ name: picked.name, sizeMB: Math.round(picked.size / 1048576), durationMin: Math.round(durationMin) });
    setUploadPct(0);
    window.clearInterval(uploadTimer.current);
    uploadTimer.current = window.setInterval(() => {
      setUploadPct((p) => {
        if (p === null || p === "failed") return p;
        const next = p + 9 + Math.round(Math.random() * 9);
        if (next >= 100) {
          window.clearInterval(uploadTimer.current);
          return 100;
        }
        return next;
      });
    }, 300);
  };
  const cancelUpload = () => {
    window.clearInterval(uploadTimer.current);
    setFile(null);
    setUploadPct(null);
  };
  const resumeUpload = () => {
    setUploadPct((p) => (p === "failed" ? 40 : p));
    uploadTimer.current = window.setInterval(() => {
      setUploadPct((p) => {
        const next = (typeof p === "number" ? p : 40) + 12;
        if (next >= 100) {
          window.clearInterval(uploadTimer.current);
          return 100;
        }
        return next;
      });
    }, 300);
  };

  const durationMin = method === "upload" ? file?.durationMin || 0 : url ? 15 + (url.length % 41) : 0;
  const estProcessing = Math.max(2, Math.round(durationMin / 4));
  const videoTitle = method === "upload" ? (file ? file.name.replace(/\.[^.]+$/, "") : "") : "YouTube video";
  const insufficient = durationMin > remainingMin;

  const validateStep = () => {
    setError("");
    if (step === 1) {
      if (method === "upload") {
        if (!file || uploadPct !== 100) return setError(t("wizard.file.noInput")), false;
      } else if (!YT_RE.test(url.trim())) {
        return setError(t("wizard.file.urlInvalid")), false;
      }
    }
    if (step === 2 && srcLang !== "auto" && srcLang === tgtLang) return setError(t("wizard.languages.sameError")), false;
    if (step === 3 && !Object.values(outputs).some(Boolean)) return setError(t("wizard.outputs.minOne")), false;
    return true;
  };
  const next = () => validateStep() && setStep((s) => Math.min(steps.length - 1, s + 1));
  const back = () => {
    setError("");
    setStep((s) => Math.max(0, s - 1));
  };

  const LANGS = ["auto", "en", "fa", "es", "fr", "de", "ar", "tr"];
  const outputDefs = [
    ["subtitles", t("wizard.outputs.subtitles")],
    ["transcript", t("wizard.outputs.transcript")],
    ["translation", t("wizard.outputs.translation")],
    ["summary", t("wizard.outputs.summary")],
    ["notes", t("wizard.outputs.notes")],
    ["srtFile", t("wizard.outputs.srtFile")],
    ["videoFile", t("wizard.outputs.videoFile")],
  ];

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("wizard.title")}</h1>
        <p>{t("wizard.subtitle")}</p>
      </div>
      <section className="dsh-card" style={{ display: "grid", gap: 18 }}>
        <div className="dsh-steps" aria-label={t("wizard.stepLabel", { current: fmtNum(lang, step + 1), total: fmtNum(lang, steps.length) })}>
          {steps.map((key, i) => (
            <React.Fragment key={key}>
              {i > 0 ? <span className="dsh-step-line" /> : null}
              <span className={`dsh-step${i === step ? " is-active" : i < step ? " is-done" : ""}`}>
                <span className="dsh-step-dot">{i < step ? <Check size={13} /> : fmtNum(lang, i + 1)}</span>
                {t(`wizard.steps.${key}`)}
              </span>
            </React.Fragment>
          ))}
        </div>

        {step === 0 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h2>{t("wizard.method.title")}</h2>
            <div className="dsh-choice">
              <button className={`dsh-choice-card${method === "upload" ? " is-active" : ""}`} onClick={() => setMethod("upload")}>
                <h3>
                  <Upload size={17} /> {t("wizard.method.upload")}
                </h3>
                <p>{t("wizard.method.uploadDesc")}</p>
              </button>
              <button className={`dsh-choice-card${method === "youtube" ? " is-active" : ""}`} onClick={() => setMethod("youtube")}>
                <h3>
                  <Link2 size={17} /> {t("wizard.method.youtube")}
                </h3>
                <p>{t("wizard.method.youtubeDesc")}</p>
              </button>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h2>{t("wizard.file.title")}</h2>
            {method === "upload" ? (
              !file ? (
                <div className="dsh-drop">
                  <div>
                    <h3>{t("wizard.file.drop")}</h3>
                    <p>{t("wizard.file.hint")}</p>
                    <Btn variant="primary" style={{ marginTop: 14 }} onClick={() => fileInput.current?.click()}>
                      <Upload size={15} /> {t("wizard.file.browse")}
                    </Btn>
                  </div>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="dsh-filechip">
                    <FileText size={19} color="var(--acc)" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p className="dsh-filename">{file.name}</p>
                      <p className="dsh-hint" style={{ marginTop: 3 }} dir="ltr">
                        {file.sizeMB} MB
                      </p>
                    </div>
                    {uploadPct === 100 ? <Badge kind="ready">{t("status.ready")}</Badge> : null}
                  </div>
                  {uploadPct !== null && uploadPct !== 100 ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      {uploadPct === "failed" ? (
                        <span className="dsh-error">{t("wizard.file.uploadFailed")}</span>
                      ) : (
                        <>
                          <span className="dsh-hint">{t("wizard.file.uploadingLabel", { percent: fmtNum(lang, uploadPct) })}</span>
                          <Meter value={uploadPct} label={t("status.uploading")} />
                        </>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn sm onClick={cancelUpload}>
                          {t("wizard.file.cancelUpload")}
                        </Btn>
                        {uploadPct === "failed" ? (
                          <>
                            <Btn sm onClick={resumeUpload}>{t("wizard.file.resumeUpload")}</Btn>
                            <Btn sm onClick={() => beginUpload({ name: file.name, size: file.sizeMB * 1048576 })}>{t("wizard.file.retryUpload")}</Btn>
                          </>
                        ) : (
                          <Btn sm onClick={() => setUploadPct("failed")} title="mock">
                            ⏸
                          </Btn>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Btn sm onClick={() => fileInput.current?.click()}>
                        <RefreshCw size={14} /> {t("wizard.file.replace")}
                      </Btn>
                    </div>
                  )}
                </div>
              )
            ) : (
              <Field label={t("wizard.file.urlLabel")} hint={t("wizard.method.youtubeDesc")}>
                <input className="dsh-input" dir="ltr" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("wizard.file.urlPlaceholder")} />
              </Field>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="video/mp4,video/quicktime,video/webm"
              hidden
              onChange={(e) => e.target.files?.[0] && beginUpload(e.target.files[0])}
            />
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h2>{t("wizard.languages.title")}</h2>
            <div className="dsh-form-grid">
              <Field label={t("wizard.languages.source")} hint={t("wizard.languages.sourceHint")}>
                <select className="dsh-select" value={srcLang} onChange={(e) => setSrcLang(e.target.value)}>
                  {LANGS.map((code) => (
                    <option key={code} value={code}>
                      {langName(code)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("wizard.languages.target")} hint={t("wizard.languages.targetHint")}>
                <select className="dsh-select" value={tgtLang} onChange={(e) => setTgtLang(e.target.value)}>
                  {LANGS.filter((code) => code !== "auto").map((code) => (
                    <option key={code} value={code}>
                      {langName(code)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ display: "grid", gap: 14 }}>
            <h2>{t("wizard.outputs.title")}</h2>
            <div style={{ display: "grid", gap: 12 }}>
              {outputDefs.map(([key, label]) => (
                <Toggle key={key} checked={outputs[key]} onChange={(value) => setOutputs((o) => ({ ...o, [key]: value }))} label={label} />
              ))}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div style={{ display: "grid", gap: 12 }}>
            <h2>{t("wizard.review.title")}</h2>
            <div className="dsh-review-rows">
              <div className="dsh-review-row">
                <span>{t("wizard.review.video")}</span>
                <strong className="dsh-filename" style={{ maxWidth: "60%" }}>
                  {method === "upload" ? file?.name : url}
                </strong>
              </div>
              <div className="dsh-review-row">
                <span>{t("wizard.review.duration")}</span>
                <strong>{fmtNum(lang, durationMin)} {t("common.min")}</strong>
              </div>
              <div className="dsh-review-row">
                <span>{t("wizard.review.estUsage")}</span>
                <strong>{fmtNum(lang, durationMin)} {t("common.min")}</strong>
              </div>
              <div className="dsh-review-row">
                <span>{t("wizard.review.balance")}</span>
                <strong>{fmtNum(lang, remainingMin)} {t("common.min")}</strong>
              </div>
              <div className="dsh-review-row">
                <span>{t("wizard.review.afterBalance")}</span>
                <strong>{fmtNum(lang, Math.max(0, remainingMin - durationMin))} {t("common.min")}</strong>
              </div>
              <div className="dsh-review-row">
                <span>{t("wizard.review.estTime")}</span>
                <strong>{t("wizard.review.estTimeValue", { minutes: fmtNum(lang, estProcessing) })}</strong>
              </div>
            </div>
            {insufficient ? <p className="dsh-error">{t("wizard.review.insufficient")}</p> : null}
          </div>
        ) : null}

        {error ? <p className="dsh-error">{error}</p> : null}

        <div className="dsh-wizard-nav">
          <Btn onClick={back} disabled={step === 0}>
            {t("common.back")}
          </Btn>
          {step < steps.length - 1 ? (
            <Btn variant="primary" onClick={next}>
              {t("common.next")}
            </Btn>
          ) : (
            <Btn
              variant="primary"
              disabled={insufficient || durationMin === 0}
              onClick={() =>
                startTranslation({
                  title: videoTitle || "Untitled video",
                  srcLang: srcLang === "auto" ? "en" : srcLang,
                  tgtLang,
                  durationMin,
                  inputType: method,
                })
              }
            >
              <Play size={15} /> {t("wizard.review.start")}
            </Btn>
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// My Videos
// ---------------------------------------------------------------------------

function VideosPage() {
  const { t, lang, nav, videos, route, retryVideo, updateVideo, removeVideo, toggleSaved, askConfirm, showToast, langName } = useDash();
  const [filter, setFilter] = React.useState(route.query.get("filter") || "all");
  const [queryText, setQueryText] = React.useState("");
  const [sort, setSort] = React.useState("newest");
  const [renaming, setRenaming] = React.useState(null); // video
  const [renameValue, setRenameValue] = React.useState("");

  const shown = videos
    .filter((v) => (filter === "all" ? true : filter === "ready" ? v.status === "ready" : filter === "processing" ? v.status === "processing" : v.status === "failed"))
    .filter((v) => v.title.toLowerCase().includes(queryText.toLowerCase()))
    .sort((a, b) => {
      if (sort === "newest") return b.addedAt.localeCompare(a.addedAt);
      if (sort === "oldest") return a.addedAt.localeCompare(b.addedAt);
      if (sort === "title") return a.title.localeCompare(b.title);
      return b.durationMin - a.durationMin;
    });

  const downloadSrt = (video) => {
    const segments = buildSegments(video);
    const srt = segments.map((s, i) => `${i + 1}\n00:${fmtClock(s.start)},000 --> 00:${fmtClock(s.end)},000\n${s.tgt}\n`).join("\n");
    saveTextFile(`${video.title}.srt`, srt);
    showToast(t("common.downloadStarted"));
  };

  const rowMenu = (video) => [
    { label: t("videos.actions.open"), icon: <Play size={15} />, onClick: () => nav(`videos/${video.id}`) },
    { label: t("videos.actions.rename"), icon: <Pencil size={15} />, onClick: () => { setRenaming(video); setRenameValue(video.title); } },
    { label: t("videos.actions.download"), icon: <Download size={15} />, disabled: video.status !== "ready", onClick: () => downloadSrt(video) },
    { label: t("videos.actions.viewTranscript"), icon: <FileText size={15} />, disabled: video.status !== "ready", onClick: () => nav(`videos/${video.id}?tab=transcript`) },
    { label: video.saved ? t("videos.actions.unsaveVideo") : t("videos.actions.saveVideo"), icon: <Bookmark size={15} />, onClick: () => toggleSaved(video) },
    "sep",
    { label: video.status === "failed" ? t("videos.actions.retry") : t("videos.actions.reprocess"), icon: <RefreshCw size={15} />, onClick: () => retryVideo(video.id) },
    ...(video.inputType === "upload" ? [{ label: t("videos.actions.replaceFile"), icon: <Upload size={15} />, onClick: () => retryVideo(video.id) }] : []),
    "sep",
    { label: t("videos.actions.trash"), icon: <Trash2 size={15} />, onClick: () => { removeVideo(video.id); showToast(t("videos.trashToast")); } },
    {
      label: t("videos.actions.delete"),
      icon: <Trash2 size={15} />,
      danger: true,
      onClick: () =>
        askConfirm({
          title: t("videos.deleteConfirm.title"),
          desc: t("videos.deleteConfirm.desc", { title: video.title }),
          confirmLabel: t("videos.deleteConfirm.confirm"),
          danger: true,
          onConfirm: () => removeVideo(video.id),
        }),
    },
  ];

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("videos.title")}</h1>
        <p>{t("videos.subtitle")}</p>
      </div>
      <section className="dsh-card">
        <div className="dsh-controls">
          <div className="dsh-searchbox">
            <Search size={16} />
            <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder={t("videos.searchPlaceholder")} aria-label={t("common.search")} />
          </div>
          <div className="dsh-pills" role="tablist">
            {["all", "processing", "ready", "failed"].map((key) => (
              <button key={key} className={`dsh-pill${filter === key ? " is-active" : ""}`} onClick={() => setFilter(key)}>
                {t(`videos.filters.${key}`)}
              </button>
            ))}
          </div>
          <select className="dsh-select" style={{ width: "auto" }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("videos.sort.label")}>
            {["newest", "oldest", "title", "duration"].map((key) => (
              <option key={key} value={key}>
                {t(`videos.sort.${key}`)}
              </option>
            ))}
          </select>
        </div>

        <div style={{ marginTop: 6 }}>
          {shown.length === 0 ? (
            <EmptyState icon={<Video size={30} />} title={t("videos.empty.title")} desc={t("videos.empty.desc")} cta={t("videos.empty.cta")} onCta={() => nav("new-translation")} />
          ) : (
            shown.map((video) => {
              const eta = Math.max(1, Math.round((100 - video.progress) / 7));
              return (
                <article className="dsh-video-row" key={video.id}>
                  <div className="dsh-thumb is-lg" />
                  <div style={{ minWidth: 0 }}>
                    <p className="dsh-video-title">{video.title}</p>
                    <div className="dsh-video-meta">
                      <span>
                        {langName(video.srcLang)} ← {langName(video.tgtLang)}
                      </span>
                      <span>·</span>
                      <span>{fmtNum(lang, video.durationMin)} {t("common.min")}</span>
                      <span>·</span>
                      <span>{t(`videos.inputType.${video.inputType}`)}</span>
                      <span>·</span>
                      <span>{t("videos.uploadedOn", { date: fmtDate(lang, video.addedAt) })}</span>
                    </div>
                  </div>
                  <div className="dsh-video-status">
                    <StatusBadge video={video} />
                    {video.status === "processing" ? (
                      <>
                        <Meter value={video.progress} label={video.title} />
                        <span className="dsh-hint">{t("status.etaShort", { minutes: fmtNum(lang, eta) })}</span>
                      </>
                    ) : null}
                    {video.status === "failed" && video.failReason ? <span className="dsh-fail-reason">{t(`videos.failReasons.${video.failReason}`)}</span> : null}
                  </div>
                  <div className="dsh-row-actions">
                    {video.status === "failed" ? (
                      <Btn sm onClick={() => retryVideo(video.id)}>
                        <RefreshCw size={14} /> {t("videos.actions.retry")}
                      </Btn>
                    ) : (
                      <Btn sm variant={video.status === "ready" ? "primary" : "ghost"} onClick={() => nav(`videos/${video.id}`)}>
                        {video.status === "ready" ? t("videos.actions.open") : t("videos.actions.viewProgress")}
                      </Btn>
                    )}
                  </div>
                  <Menu ariaLabel={t("videos.actions.more")} trigger={{ className: "dsh-iconbtn", node: <MoreHorizontal size={17} /> }} items={rowMenu(video)} />
                </article>
              );
            })
          )}
        </div>
      </section>

      {renaming ? (
        <Modal title={t("videos.rename.title")} onClose={() => setRenaming(null)}>
          <Field label={t("videos.rename.label")}>
            <input className="dsh-input" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} autoFocus />
          </Field>
          <div className="dsh-modal-actions">
            <Btn onClick={() => setRenaming(null)}>{t("common.cancel")}</Btn>
            <Btn
              variant="primary"
              disabled={!renameValue.trim()}
              onClick={() => {
                updateVideo(renaming.id, { title: renameValue.trim() });
                setRenaming(null);
                showToast(t("videos.rename.saved"));
              }}
            >
              {t("common.save")}
            </Btn>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Video workspace
// ---------------------------------------------------------------------------

function WorkspacePage() {
  const { t, lang, rtl, nav, route, videos, notes, setNotes, updateVideo, retryVideo, showToast, askConfirm, langName } = useDash();
  const video = videos.find((v) => v.id === route.videoId);
  const [tab, setTab] = React.useState(route.query.get("tab") || "subtitles");
  const [segments, setSegments] = React.useState(() => (video ? buildSegments(video) : []));
  const [currentTime, setCurrentTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [subQuery, setSubQuery] = React.useState("");
  const [editingSeg, setEditingSeg] = React.useState(null);
  const [editValue, setEditValue] = React.useState("");
  const [noteText, setNoteText] = React.useState("");
  const [editingTranslation, setEditingTranslation] = React.useState(false);
  const [translationText, setTranslationText] = React.useState(() => segments.map((s) => s.tgt).join("\n"));
  const [changeTarget, setChangeTarget] = React.useState(null);

  const durationSec = video ? video.durationMin * 60 : 0;

  React.useEffect(() => {
    if (!playing) return undefined;
    const timer = window.setInterval(() => setCurrentTime((s) => (s + 1 >= durationSec ? 0 : s + 1)), 1000);
    return () => window.clearInterval(timer);
  }, [playing, durationSec]);

  React.useEffect(() => {
    if (!video) nav("videos");
  }, [video, nav]);
  if (!video) return null;

  const currentSegment = segments.find((s) => currentTime >= s.start && currentTime <= s.end);
  const videoNotes = notes.filter((n) => n.videoId === video.id).sort((a, b) => a.time - b.time);
  const transcriptText = segments.map((s) => `[${fmtClock(s.start)}] ${s.src}`).join("\n");
  const idx = lang === "fa" ? 1 : 0;

  const download = (kind) => {
    if (kind === "srt") saveTextFile(`${video.title}.srt`, segments.map((s, i) => `${i + 1}\n00:${fmtClock(s.start)},000 --> 00:${fmtClock(s.end)},000\n${s.tgt}\n`).join("\n"));
    if (kind === "transcript") saveTextFile(`${video.title}-transcript.txt`, transcriptText);
    if (kind === "translation") saveTextFile(`${video.title}-translation.txt`, translationText);
    if (kind === "summary") saveTextFile(`${video.title}-summary.txt`, [t("workspace.summary.short"), SUMMARY.short[idx], "", t("workspace.summary.detailed"), SUMMARY.detailed[idx]].join("\n"));
    showToast(t("common.downloadStarted"));
  };

  const doCopy = async (text) => {
    await copyText(text);
    showToast(t("common.copied"));
  };

  const addNote = () => {
    if (!noteText.trim()) return;
    setNotes((list) => [...list, { id: uid(), videoId: video.id, time: currentTime, text: noteText.trim(), createdAt: new Date().toISOString().slice(0, 10) }]);
    setNoteText("");
    showToast(t("workspace.notes.added"));
  };

  const shownSegments = segments.filter((s) => !subQuery || s.src.toLowerCase().includes(subQuery.toLowerCase()) || s.tgt.includes(subQuery));

  const tabs = ["subtitles", "transcript", "translation", "summary", "notes"];

  return (
    <>
      <div className="dsh-ws-head">
        <div className="dsh-ws-head-info">
          <button className="dsh-back" onClick={() => nav("videos")}>
            {rtl ? <ArrowRight size={14} /> : <ArrowLeft size={14} />} {t("workspace.back")}
          </button>
          <h1 className="dsh-ws-title">{video.title}</h1>
          <div className="dsh-ws-meta">
            <Badge kind="neutral">
              {langName(video.srcLang)} ← {langName(video.tgtLang)}
            </Badge>
            <span>{fmtNum(lang, video.durationMin)} {t("common.min")}</span>
            <StatusBadge video={video} />
          </div>
        </div>
        <div className="dsh-ws-actions">
          <Menu
            ariaLabel={t("workspace.downloads.menu")}
            trigger={{ className: "dsh-btn is-primary", node: (<><Download size={15} /> {t("workspace.downloads.menu")} <ChevronDown size={14} /></>) }}
            items={[
              { label: t("workspace.downloads.srt"), icon: <FileText size={15} />, onClick: () => download("srt") },
              { label: t("workspace.downloads.transcript"), icon: <FileText size={15} />, onClick: () => download("transcript") },
              { label: t("workspace.downloads.translation"), icon: <FileText size={15} />, onClick: () => download("translation") },
              { label: t("workspace.downloads.summary"), icon: <FileText size={15} />, onClick: () => download("summary") },
              { label: t("workspace.downloads.video"), icon: <Video size={15} />, disabled: video.status !== "ready", onClick: () => showToast(t("common.downloadStarted")) },
            ]}
          />
          <Menu
            ariaLabel={t("workspace.actions.more")}
            trigger={{ className: "dsh-iconbtn", node: <MoreHorizontal size={18} /> }}
            items={[
              { label: t("workspace.actions.rerun"), icon: <RefreshCw size={15} />, onClick: () => { retryVideo(video.id); showToast(t("workspace.actions.rerunToast")); } },
              { label: t("workspace.actions.changeTarget"), icon: <RefreshCw size={15} />, onClick: () => setChangeTarget(video.tgtLang) },
              "sep",
              { label: t("workspace.actions.report"), icon: <HelpCircle size={15} />, onClick: () => nav("support") },
            ]}
          />
        </div>
      </div>

      {video.status !== "ready" ? (
        <div className="dsh-banner">
          <Loader2 size={16} className="dsh-spin" /> {t("workspace.processingBanner")}
        </div>
      ) : null}

      <section className="dsh-player">
        <div className="dsh-player-stage">
          <button className="dsh-play" onClick={() => setPlaying((v) => !v)} aria-label={playing ? t("workspace.player.pause") : t("workspace.player.play")}>
            {playing ? <Pause size={26} /> : <Play size={26} style={{ marginInlineStart: 3 }} />}
          </button>
          {currentSegment ? (
            <div className="dsh-player-sub">
              <span>{currentSegment.tgt}</span>
            </div>
          ) : null}
        </div>
        <div className="dsh-player-bar" dir="ltr">
          <span className="dsh-time">{fmtClock(currentTime)}</span>
          <input type="range" min={0} max={durationSec} value={currentTime} onChange={(e) => setCurrentTime(Number(e.target.value))} aria-label={video.title} />
          <span className="dsh-time">{fmtClock(durationSec)}</span>
        </div>
      </section>

      <section className="dsh-card" style={{ paddingTop: 8 }}>
        <div className="dsh-tabs" role="tablist">
          {tabs.map((key) => (
            <button key={key} role="tab" aria-selected={tab === key} className={`dsh-tab${tab === key ? " is-active" : ""}`} onClick={() => setTab(key)}>
              {t(`workspace.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === "subtitles" ? (
          <div style={{ marginTop: 14, display: "grid", gap: 8 }}>
            <div className="dsh-searchbox" style={{ maxWidth: 340 }}>
              <Search size={15} />
              <input value={subQuery} onChange={(e) => setSubQuery(e.target.value)} placeholder={t("workspace.subtitles.search")} />
            </div>
            <p className="dsh-hint">{t("workspace.subtitles.editHint")}</p>
            {shownSegments.length === 0 ? <p className="dsh-sub">{t("workspace.subtitles.empty")}</p> : null}
            {shownSegments.map((seg) => (
              <div key={seg.id} className={`dsh-seg${currentSegment?.id === seg.id ? " is-current" : ""}`}>
                <button className="dsh-seg-time" dir="ltr" onClick={() => setCurrentTime(seg.start)}>
                  {fmtClock(seg.start)}
                </button>
                <div style={{ minWidth: 0 }}>
                  {editingSeg === seg.id ? (
                    <div style={{ display: "grid", gap: 8 }}>
                      <textarea className="dsh-textarea" style={{ minHeight: 70 }} value={editValue} onChange={(e) => setEditValue(e.target.value)} />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Btn sm variant="primary" onClick={() => { setSegments((list) => list.map((s) => (s.id === seg.id ? { ...s, tgt: editValue } : s))); setEditingSeg(null); showToast(t("workspace.subtitles.saved")); }}>
                          {t("common.save")}
                        </Btn>
                        <Btn sm onClick={() => setEditingSeg(null)}>{t("common.cancel")}</Btn>
                      </div>
                    </div>
                  ) : (
                    <button style={{ display: "block", width: "100%" }} onClick={() => setCurrentTime(seg.start)}>
                      <p className="dsh-seg-src" dir="ltr" style={{ textAlign: "start" }}>{seg.src}</p>
                      <p className="dsh-seg-tgt">{seg.tgt}</p>
                    </button>
                  )}
                </div>
                <button className="dsh-iconbtn" aria-label={t("common.edit")} onClick={() => { setEditingSeg(seg.id); setEditValue(seg.tgt); }}>
                  <Pencil size={15} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "transcript" ? (
          <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn sm onClick={() => doCopy(transcriptText)}>
                <Copy size={14} /> {t("common.copy")}
              </Btn>
              <Btn sm onClick={() => download("transcript")}>
                <Download size={14} /> {t("workspace.transcript.download")}
              </Btn>
            </div>
            <div style={{ display: "grid", gap: 10 }} dir="ltr">
              {segments.map((seg) => (
                <p className="dsh-longtext" key={seg.id}>
                  <button className="dsh-ts" onClick={() => setCurrentTime(seg.start)}>[{fmtClock(seg.start)}]</button> {seg.src}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {tab === "translation" ? (
          <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Btn sm onClick={() => doCopy(translationText)}>
                <Copy size={14} /> {t("common.copy")}
              </Btn>
              <Btn sm onClick={() => download("translation")}>
                <Download size={14} /> {t("workspace.translation.download")}
              </Btn>
              <Btn sm onClick={() => setEditingTranslation((v) => !v)}>
                <Pencil size={14} /> {t("common.edit")}
              </Btn>
            </div>
            {editingTranslation ? (
              <div style={{ display: "grid", gap: 10 }}>
                <textarea className="dsh-textarea" style={{ minHeight: 220 }} value={translationText} onChange={(e) => setTranslationText(e.target.value)} />
                <div>
                  <Btn sm variant="primary" onClick={() => { setEditingTranslation(false); showToast(t("workspace.translation.saved")); }}>
                    {t("common.save")}
                  </Btn>
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {segments.map((seg) => (
                  <p className="dsh-longtext" key={seg.id}>
                    <button className="dsh-ts" dir="ltr" onClick={() => setCurrentTime(seg.start)}>[{fmtClock(seg.start)}]</button> {seg.tgt}
                  </p>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {tab === "summary" ? (
          <div style={{ marginTop: 16, display: "grid", gap: 18 }}>
            <div>
              <h2 style={{ fontSize: 14.5 }}>{t("workspace.summary.keyPoints")}</h2>
              <ul style={{ marginTop: 10, display: "grid", gap: 8 }}>
                {SUMMARY.keyPoints.map((point, i) => (
                  <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
                    <Check size={15} color="var(--acc)" style={{ marginTop: 3, flex: "none" }} />
                    <span className="dsh-longtext" style={{ fontSize: 13.5 }}>{point[idx]}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 style={{ fontSize: 14.5 }}>{t("workspace.summary.short")}</h2>
              <p className="dsh-longtext" style={{ marginTop: 8, fontSize: 13.5 }}>{SUMMARY.short[idx]}</p>
            </div>
            <div>
              <h2 style={{ fontSize: 14.5 }}>{t("workspace.summary.detailed")}</h2>
              <p className="dsh-longtext" style={{ marginTop: 8, fontSize: 13.5 }}>{SUMMARY.detailed[idx]}</p>
            </div>
            <div>
              <h2 style={{ fontSize: 14.5 }}>{t("workspace.summary.chapters")}</h2>
              <div style={{ marginTop: 8 }}>
                {SUMMARY.chapters.map(([frac, en, fa]) => (
                  <button className="dsh-chapter" key={en} onClick={() => setCurrentTime(Math.round(durationSec * frac))} style={{ width: "100%" }}>
                    <span className="dsh-ts" dir="ltr">{fmtClock(Math.round(durationSec * frac))}</span>
                    <span style={{ fontSize: 13.5, fontWeight: 650 }}>{lang === "fa" ? fa : en}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {tab === "notes" ? (
          <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
            <div className="dsh-note-add">
              <textarea className="dsh-textarea" style={{ minHeight: 64, flex: 1 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={t("workspace.notes.placeholder")} />
              <Btn variant="primary" onClick={addNote} disabled={!noteText.trim()}>
                <Plus size={15} /> {t("workspace.notes.addAt", { time: fmtClock(currentTime) })}
              </Btn>
            </div>
            {videoNotes.length === 0 ? (
              <EmptyState icon={<StickyNote size={28} />} title={t("workspace.notes.empty")} desc={t("workspace.notes.emptyDesc")} />
            ) : (
              <div>
                {videoNotes.map((note) => (
                  <div className="dsh-note" key={note.id}>
                    <div className="dsh-note-head">
                      <button className="dsh-ts" dir="ltr" onClick={() => setCurrentTime(note.time)} title={t("workspace.notes.jump", { time: fmtClock(note.time) })}>
                        [{fmtClock(note.time)}]
                      </button>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="dsh-iconbtn" aria-label={t("common.edit")} onClick={() => {
                          const text = window.prompt(t("common.edit"), note.text);
                          if (text !== null && text.trim()) setNotes((list) => list.map((item) => (item.id === note.id ? { ...item, text: text.trim() } : item)));
                        }}>
                          <Pencil size={14} />
                        </button>
                        <button className="dsh-iconbtn" aria-label={t("common.delete")} onClick={() => { setNotes((list) => list.filter((item) => item.id !== note.id)); showToast(t("workspace.notes.deleted")); }}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <p className="dsh-note-text">{note.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {changeTarget !== null ? (
        <Modal title={t("workspace.actions.changeTargetTitle")} onClose={() => setChangeTarget(null)}>
          <p>{t("workspace.actions.changeTargetDesc")}</p>
          <select className="dsh-select" value={changeTarget} onChange={(e) => setChangeTarget(e.target.value)}>
            {["fa", "en", "es", "fr", "de", "ar", "tr"].map((code) => (
              <option key={code} value={code}>
                {langName(code)}
              </option>
            ))}
          </select>
          <div className="dsh-modal-actions">
            <Btn onClick={() => setChangeTarget(null)}>{t("common.cancel")}</Btn>
            <Btn variant="primary" onClick={() => { updateVideo(video.id, { tgtLang: changeTarget, status: "processing", progress: 5 }); setChangeTarget(null); showToast(t("workspace.actions.changed")); }}>
              {t("common.confirm")}
            </Btn>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Saved
// ---------------------------------------------------------------------------

function SavedPage() {
  const { t, lang, nav, route, videos, notes, toggleSaved, langName } = useDash();
  const [tab, setTab] = React.useState(route.query.get("tab") === "notes" ? "notes" : "videos");
  const [queryText, setQueryText] = React.useState("");
  const savedVideos = videos.filter((v) => v.saved);
  const shownNotes = notes.filter((n) => n.text.toLowerCase().includes(queryText.toLowerCase()));

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("saved.title")}</h1>
        <p>{t("saved.subtitle")}</p>
      </div>
      <section className="dsh-card" style={{ paddingTop: 8 }}>
        <div className="dsh-tabs" role="tablist">
          {["videos", "notes"].map((key) => (
            <button key={key} role="tab" aria-selected={tab === key} className={`dsh-tab${tab === key ? " is-active" : ""}`} onClick={() => setTab(key)}>
              {key === "videos" ? <Bookmark size={15} /> : <StickyNote size={15} />}
              {t(`saved.tabs.${key}`)}
            </button>
          ))}
        </div>

        {tab === "videos" ? (
          savedVideos.length === 0 ? (
            <EmptyState icon={<Bookmark size={30} />} title={t("saved.emptyVideos.title")} desc={t("saved.emptyVideos.desc")} cta={t("saved.emptyVideos.cta")} onCta={() => nav("videos")} />
          ) : (
            <div style={{ marginTop: 6 }}>
              {savedVideos.map((video) => (
                <article className="dsh-video-row" key={video.id} style={{ gridTemplateColumns: "66px minmax(0,1fr) auto auto" }}>
                  <div className="dsh-thumb is-lg" />
                  <div style={{ minWidth: 0 }}>
                    <p className="dsh-video-title">{video.title}</p>
                    <div className="dsh-video-meta">
                      <span>
                        {langName(video.srcLang)} ← {langName(video.tgtLang)}
                      </span>
                      <span>·</span>
                      <span>{fmtNum(lang, video.durationMin)} {t("common.min")}</span>
                    </div>
                  </div>
                  <Btn sm variant="primary" onClick={() => nav(`videos/${video.id}`)}>
                    {t("videos.actions.open")}
                  </Btn>
                  <button className="dsh-iconbtn" aria-label={t("videos.actions.unsaveVideo")} onClick={() => toggleSaved(video)}>
                    <Heart size={16} fill="var(--acc)" color="var(--acc)" />
                  </button>
                </article>
              ))}
            </div>
          )
        ) : shownNotes.length === 0 && !queryText ? (
          <EmptyState icon={<StickyNote size={30} />} title={t("saved.emptyNotes.title")} desc={t("saved.emptyNotes.desc")} cta={t("saved.emptyNotes.cta")} onCta={() => nav("videos")} />
        ) : (
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div className="dsh-searchbox" style={{ maxWidth: 340 }}>
              <Search size={15} />
              <input value={queryText} onChange={(e) => setQueryText(e.target.value)} placeholder={t("saved.searchNotes")} />
            </div>
            {shownNotes.map((note) => {
              const noteVideo = videos.find((v) => v.id === note.videoId);
              return (
                <div className="dsh-note" key={note.id}>
                  <div className="dsh-note-head">
                    <span className="dsh-hint">
                      {noteVideo ? t("saved.noteFrom", { title: noteVideo.title }) : ""} · <span dir="ltr" className="dsh-ts">[{fmtClock(note.time)}]</span>
                    </span>
                    <Btn sm onClick={() => nav(`videos/${note.videoId}?tab=notes`)}>{t("saved.openNote")}</Btn>
                  </div>
                  <p className="dsh-note-text">{note.text}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Subscription (plan + usage + billing)
// ---------------------------------------------------------------------------

function SubscriptionPage() {
  const { t, lang, plan, setPlan, videos, remainingMin, showToast, askConfirm } = useDash();
  const [plansOpen, setPlansOpen] = React.useState(false);
  const usagePct = Math.round((plan.usedMin / plan.monthlyMin) * 100);
  const usedVideos = videos.filter((v) => v.usedMin > 0);

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("subscription.title")}</h1>
        <p>{t("subscription.subtitle")}</p>
      </div>
      <div className="dsh-two-col">
        <section className="dsh-card">
          <h2>{t("subscription.plan.title")}</h2>
          <div className="dsh-review-rows" style={{ marginTop: 8 }}>
            <div className="dsh-review-row"><span>{t("subscription.plan.name")}</span><strong>{t(`subscription.plans.${plan.name.toLowerCase()}`)}</strong></div>
            <div className="dsh-review-row"><span>{t("subscription.plan.status")}</span><strong>{plan.cancelled ? <Badge kind="warn">{t("subscription.actions.cancelled")}</Badge> : <Badge kind="ready">{t("subscription.plan.active")}</Badge>}</strong></div>
            <div className="dsh-review-row"><span>{t("subscription.plan.monthly")}</span><strong>{fmtNum(lang, plan.monthlyMin)} {t("common.min")}</strong></div>
            <div className="dsh-review-row"><span>{t("subscription.plan.used")}</span><strong>{fmtNum(lang, plan.usedMin)} {t("common.min")}</strong></div>
            <div className="dsh-review-row"><span>{t("subscription.plan.remaining")}</span><strong>{fmtNum(lang, remainingMin)} {t("common.min")}</strong></div>
            <div className="dsh-review-row"><span>{t("subscription.plan.renewal")}</span><strong>{fmtDate(lang, plan.renewalISO, true)}</strong></div>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 16 }}>
            <Btn variant="primary" onClick={() => setPlansOpen(true)}>{t("subscription.actions.upgrade")}</Btn>
            <Btn onClick={() => setPlansOpen(true)}>{t("subscription.actions.manage")}</Btn>
            <Btn
              variant="danger-ghost"
              onClick={() =>
                askConfirm({
                  title: t("subscription.actions.cancelTitle"),
                  desc: t("subscription.actions.cancelDesc", { date: fmtDate(lang, plan.renewalISO, true) }),
                  confirmLabel: t("subscription.actions.cancelConfirm"),
                  danger: true,
                  onConfirm: () => {
                    setPlan((p) => ({ ...p, cancelled: true }));
                    showToast(t("subscription.actions.cancelled"));
                  },
                })
              }
            >
              {t("subscription.actions.cancel")}
            </Btn>
          </div>
        </section>

        <section className="dsh-card">
          <h2>{t("subscription.usage.title")}</h2>
          <div style={{ marginTop: 12, display: "grid", gap: 9 }}>
            <div className="dsh-usage-line">
              <span>{t("subscription.plan.used")}</span>
              <strong dir="ltr">{fmtNum(lang, plan.usedMin)} / {fmtNum(lang, plan.monthlyMin)}</strong>
            </div>
            <Meter value={usagePct} warn={usagePct > 85} label={t("subscription.usage.title")} />
            {usagePct > 85 ? <span className="dsh-error">{t("subscription.usage.warning", { percent: fmtNum(lang, usagePct) })}</span> : null}
          </div>
          <h2 style={{ marginTop: 20, fontSize: 14 }}>{t("subscription.usage.perVideo")}</h2>
          <div style={{ marginTop: 4 }}>
            {usedVideos.map((video) => (
              <div className="dsh-invoice-row" key={video.id}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 650 }}>{video.title}</span>
                <span className="dsh-hint">{t("subscription.usage.minutesUnit", { minutes: fmtNum(lang, video.usedMin) })}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="dsh-card">
        <h2>{t("subscription.billing.title")}</h2>
        <div className="dsh-review-rows" style={{ marginTop: 8 }}>
          <div className="dsh-review-row">
            <span>{t("subscription.billing.paymentMethod")}</span>
            <strong style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <CreditCard size={15} /> {t("subscription.billing.card")}
            </strong>
          </div>
        </div>
        <p className="dsh-hint" style={{ marginTop: 8 }}>{t("subscription.billing.renewalInfo", { date: fmtDate(lang, plan.renewalISO, true) })}</p>
        <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
          <Btn sm onClick={() => showToast(t("subscription.actions.paymentUpdated"))}>{t("subscription.actions.updatePayment")}</Btn>
        </div>
        <h2 style={{ marginTop: 22, fontSize: 14 }}>{t("subscription.billing.history")}</h2>
        <div style={{ marginTop: 4 }}>
          {INVOICES.map((invoice) => (
            <div className="dsh-invoice-row" key={invoice.id}>
              <span style={{ fontWeight: 650 }}>{fmtDate(lang, invoice.dateISO, true)}</span>
              <span className="dsh-hint">{t(`subscription.plans.${invoice.plan.toLowerCase()}`)} · <span dir="ltr">{invoice.amount}</span></span>
              <Badge kind="ready">{t("subscription.billing.paid")}</Badge>
              <Btn sm onClick={() => { saveTextFile(`vidora-invoice-${invoice.dateISO}.txt`, `Vidora ${invoice.plan} — ${invoice.amount} — ${invoice.dateISO}`); showToast(t("common.downloadStarted")); }}>
                <Download size={13} /> {t("subscription.billing.downloadInvoice")}
              </Btn>
            </div>
          ))}
        </div>
      </section>

      {plansOpen ? (
        <Modal title={t("subscription.plans.title")} onClose={() => setPlansOpen(false)}>
          <div className="dsh-plan-grid">
            {[
              ["free", "$0", 120],
              ["pro", "$19", 2000],
              ["team", "$49", 8000],
            ].map(([key, price, minutes]) => {
              const isCurrent = plan.name.toLowerCase() === key;
              return (
                <div className={`dsh-plan-opt${isCurrent ? " is-current" : ""}`} key={key}>
                  <strong>{t(`subscription.plans.${key}`)}</strong>
                  <span className="dsh-plan-price" dir="ltr">
                    {price}
                    <small>{t("subscription.plans.perMonth")}</small>
                  </span>
                  <span className="dsh-hint">{fmtNum(lang, minutes)} {t("common.minutes")}</span>
                  <Btn sm variant={isCurrent ? "ghost" : "primary"} disabled={isCurrent} onClick={() => { setPlansOpen(false); showToast(t("subscription.plans.chosen", { plan: t(`subscription.plans.${key}`) })); }}>
                    {isCurrent ? t("subscription.plans.current") : t("subscription.plans.choose", { plan: t(`subscription.plans.${key}`) })}
                  </Btn>
                </div>
              );
            })}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

function SupportPage() {
  const { t, lang, tickets, setTickets, showToast } = useDash();
  const [topic, setTopic] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [attachment, setAttachment] = React.useState(null);
  const [errors, setErrors] = React.useState({});
  const [openTicket, setOpenTicket] = React.useState(null);
  const [reply, setReply] = React.useState("");
  const attachInput = React.useRef(null);
  const topics = ["upload", "translation", "billing", "account", "feature", "other"];

  const submit = () => {
    const errs = {};
    if (!topic) errs.topic = t("common.required");
    if (!subject.trim()) errs.subject = t("common.required");
    if (!message.trim()) errs.message = t("common.required");
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setTickets((list) => [
      { id: uid(), topic, subject: subject.trim(), status: "open", createdAt: new Date().toISOString().slice(0, 10), messages: [{ from: "you", text: message.trim(), at: new Date().toISOString().slice(0, 10) }] },
      ...list,
    ]);
    setTopic("");
    setSubject("");
    setMessage("");
    setAttachment(null);
    showToast(t("support.form.sent"));
  };

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("support.title")}</h1>
        <p>{t("support.subtitle")}</p>
      </div>
      <section className="dsh-card">
        <h2>{t("support.form.title")}</h2>
        <div className="dsh-form-grid" style={{ marginTop: 14 }}>
          <Field label={t("support.form.topic")} error={errors.topic}>
            <select className="dsh-select" value={topic} onChange={(e) => setTopic(e.target.value)}>
              <option value="" disabled>
                {t("support.form.topicPlaceholder")}
              </option>
              {topics.map((key) => (
                <option key={key} value={key}>
                  {t(`support.form.topics.${key}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("support.form.subject")} error={errors.subject}>
            <input className="dsh-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("support.form.subjectPlaceholder")} />
          </Field>
          <div className="is-full">
            <Field label={t("support.form.message")} error={errors.message}>
              <textarea className="dsh-textarea" value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t("support.form.messagePlaceholder")} />
            </Field>
          </div>
          <div className="is-full" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Btn sm onClick={() => attachInput.current?.click()}>
              <Paperclip size={14} /> {t("support.form.attach")}
            </Btn>
            {attachment ? (
              <span className="dsh-badge is-neutral" style={{ direction: "ltr" }}>
                {attachment}
                <button onClick={() => setAttachment(null)} aria-label={t("common.remove")} style={{ display: "grid" }}>
                  <X size={12} />
                </button>
              </span>
            ) : null}
            <input ref={attachInput} type="file" hidden onChange={(e) => setAttachment(e.target.files?.[0]?.name || null)} />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
          <Btn variant="primary" onClick={submit}>
            {t("support.form.submit")}
          </Btn>
          <span className="dsh-hint">{t("support.form.responseTime")}</span>
        </div>
      </section>

      <section className="dsh-card">
        <h2>{t("support.history.title")}</h2>
        <div style={{ marginTop: 12 }}>
          {tickets.length === 0 ? (
            <p className="dsh-sub">{t("support.history.empty")}</p>
          ) : (
            tickets.map((ticket) => (
              <div className="dsh-ticket" key={ticket.id}>
                <button className="dsh-ticket-head" onClick={() => setOpenTicket(openTicket === ticket.id ? null : ticket.id)}>
                  <Badge kind={ticket.status === "answered" ? "ready" : ticket.status === "open" ? "processing" : "neutral"}>{t(`support.history.status.${ticket.status}`)}</Badge>
                  <span style={{ flex: 1, textAlign: "start", fontWeight: 700, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{ticket.subject}</span>
                  <span className="dsh-hint">{fmtDate(lang, ticket.createdAt)}</span>
                  <ChevronDown size={15} style={{ transform: openTicket === ticket.id ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                </button>
                {openTicket === ticket.id ? (
                  <div className="dsh-ticket-body">
                    {ticket.messages.map((msg, i) => (
                      <div className={`dsh-msg${msg.from === "team" ? " is-team" : ""}`} key={i}>
                        <p className="dsh-msg-head">
                          {msg.from === "team" ? t("support.history.team") : t("support.history.you")} <span>{fmtDate(lang, msg.at)}</span>
                        </p>
                        <p>{msg.text}</p>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 9 }}>
                      <input className="dsh-input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("support.history.replyPlaceholder")} />
                      <Btn
                        variant="primary"
                        sm
                        style={{ height: 41 }}
                        disabled={!reply.trim()}
                        onClick={() => {
                          setTickets((list) => list.map((item) => (item.id === ticket.id ? { ...item, status: "open", messages: [...item.messages, { from: "you", text: reply.trim(), at: new Date().toISOString().slice(0, 10) }] } : item)));
                          setReply("");
                          showToast(t("support.history.replySent"));
                        }}
                      >
                        {t("support.history.reply")}
                      </Btn>
                    </div>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsPage() {
  const { t, lang, setLang, prefs, setPrefs, showToast, askConfirm, langName } = useDash();
  const [emailError, setEmailError] = React.useState("");
  const avatarInput = React.useRef(null);
  const LANGS = ["auto", "en", "fa", "es", "fr", "de", "ar", "tr"];

  const saveProfile = () => {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(prefs.email)) return setEmailError(t("settings.profile.emailInvalid"));
    setEmailError("");
    showToast(t("settings.savedToast"));
  };

  const set = (patch) => setPrefs((p) => ({ ...p, ...patch }));

  return (
    <>
      <div className="dsh-page-h">
        <h1>{t("settings.title")}</h1>
        <p>{t("settings.subtitle")}</p>
      </div>

      <section className="dsh-card">
        <h2>{t("settings.profile.title")}</h2>
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
          <span className="dsh-avatar is-lg">{prefs.avatar ? <img src={prefs.avatar} alt="" /> : prefs.name.charAt(0)}</span>
          <Btn sm onClick={() => avatarInput.current?.click()}>
            {t("settings.profile.changePhoto")}
          </Btn>
          <input ref={avatarInput} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) set({ avatar: URL.createObjectURL(f) }); }} />
        </div>
        <div className="dsh-form-grid" style={{ marginTop: 16 }}>
          <Field label={t("settings.profile.name")}>
            <input className="dsh-input" value={prefs.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label={t("settings.profile.email")} error={emailError}>
            <input className="dsh-input" dir="ltr" value={prefs.email} onChange={(e) => set({ email: e.target.value })} />
          </Field>
        </div>
        <div style={{ marginTop: 14 }}>
          <Btn variant="primary" onClick={saveProfile}>{t("common.saveChanges")}</Btn>
        </div>
      </section>

      <section className="dsh-card">
        <h2>{t("settings.language.title")}</h2>
        <div className="dsh-form-grid" style={{ marginTop: 14 }}>
          <Field label={t("settings.language.interface")} hint={t("settings.language.interfaceHint")}>
            <select className="dsh-select" value={lang} onChange={(e) => setLang(e.target.value)}>
              <option value="fa">فارسی</option>
              <option value="en">English</option>
            </select>
          </Field>
          <Field label={t("settings.language.defaultTranslation")}>
            <select className="dsh-select" value={prefs.defaultTarget} onChange={(e) => set({ defaultTarget: e.target.value })}>
              {LANGS.filter((code) => code !== "auto").map((code) => (
                <option key={code} value={code}>{langName(code)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.language.timezone")}>
            <select className="dsh-select" value={prefs.timezone} onChange={(e) => set({ timezone: e.target.value })}>
              {["Asia/Tehran", "Europe/London", "America/New_York", "UTC"].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.language.dateFormat")}>
            <select className="dsh-select" value={prefs.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
              <option value="auto">{langName(lang)}</option>
              <option value="iso">YYYY-MM-DD</option>
            </select>
          </Field>
        </div>
      </section>

      <section className="dsh-card">
        <h2>{t("settings.defaults.title")}</h2>
        <div className="dsh-form-grid" style={{ marginTop: 14 }}>
          <Field label={t("settings.defaults.source")}>
            <select className="dsh-select" value={prefs.defaultSource} onChange={(e) => set({ defaultSource: e.target.value })}>
              {LANGS.map((code) => (
                <option key={code} value={code}>{langName(code)}</option>
              ))}
            </select>
          </Field>
          <Field label={t("settings.defaults.target")}>
            <select className="dsh-select" value={prefs.defaultTarget} onChange={(e) => set({ defaultTarget: e.target.value })}>
              {LANGS.filter((code) => code !== "auto").map((code) => (
                <option key={code} value={code}>{langName(code)}</option>
              ))}
            </select>
          </Field>
        </div>
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <Toggle checked={prefs.autoSubtitles} onChange={(v) => set({ autoSubtitles: v })} label={t("settings.defaults.autoSubtitles")} />
          <Toggle checked={prefs.autoSummary} onChange={(v) => set({ autoSummary: v })} label={t("settings.defaults.autoSummary")} />
          <Toggle checked={prefs.autoNotes} onChange={(v) => set({ autoNotes: v })} label={t("settings.defaults.autoNotes")} />
        </div>
      </section>

      <section className="dsh-card">
        <h2>{t("settings.notifications.title")}</h2>
        <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
          <Toggle checked={prefs.notifCompleted} onChange={(v) => set({ notifCompleted: v })} label={t("settings.notifications.completed")} />
          <Toggle checked={prefs.notifFailed} onChange={(v) => set({ notifFailed: v })} label={t("settings.notifications.failed")} />
          <Toggle checked={prefs.notifLowBalance} onChange={(v) => set({ notifLowBalance: v })} label={t("settings.notifications.lowBalance")} />
          <Toggle checked={prefs.notifRenewal} onChange={(v) => set({ notifRenewal: v })} label={t("settings.notifications.renewal")} />
          <Toggle checked={prefs.notifSupport} onChange={(v) => set({ notifSupport: v })} label={t("settings.notifications.supportReply")} />
        </div>
      </section>

      <section className="dsh-card">
        <h2>{t("settings.security.title")}</h2>
        <div className="dsh-review-rows" style={{ marginTop: 8 }}>
          <div className="dsh-review-row">
            <span>{t("settings.security.loginMethod")}</span>
            <strong>{t("settings.security.emailPassword")}</strong>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Btn sm onClick={() => showToast(t("settings.security.passwordRequested"))}>{t("settings.security.changePassword")}</Btn>
        </div>
        <h2 style={{ marginTop: 20, fontSize: 14 }}>{t("settings.security.sessions")}</h2>
        <div style={{ marginTop: 4 }}>
          <div className="dsh-sessions-row">
            <span style={{ fontWeight: 650 }}>{t("settings.security.thisDevice")} · <span className="dsh-hint" dir="ltr">Chrome</span></span>
            <Badge kind="ready">{t("subscription.plan.active")}</Badge>
          </div>
          <div className="dsh-sessions-row">
            <span className="dsh-hint" dir="ltr">Safari · iPhone</span>
            <Btn sm onClick={() => showToast(t("settings.security.signedOutOthers"))}>{t("settings.security.signOutOthers")}</Btn>
          </div>
        </div>
      </section>

      <section className="dsh-card dsh-danger-card">
        <h2 style={{ color: "var(--bad)" }}>{t("settings.danger.title")}</h2>
        <p className="dsh-sub" style={{ marginTop: 8 }}>{t("settings.danger.desc")}</p>
        <div style={{ marginTop: 14 }}>
          <Btn
            variant="danger-ghost"
            onClick={() =>
              askConfirm({
                title: t("settings.danger.confirmTitle"),
                desc: t("settings.danger.confirmDesc", { word: t("settings.danger.confirmWord") }),
                confirmLabel: t("settings.danger.confirmButton"),
                danger: true,
                requireWord: t("settings.danger.confirmWord"),
                wordPlaceholder: t("settings.danger.confirmPlaceholder"),
                onConfirm: () => {
                  window.location.hash = "#/";
                },
              })
            }
          >
            <Trash2 size={15} /> {t("settings.danger.delete")}
          </Btn>
        </div>
      </section>
    </>
  );
}

export default VidoraDashboard;
