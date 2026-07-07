// Vidora Library — public monochrome content-discovery page (#/library) and
// the dedicated watch route (#/watch/:slug). Structure mirrors the provided
// streaming-reference: cinematic hero, trending carousel, main grid with
// search/filters/sort, secondary featured banner, similar-videos carousel.
// Strictly black / white / neutral gray. All copy lives in
// src/locales/{en,fa}/library.json; language follows the site-wide selector.
import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BrainCircuit,
  Briefcase,
  Building2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FileText,
  FlaskConical,
  Globe,
  Languages,
  ListVideo,
  Lock,
  Menu as MenuIcon,
  Package,
  Play,
  Rocket,
  Search,
  Sparkles,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import enDict from "./locales/en/library.json";
import faDict from "./locales/fa/library.json";

const DICTS = { en: enDict, fa: faDict };

// ---------------------------------------------------------------------------
// i18n + helpers
// ---------------------------------------------------------------------------

const lookup = (dict, path) => path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), dict);

function makeT(lang) {
  const dict = DICTS[lang] || DICTS.en;
  return (path, params) => {
    let value = lookup(dict, path);
    if (value === undefined) value = lookup(DICTS.en, path);
    if (typeof value !== "string") return path;
    if (params) for (const [key, raw] of Object.entries(params)) value = value.split(`{${key}}`).join(String(raw));
    return value;
  };
}

const fmtNum = (lang, n) => Number(n).toLocaleString(lang === "fa" ? "fa-IR" : "en-US", { useGrouping: false });

// ---------------------------------------------------------------------------
// Mock viewer/auth state (guest | member | subscriber) + saved list
// ---------------------------------------------------------------------------

function readViewer() {
  try {
    const v = window.localStorage.getItem("vidora-viewer");
    return v === "member" || v === "subscriber" ? v : "guest";
  } catch (e) {
    return "guest";
  }
}

function readSaved() {
  try {
    return JSON.parse(window.localStorage.getItem("vidora-lib-saved") || "[]");
  } catch (e) {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Content (mocked; bilingual titles/descriptions)
// ---------------------------------------------------------------------------

const CAT_ICONS = {
  ai: BrainCircuit,
  startup: Rocket,
  business: Briefcase,
  tech: Cpu,
  biography: User,
  companies: Building2,
  product: Package,
  language: Languages,
  worldnews: Globe,
  science: FlaskConical,
};

// tone: rotating monochrome thumbnail gradients (kept dark & calm)
const TONES = [
  "linear-gradient(160deg,#26262c 0%,#101014 62%,#0a0a0d 100%)",
  "linear-gradient(200deg,#1c1c22 0%,#0e0e12 55%,#131318 100%)",
  "linear-gradient(150deg,#30303a 0%,#14141a 45%,#0a0a0d 100%)",
  "linear-gradient(210deg,#222228 0%,#0c0c10 70%)",
  "linear-gradient(140deg,#191920 0%,#26262e 40%,#0b0b0f 100%)",
];

const V = (slug, fa, en, category, type, durationMin, viewsK, access, addedAt, extra = {}) => ({
  slug,
  title: { fa, en },
  category,
  type,
  durationMin,
  viewsK,
  access,
  addedAt,
  ...extra,
});

const VIDEOS = [
  V("future-of-ai", "آینده هوش مصنوعی", "The Future of Artificial Intelligence", "ai", "documentary", 38, 112, "preview", "2026-07-04", {
    featured: true,
    desc: {
      fa: "نگاهی روشن به ابزارهای جدید هوش مصنوعی، تغییرات بازار کار و مهارت‌هایی که امروز باید یاد بگیریم.",
      en: "A clear look at new AI tools, changes in the job market, and the skills worth learning today.",
    },
  }),
  V("sam-altman-talk", "گفت‌وگو با سم آلتمن", "A Conversation with Sam Altman", "ai", "interview", 55, 120, "subscription", "2026-07-02", {
    featured: true,
    desc: {
      fa: "گفت‌وگویی بلند درباره آینده مدل‌ها، محصول‌سازی با AI و مسیر پیش روی سازندگان.",
      en: "A long-form conversation about the future of models, building with AI, and the road ahead for builders.",
    },
  }),
  V("building-giants", "داستان ساخت شرکت‌های بزرگ", "How the Giants Were Built", "companies", "documentary", 55, 89, "subscription", "2026-06-28", {
    featured: true,
    desc: {
      fa: "از گاراژ تا غول فناوری؛ روایت تصمیم‌های کوچکی که شرکت‌های بزرگ را ساختند.",
      en: "From garage to giant — the small decisions that built the world's biggest companies.",
    },
  }),
  V("openai-history", "تاریخچه OpenAI", "The History of OpenAI", "companies", "documentary", 61, 154, "subscription", "2026-06-20", {
    banner: true,
    desc: {
      fa: "مستندی درباره شکل‌گیری OpenAI؛ از آزمایشگاه پژوهشی تا تأثیرگذارترین شرکت هوش مصنوعی جهان.",
      en: "A documentary on the making of OpenAI — from research lab to the world's most influential AI company.",
    },
  }),
  V("how-ai-agents-work", "AI Agentها چگونه کار می‌کنند", "How AI Agents Work", "ai", "course", 24, 64, "free", "2026-07-06", { progress: 45 }),
  V("startup-pricing", "استراتژی قیمت‌گذاری برای استارتاپ‌ها", "Pricing Strategy for Startups", "startup", "course", 42, 71, "subscription", "2026-07-05"),
  V("founder-paths", "مسیر رشد بنیان‌گذاران", "The Founder's Growth Path", "biography", "biography", 47, 38, "preview", "2026-06-30"),
  V("product-builders", "درس‌هایی از سازندگان محصول", "Lessons from Product Builders", "product", "interview", 33, 27, "free", "2026-06-26"),
  V("ai-economics", "اقتصاد هوش مصنوعی", "The Economics of AI", "ai", "documentary", 29, 44, "subscription", "2026-06-24"),
  V("successful-products", "چگونه محصولات موفق ساخته می‌شوند", "How Successful Products Are Made", "product", "course", 36, 52, "free", "2026-06-22"),
  V("future-of-work", "آینده بازار کار", "The Future of Work", "business", "documentary", 31, 76, "preview", "2026-06-18"),
  V("entrepreneur-decisions", "زندگی و تصمیم‌های کارآفرینان بزرگ", "Decisions of Great Entrepreneurs", "biography", "biography", 58, 41, "subscription", "2026-06-15"),
  V("english-with-video", "یادگیری زبان با ویدیوهای واقعی", "Learning Languages with Real Videos", "language", "course", 22, 33, "free", "2026-06-12"),
  V("tech-trends", "روندهای فناوری ۲۰۲۶", "Tech Trends 2026", "tech", "news", 27, 58, "preview", "2026-06-10"),
  V("world-economy", "مرور اقتصاد جهان", "World Economy Brief", "worldnews", "news", 18, 21, "free", "2026-06-08"),
  V("design-thinking", "تفکر طراحی در عمل", "Design Thinking in Practice", "product", "course", 40, 30, "subscription", "2026-06-05"),
  V("space-science", "علم فضا برای همه", "Space Science for Everyone", "science", "documentary", 44, 66, "preview", "2026-06-02"),
  V("bootstrapping", "رشد بدون سرمایه‌گذار", "Growing Without Investors", "startup", "interview", 35, 25, "free", "2026-05-28"),
  V("brand-story", "چگونه برند ساخته می‌شود", "How Brands Are Built", "business", "course", 30, 19, "subscription", "2026-05-24"),
  V("ai-in-schools", "هوش مصنوعی در آموزش", "AI in Education", "ai", "news", 26, 35, "free", "2026-05-20"),
];

const HERO_SLUGS = ["future-of-ai", "sam-altman-talk", "building-giants"];
const BANNER_SLUG = "openai-history";
const bySlug = (slug) => VIDEOS.find((v) => v.slug === slug);
const toneOf = (video) => TONES[VIDEOS.indexOf(video) % TONES.length];

const BASE = () => import.meta.env.BASE_URL;
const HERO_IMAGES = { "future-of-ai": "uploads/IMG_0765.JPG", "sam-altman-talk": "uploads/IMG_0766.JPG", "building-giants": "uploads/IMG_0765.JPG" };
const BANNER_IMAGE = "uploads/IMG_0766.JPG";

const GENERIC_DESC = {
  fa: "در این ویدیوی آموزشی، مفاهیم کلیدی با زیرنویس فارسی، خلاصه هوشمند و نکات کاربردی ارائه می‌شود.",
  en: "In this learning video, the key ideas come with Persian subtitles, a smart summary, and practical takeaways.",
};

const CHAPTERS = [
  { frac: 0.04, fa: "شروع و معرفی", en: "Introduction" },
  { frac: 0.38, fa: "ایده‌های اصلی", en: "Core ideas" },
  { frac: 0.74, fa: "جمع‌بندی و قدم بعدی", en: "Wrap-up & next steps" },
];

// ---------------------------------------------------------------------------
// Styles — strict monochrome, logical properties for RTL
// ---------------------------------------------------------------------------

const CSS = `
.lib-root{--bg:#08080a;--s1:#0f0f12;--s2:#17171b;--s3:#1d1d22;--ink:#fff;--mut:#a3a3ad;--mut2:#71717a;--line:rgba(255,255,255,.1);--line2:rgba(255,255,255,.16);
  background:var(--bg);color:var(--ink);min-height:100vh;font-family:var(--font-sans)}
.lib-root *,.lib-root *::before,.lib-root *::after{box-sizing:border-box}
.lib-root :where(h1,h2,h3,p){margin:0}
.lib-root :where(button){font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer;text-align:inherit}
.lib-root :where(input,select){font:inherit;color:inherit}
.lib-root :where(a){color:inherit;text-decoration:none}
.lib-wrap{max-width:1440px;margin:0 auto;padding-inline:40px}

/* header */
.lib-head{position:sticky;top:0;z-index:60;background:rgba(8,8,10,.86);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.lib-head-in{height:64px;display:flex;align-items:center;gap:22px}
.lib-logo{display:flex;align-items:center;flex:none}
.lib-logo img{height:20px;width:auto;display:block}
.lib-logo span{font-weight:800;letter-spacing:.16em;font-size:16px;color:#fff}
.lib-nav{display:flex;gap:4px;margin-inline:auto}
.lib-nav button{height:34px;padding-inline:14px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--mut)}
.lib-nav button:hover{color:#fff}
.lib-nav button.is-active{background:#fff;color:#000}
.lib-head-actions{display:flex;align-items:center;gap:10px;flex:none}
.lib-iconbtn{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;color:#d6d6dd}
.lib-iconbtn:hover{background:var(--s2)}
.lib-login{height:36px;padding-inline:16px;border-radius:999px;background:#fff;color:#000;font-weight:700;font-size:13px;display:inline-flex;align-items:center}
.lib-burger{display:none}
.lib-drawer-veil{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70}
.lib-drawer{position:fixed;top:0;bottom:0;inset-inline-start:0;width:270px;background:var(--s1);border-inline-end:1px solid var(--line);z-index:75;padding:20px;display:none;flex-direction:column;gap:4px}
.lib-drawer.is-open{display:flex}
.lib-drawer button{height:44px;border-radius:11px;padding-inline:13px;text-align:start;font-weight:650;font-size:14.5px;color:var(--mut);display:flex;align-items:center;gap:10px}
.lib-drawer button.is-active{background:#fff;color:#000}

/* buttons */
.lib-btn{height:44px;border-radius:10px;padding-inline:22px;font-size:14px;font-weight:750;display:inline-flex;align-items:center;justify-content:center;gap:9px;white-space:nowrap}
.lib-btn.is-primary{background:#fff;color:#000}
.lib-btn.is-primary:hover{background:#e4e4e8}
.lib-btn.is-ghost{background:rgba(255,255,255,.08);border:1px solid var(--line2);color:#fff}
.lib-btn.is-ghost:hover{background:rgba(255,255,255,.14)}
.lib-btn.is-sm{height:36px;padding-inline:14px;font-size:12.5px;border-radius:9px}

/* hero */
.lib-hero{position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.lib-hero-media{position:absolute;inset:0;background-size:cover;background-position:center;filter:grayscale(1);transition:opacity .5s ease}
.lib-hero-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,10,.94) 0%,rgba(8,8,10,.72) 34%,rgba(8,8,10,.28) 62%,rgba(8,8,10,.55) 100%)}
[dir="rtl"] .lib-hero-shade{background:linear-gradient(270deg,rgba(8,8,10,.94) 0%,rgba(8,8,10,.72) 34%,rgba(8,8,10,.28) 62%,rgba(8,8,10,.55) 100%)}
.lib-hero-shade::after{content:"";position:absolute;inset-inline:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,rgba(8,8,10,.9))}
.lib-hero-in{position:relative;min-height:clamp(430px,58vh,620px);display:flex;align-items:center;padding-block:64px}
.lib-hero-box{max-width:41%;display:grid;gap:16px}
.lib-hero-label{font-size:12px;font-weight:750;letter-spacing:.08em;color:var(--mut);text-transform:uppercase}
.lib-hero-title{font-size:clamp(30px,3.4vw,50px);font-weight:800;line-height:1.16;letter-spacing:-.01em}
.lib-hero-desc{color:#cfcfd6;font-size:15px;line-height:1.85;max-width:52ch}
.lib-hero-meta{display:flex;align-items:center;gap:9px;color:var(--mut);font-size:13px;font-weight:600;flex-wrap:wrap}
.lib-hero-cta{display:flex;gap:11px;margin-top:6px}
.lib-hero-dots{position:absolute;bottom:22px;inset-inline:0;display:flex;justify-content:center;gap:7px}
.lib-hero-dots button{width:22px;height:4px;border-radius:999px;background:rgba(255,255,255,.22)}
.lib-hero-dots button.is-active{background:#fff}

/* sections */
.lib-section{margin-top:88px}
.lib-section.is-tight{margin-top:64px}
.lib-sec-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.lib-sec-title{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:800;letter-spacing:-.01em}
.lib-sec-title svg{color:var(--mut)}
.lib-sec-spacer{flex:1}
.lib-toplinks{display:flex;gap:4px}
.lib-toplinks button{height:32px;padding-inline:13px;border-radius:999px;font-size:12.5px;font-weight:650;color:var(--mut);display:inline-flex;align-items:center;gap:7px}
.lib-toplinks button:hover{color:#fff}
.lib-toplinks button.is-active{background:#fff;color:#000}

/* chips + pills */
.lib-chips{display:flex;gap:8px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-top:22px;padding-block:2px}
.lib-chips::-webkit-scrollbar{display:none}
.lib-chip{height:34px;flex:none;padding-inline:15px;border-radius:999px;border:1px solid var(--line2);background:transparent;font-size:12.5px;font-weight:650;color:#d6d6dd;display:inline-flex;align-items:center;gap:7px}
.lib-chip:hover{border-color:rgba(255,255,255,.35)}
.lib-chip.is-active{background:#fff;border-color:#fff;color:#000}

/* carousel */
.lib-carousel{position:relative;margin-top:26px}
.lib-row{display:grid;grid-auto-flow:column;grid-auto-columns:calc((100% - 64px)/5);gap:16px;overflow-x:auto;scroll-snap-type:x mandatory;scrollbar-width:none;padding-block:4px}
.lib-row::-webkit-scrollbar{display:none}
.lib-row>*{scroll-snap-align:start}
.lib-arrow{position:absolute;top:calc(50% - 40px);width:38px;height:38px;border-radius:999px;background:var(--s2);border:1px solid var(--line2);display:grid;place-items:center;color:#fff;z-index:5}
.lib-arrow:hover{background:var(--s3)}
.lib-arrow.is-prev{inset-inline-start:-19px}
.lib-arrow.is-next{inset-inline-end:-19px}
.lib-arrow:disabled{opacity:.3;cursor:default}

/* card */
.lib-card{display:grid;gap:10px;min-width:0;text-align:start}
.lib-thumb{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;border:1px solid var(--line);background:var(--s2)}
.lib-thumb-art{position:absolute;inset:0;display:grid;place-items:center;transition:transform .35s ease}
.lib-thumb-art svg{opacity:.16;color:#fff}
.lib-card:hover .lib-thumb-art{transform:scale(1.05)}
.lib-card:hover .lib-thumb{border-color:rgba(255,255,255,.28);box-shadow:0 14px 34px rgba(0,0,0,.5)}
.lib-thumb-shade{position:absolute;inset-inline:0;bottom:0;height:46%;background:linear-gradient(180deg,transparent,rgba(0,0,0,.55))}
.lib-play-overlay{position:absolute;inset:0;display:grid;place-items:center;opacity:0;transition:opacity .2s ease;background:rgba(0,0,0,.28)}
.lib-card:hover .lib-play-overlay,.lib-card:focus-visible .lib-play-overlay{opacity:1}
.lib-play-circle{width:46px;height:46px;border-radius:999px;background:#fff;color:#000;display:grid;place-items:center}
.lib-badge{position:absolute;top:10px;inset-inline-start:10px;height:24px;padding-inline:9px;border-radius:999px;border:1px solid rgba(255,255,255,.34);background:rgba(0,0,0,.5);color:#fff;font-size:10.5px;font-weight:700;display:inline-flex;align-items:center;gap:5px;backdrop-filter:blur(4px)}
.lib-save{position:absolute;top:8px;inset-inline-end:8px;width:32px;height:32px;border-radius:999px;background:rgba(0,0,0,.52);display:grid;place-items:center;color:#fff;backdrop-filter:blur(4px)}
.lib-save:hover{background:rgba(0,0,0,.78)}
.lib-progress{position:absolute;inset-inline:0;bottom:0;height:3px;background:rgba(255,255,255,.18)}
.lib-progress>span{display:block;height:100%;background:#fff}
.lib-card-title{font-size:13.5px;font-weight:700;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.9em}
.lib-card-meta{font-size:12px;color:var(--mut);display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-height:18px}
.lib-card-extra{font-size:11.5px;color:var(--mut2)}

/* library controls */
.lib-search{display:flex;align-items:center;gap:11px;height:48px;border-radius:12px;border:1px solid var(--line2);background:var(--s1);padding-inline:16px;margin-top:26px}
.lib-search:focus-within{border-color:rgba(255,255,255,.45)}
.lib-search input{flex:1;min-width:0;background:none;border:0;outline:none;font-size:14px;color:#fff}
.lib-search input::placeholder{color:var(--mut2)}
.lib-search svg{color:var(--mut);flex:none}
.lib-sorts{display:flex;gap:10px;margin-inline-start:auto}
.lib-select{height:36px;border-radius:9px;border:1px solid var(--line2);background:var(--s1);color:#d6d6dd;padding-inline:10px;font-size:12.5px;font-weight:600;outline:none}
.lib-select:focus{border-color:rgba(255,255,255,.4)}
.lib-controls-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:18px}

/* grid */
.lib-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:26px 16px;margin-top:30px}
.lib-loadmore{display:grid;place-items:center;margin-top:36px}
.lib-empty{display:grid;place-items:center;text-align:center;gap:6px;padding:70px 20px;border:1px dashed var(--line);border-radius:14px;margin-top:30px}
.lib-empty svg{color:var(--mut2);margin-bottom:6px}
.lib-empty p{color:var(--mut);font-size:14px}

/* secondary banner */
.lib-banner{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--line);margin-top:100px}
.lib-banner-media{position:absolute;inset:0;background-size:cover;background-position:center 30%;filter:grayscale(1)}
.lib-banner-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,10,.95) 0%,rgba(8,8,10,.7) 42%,rgba(8,8,10,.3) 100%)}
[dir="rtl"] .lib-banner-shade{background:linear-gradient(270deg,rgba(8,8,10,.95) 0%,rgba(8,8,10,.7) 42%,rgba(8,8,10,.3) 100%)}
.lib-banner-in{position:relative;padding:46px clamp(24px,4vw,56px);min-height:340px;display:flex;flex-direction:column;justify-content:center;gap:14px}
.lib-banner-box{max-width:46%;display:grid;gap:13px}
.lib-banner-title{font-size:clamp(24px,2.6vw,36px);font-weight:800;letter-spacing:-.01em;line-height:1.2}
.lib-banner-tabs{display:flex;gap:3px;margin-top:10px;border-top:1px solid var(--line);padding-top:12px}
.lib-banner-tabs button{height:32px;padding-inline:13px;border-radius:999px;font-size:12.5px;font-weight:650;color:var(--mut)}
.lib-banner-tabs button.is-active{background:#fff;color:#000}
.lib-banner-panel{color:#cfcfd6;font-size:13.5px;line-height:1.85;min-height:64px}
.lib-banner-panel .lib-chaprow{display:flex;gap:10px;align-items:center;padding-block:4px}
.lib-ts{color:#fff;font-weight:750;font-size:11.5px;font-variant-numeric:tabular-nums}

/* skeletons */
.lib-skel{background:linear-gradient(100deg,var(--s2) 40%,var(--s3) 50%,var(--s2) 60%);background-size:200% 100%;animation:libshimmer 1.4s infinite linear;border-radius:12px}
@keyframes libshimmer{to{background-position:-200% 0}}
.lib-skel-line{height:13px;border-radius:6px}

/* toast */
.lib-toasts{position:fixed;bottom:22px;inset-inline-end:22px;display:grid;gap:8px;z-index:90}
.lib-toast{background:#fff;color:#000;border-radius:11px;padding:11px 15px;font-size:13px;font-weight:700;box-shadow:0 16px 40px rgba(0,0,0,.45);max-width:320px}

/* watch page */
.lib-watch{padding-block:34px 90px}
.lib-back{display:inline-flex;align-items:center;gap:7px;color:var(--mut);font-size:13px;font-weight:700;margin-bottom:18px}
.lib-back:hover{color:#fff}
.lib-player{position:relative;border-radius:16px;overflow:hidden;border:1px solid var(--line);aspect-ratio:16/9;max-height:560px;width:100%;background:radial-gradient(ellipse at 50% 32%,#232329,#0a0a0d)}
.lib-player-center{position:absolute;inset:0;display:grid;place-items:center}
.lib-playbtn{width:70px;height:70px;border-radius:999px;background:#fff;color:#000;display:grid;place-items:center;box-shadow:0 18px 50px rgba(0,0,0,.5)}
.lib-playbtn:hover{transform:scale(1.05)}
.lib-gate{display:grid;place-items:center;text-align:center;gap:12px;padding:26px;background:rgba(8,8,10,.78);backdrop-filter:blur(6px);position:absolute;inset:0}
.lib-gate p{font-size:15px;font-weight:650;max-width:400px;line-height:1.8}
.lib-gate svg{color:var(--mut)}
.lib-watch-head{display:flex;align-items:flex-start;gap:16px;margin-top:26px;flex-wrap:wrap}
.lib-watch-title{font-size:clamp(22px,2.4vw,32px);font-weight:800;letter-spacing:-.01em;line-height:1.25}
.lib-watch-meta{display:flex;align-items:center;gap:9px;color:var(--mut);font-size:13px;font-weight:600;margin-top:10px;flex-wrap:wrap}
.lib-watch-cols{display:grid;grid-template-columns:minmax(0,1.9fr) minmax(0,1fr);gap:34px;margin-top:26px;align-items:start}
.lib-watch-desc{color:#cfcfd6;font-size:14.5px;line-height:1.95}
.lib-side-card{border:1px solid var(--line);border-radius:14px;background:var(--s1);padding:18px;display:grid;gap:12px}
.lib-side-card h3{font-size:14px;font-weight:750}
.lib-inc{display:flex;align-items:center;gap:9px;color:var(--mut);font-size:13px}
.lib-inc svg{color:#d6d6dd}
.lib-note{border:1px solid var(--line2);border-radius:11px;background:var(--s1);color:var(--mut);font-size:13px;padding:11px 14px;margin-top:12px;line-height:1.7}
.lib-pillbadge{height:24px;padding-inline:10px;border-radius:999px;border:1px solid rgba(255,255,255,.3);font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:5px;color:#fff}

@media(prefers-reduced-motion:reduce){.lib-root *{transition:none!important;animation:none!important}}

/* responsive */
@media(max-width:1120px){
  .lib-row{grid-auto-columns:calc((100% - 32px)/3)}
  .lib-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .lib-hero-box{max-width:60%}
  .lib-banner-box{max-width:70%}
  .lib-watch-cols{grid-template-columns:1fr}
}
@media(max-width:760px){
  .lib-wrap{padding-inline:18px}
  .lib-nav,.lib-login{display:none}
  .lib-burger{display:grid}
  .lib-head-in{height:56px;gap:12px}
  .lib-row{grid-auto-columns:calc((100% - 12px)/1.9);gap:12px}
  .lib-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px}
  .lib-hero-in{min-height:430px;align-items:flex-end;padding-block:40px 56px}
  .lib-hero-box{max-width:100%}
  .lib-section{margin-top:56px}
  .lib-banner-box{max-width:100%}
  .lib-banner-in{min-height:0;padding:26px 18px}
  .lib-arrow{display:none}
  .lib-sorts{margin-inline-start:0;width:100%}
  .lib-sorts .lib-select{flex:1}
  .lib-toasts{inset-inline:14px;bottom:14px}
}
`;

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const Ctx = React.createContext(null);
const useLib = () => React.useContext(Ctx);

function LibraryProvider({ children }) {
  const { lang, setLang } = window.useLang();
  const rtl = lang === "fa";
  const t = React.useMemo(() => makeT(lang), [lang]);
  const [viewer] = React.useState(readViewer);
  const [saved, setSaved] = React.useState(readSaved);
  const [toasts, setToasts] = React.useState([]);

  const showToast = React.useCallback((msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, msg }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2600);
  }, []);

  const toggleSave = React.useCallback(
    (slug) => {
      if (viewer === "guest") {
        showToast(t("watch.loginToSave"));
        return;
      }
      setSaved((list) => {
        const next = list.includes(slug) ? list.filter((s) => s !== slug) : [...list, slug];
        try {
          window.localStorage.setItem("vidora-lib-saved", JSON.stringify(next));
        } catch (e) {/* ignore */}
        showToast(t(list.includes(slug) ? "watch.unsavedToast" : "watch.savedToast"));
        return next;
      });
    },
    [viewer, showToast, t],
  );

  const catName = (key) => t(`categories.${key}`);
  const title = (video) => video.title[lang] || video.title.en;
  const desc = (video) => (video.desc ? video.desc[lang] || video.desc.en : GENERIC_DESC[lang] || GENERIC_DESC.en);

  const ctx = { t, lang, rtl, setLang, viewer, saved, toggleSave, showToast, catName, title, desc };
  return (
    <Ctx.Provider value={ctx}>
      <div className="lib-root" dir={rtl ? "rtl" : "ltr"} lang={lang}>
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        {children}
        <div className="lib-toasts" aria-live="polite">
          {toasts.map((toast) => (
            <div className="lib-toast" key={toast.id}>
              {toast.msg}
            </div>
          ))}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Header (logo stays physically left in both languages)
// ---------------------------------------------------------------------------

function LibraryHeader() {
  const { t } = useLib();
  const [drawer, setDrawer] = React.useState(false);
  const [logoBroken, setLogoBroken] = React.useState(false);
  const items = [
    { key: "home", label: t("nav.home"), go: () => (window.location.hash = "#/") },
    { key: "library", label: t("nav.library"), go: () => (window.location.hash = "#/library"), active: true },
    { key: "categories", label: t("nav.categories"), go: () => document.getElementById("lib-main")?.scrollIntoView({ behavior: "smooth" }) },
    { key: "new", label: t("nav.new"), go: () => document.getElementById("lib-trending")?.scrollIntoView({ behavior: "smooth" }) },
    { key: "mylist", label: t("nav.myList"), go: () => document.getElementById("lib-main")?.scrollIntoView({ behavior: "smooth" }) },
  ];
  const focusSearch = () => {
    document.getElementById("lib-search-input")?.focus();
    document.getElementById("lib-main")?.scrollIntoView({ behavior: "smooth" });
  };
  return (
    <header className="lib-head">
      <div className="lib-wrap lib-head-in" dir="ltr">
        <a className="lib-logo" href="#/" aria-label="Vidora" style={{ gap: 9 }}>
          {logoBroken ? null : <img src={`${BASE()}assets/logos/vidora-mark-white.png`} alt="" onError={() => setLogoBroken(true)} />}
          <span>VIDORA</span>
        </a>
        <nav className="lib-nav" aria-label={t("nav.menu")}>
          {items.map((item) => (
            <button key={item.key} className={item.active ? "is-active" : ""} onClick={item.go}>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="lib-head-actions">
          <button className="lib-iconbtn" aria-label={t("nav.search")} onClick={focusSearch}>
            <Search size={17} />
          </button>
          <a className="lib-login" href="#/login">
            {t("nav.login")}
          </a>
          <button className="lib-iconbtn lib-burger" aria-label={t("nav.menu")} onClick={() => setDrawer(true)}>
            <MenuIcon size={19} />
          </button>
        </div>
      </div>
      {drawer ? <div className="lib-drawer-veil" onClick={() => setDrawer(false)} /> : null}
      <div className={`lib-drawer${drawer ? " is-open" : ""}`}>
        <button onClick={() => setDrawer(false)} aria-label={t("nav.close")} style={{ justifyContent: "flex-end" }}>
          <X size={18} />
        </button>
        {items.map((item) => (
          <button key={item.key} className={item.active ? "is-active" : ""} onClick={() => { setDrawer(false); item.go(); }}>
            {item.label}
          </button>
        ))}
        <button onClick={() => (window.location.hash = "#/login")}>{t("nav.login")}</button>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function AccessBadge({ video }) {
  const { t } = useLib();
  if (video.access === "subscription") {
    return (
      <span className="lib-badge">
        <Lock size={10} /> {t("access.subscription")}
      </span>
    );
  }
  return <span className="lib-badge">{t(`access.${video.access}`)}</span>;
}

function SaveButton({ video }) {
  const { t, saved, toggleSave } = useLib();
  const isSaved = saved.includes(video.slug);
  return (
    <button
      className="lib-save"
      aria-label={t(isSaved ? "card.unsave" : "card.save")}
      aria-pressed={isSaved}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleSave(video.slug);
      }}
    >
      <Bookmark size={15} fill={isSaved ? "#fff" : "none"} />
    </button>
  );
}

function VideoCard({ video }) {
  const { t, lang, catName, title } = useLib();
  const Icon = CAT_ICONS[video.category] || Sparkles;
  const extra = video.progress
    ? t("card.watching")
    : video.viewsK >= 40
      ? t("card.views", { count: fmtNum(lang, video.viewsK) })
      : null;
  return (
    <a className="lib-card" href={`#/watch/${video.slug}`} aria-label={title(video)}>
      <span className="lib-thumb">
        <span className="lib-thumb-art" style={{ background: toneOf(video) }}>
          <Icon size={72} strokeWidth={1.1} />
        </span>
        <span className="lib-thumb-shade" />
        <AccessBadge video={video} />
        <SaveButton video={video} />
        <span className="lib-play-overlay">
          <span className="lib-play-circle">
            <Play size={19} style={{ marginInlineStart: 2 }} />
          </span>
        </span>
        {video.progress ? (
          <span className="lib-progress" dir="ltr">
            <span style={{ width: `${video.progress}%` }} />
          </span>
        ) : null}
      </span>
      <span className="lib-card-title">{title(video)}</span>
      <span className="lib-card-meta">
        <span>{catName(video.category)}</span>
        <span>·</span>
        <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
      </span>
      <span className="lib-card-extra">{extra || " "}</span>
    </a>
  );
}

function SkeletonCard() {
  return (
    <div className="lib-card" aria-hidden="true">
      <div className="lib-skel" style={{ aspectRatio: "2/3" }} />
      <div className="lib-skel lib-skel-line" style={{ width: "88%" }} />
      <div className="lib-skel lib-skel-line" style={{ width: "55%" }} />
    </div>
  );
}

function VideoCarousel({ videos, loading, ariaLabel }) {
  const { t, rtl } = useLib();
  const rowRef = React.useRef(null);
  const scroll = (fwd) => {
    const row = rowRef.current;
    if (!row) return;
    const amount = row.clientWidth * 0.9 * (fwd ? 1 : -1) * (rtl ? -1 : 1);
    row.scrollBy({ left: amount, behavior: "smooth" });
  };
  return (
    <div className="lib-carousel">
      <button className="lib-arrow is-prev" aria-label={t("trending.prev")} onClick={() => scroll(false)}>
        {rtl ? <ChevronRight size={19} /> : <ChevronLeft size={19} />}
      </button>
      <div className="lib-row" ref={rowRef} tabIndex={0} role="list" aria-label={ariaLabel}>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : videos.map((video) => <VideoCard key={video.slug} video={video} />)}
      </div>
      <button className="lib-arrow is-next" aria-label={t("trending.next")} onClick={() => scroll(true)}>
        {rtl ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
      </button>
    </div>
  );
}

function CategoryChips({ active, onChange, keys }) {
  const { t, catName } = useLib();
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? keys : keys.slice(0, 6);
  return (
    <div className="lib-chips" role="tablist">
      <button className={`lib-chip${active === "all" ? " is-active" : ""}`} role="tab" aria-selected={active === "all"} onClick={() => onChange("all")}>
        {t("categories.all")}
      </button>
      {visible.map((key) => (
        <button key={key} className={`lib-chip${active === key ? " is-active" : ""}`} role="tab" aria-selected={active === key} onClick={() => onChange(key)}>
          {catName(key)}
        </button>
      ))}
      {!expanded && keys.length > 6 ? (
        <button className="lib-chip" onClick={() => setExpanded(true)}>
          {t("trending.more")} +
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function FeaturedHero({ loading }) {
  const { t, lang, title, desc, catName, saved, toggleSave } = useLib();
  const [slide, setSlide] = React.useState(0);
  const items = HERO_SLUGS.map(bySlug);
  const video = items[slide];
  if (loading) {
    return (
      <div className="lib-hero">
        <div className="lib-wrap lib-hero-in">
          <div className="lib-hero-box" style={{ width: "100%" }}>
            <div className="lib-skel lib-skel-line" style={{ width: 130 }} />
            <div className="lib-skel" style={{ height: 52, width: "78%" }} />
            <div className="lib-skel lib-skel-line" style={{ width: "94%" }} />
            <div className="lib-skel lib-skel-line" style={{ width: "60%" }} />
          </div>
        </div>
      </div>
    );
  }
  const isSaved = saved.includes(video.slug);
  return (
    <section className="lib-hero" aria-label={t("hero.label")}>
      <div className="lib-hero-media" style={{ backgroundImage: `url(${BASE()}${HERO_IMAGES[video.slug]})` }} />
      <div className="lib-hero-shade" />
      <div className="lib-wrap lib-hero-in">
        <div className="lib-hero-box">
          <p className="lib-hero-label">{t("hero.label")}</p>
          <h1 className="lib-hero-title">{title(video)}</h1>
          <p className="lib-hero-desc">{desc(video)}</p>
          <div className="lib-hero-meta">
            <span>{catName(video.category)}</span>
            <span>·</span>
            <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
            <span>·</span>
            <span>{t(`access.${video.access}`)}</span>
          </div>
          <div className="lib-hero-cta">
            <a className="lib-btn is-primary" href={`#/watch/${video.slug}`}>
              <Play size={16} /> {t("hero.watch")}
            </a>
            <button className="lib-btn is-ghost" onClick={() => toggleSave(video.slug)}>
              <Bookmark size={16} fill={isSaved ? "#fff" : "none"} /> {t(isSaved ? "hero.saved" : "hero.save")}
            </button>
          </div>
        </div>
      </div>
      <div className="lib-hero-dots">
        {items.map((item, i) => (
          <button key={item.slug} className={i === slide ? "is-active" : ""} aria-label={t("hero.slide", { n: fmtNum(lang, i + 1) })} onClick={() => setSlide(i)} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Library page
// ---------------------------------------------------------------------------

const TREND_CATS = ["ai", "startup", "business", "tech", "biography", "companies"];
const ALL_CATS = ["ai", "startup", "business", "tech", "biography", "companies", "product", "language", "worldnews", "science"];
const TYPES = ["course", "interview", "documentary", "news", "biography"];
const GRID_STEP = 10;

function LibraryPageInner() {
  const { t, lang } = useLib();
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setLoading(false), 650);
    return () => window.clearTimeout(timer);
  }, []);

  // trending state
  const [trendFilter, setTrendFilter] = React.useState("popular");
  const [trendCat, setTrendCat] = React.useState("all");
  const trending = React.useMemo(() => {
    let list = [...VIDEOS];
    if (trendCat !== "all") list = list.filter((v) => v.category === trendCat);
    if (trendFilter === "new") list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    else if (trendFilter === "featured") list = [...list.filter((v) => v.featured || v.banner), ...list.filter((v) => !v.featured && !v.banner)];
    else list.sort((a, b) => b.viewsK - a.viewsK);
    return list.slice(0, 10);
  }, [trendFilter, trendCat]);

  // library state
  const [query, setQuery] = React.useState("");
  const [type, setType] = React.useState("all");
  const [cat, setCat] = React.useState("all");
  const [sort, setSort] = React.useState("newest");
  const [duration, setDuration] = React.useState("all");
  const [limit, setLimit] = React.useState(GRID_STEP);

  const filtered = React.useMemo(() => {
    let list = VIDEOS.filter((v) => {
      if (type !== "all" && v.type !== type) return false;
      if (cat !== "all" && v.category !== cat) return false;
      if (duration === "under15" && v.durationMin >= 15) return false;
      if (duration === "d15to30" && (v.durationMin < 15 || v.durationMin > 30)) return false;
      if (duration === "d30to60" && (v.durationMin < 30 || v.durationMin > 60)) return false;
      if (duration === "over60" && v.durationMin <= 60) return false;
      if (query) {
        const q = query.trim().toLowerCase();
        return v.title.fa.toLowerCase().includes(q) || v.title.en.toLowerCase().includes(q);
      }
      return true;
    });
    if (sort === "newest") list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    if (sort === "popular" || sort === "views") list.sort((a, b) => b.viewsK - a.viewsK);
    if (sort === "alpha") list.sort((a, b) => (a.title[lang] || a.title.en).localeCompare(b.title[lang] || b.title.en, lang === "fa" ? "fa" : "en"));
    return list;
  }, [query, type, cat, sort, duration, lang]);

  React.useEffect(() => setLimit(GRID_STEP), [query, type, cat, sort, duration]);

  const banner = bySlug(BANNER_SLUG);
  const similar = VIDEOS.filter((v) => v.slug !== BANNER_SLUG && (v.category === banner.category || v.category === "ai")).slice(0, 8);

  return (
    <>
      <LibraryHeader />
      <FeaturedHero loading={loading} />

      {/* Trending */}
      <section className="lib-section lib-wrap" id="lib-trending" aria-label={t("trending.title")}>
        <div className="lib-sec-head">
          <h2 className="lib-sec-title">
            <TrendingUp size={20} /> {t("trending.title")}
          </h2>
          <span className="lib-sec-spacer" />
          <div className="lib-toplinks" role="tablist">
            {["popular", "new", "featured"].map((key) => (
              <button key={key} role="tab" aria-selected={trendFilter === key} className={trendFilter === key ? "is-active" : ""} onClick={() => setTrendFilter(key)}>
                {t(`trending.filters.${key}`)}
              </button>
            ))}
          </div>
        </div>
        <CategoryChips active={trendCat} onChange={setTrendCat} keys={TREND_CATS} />
        {trending.length === 0 && !loading ? (
          <div className="lib-empty">
            <ListVideo size={30} />
            <p>{t("library.emptyCategory")}</p>
          </div>
        ) : (
          <VideoCarousel videos={trending} loading={loading} ariaLabel={t("trending.title")} />
        )}
      </section>

      {/* Main library */}
      <section className="lib-section lib-wrap" id="lib-main" aria-label={t("library.title")} style={{ marginTop: 104 }}>
        <div className="lib-sec-head">
          <h2 className="lib-sec-title">
            <ListVideo size={20} /> {t("library.title")}
          </h2>
        </div>
        <div className="lib-search">
          <Search size={17} />
          <input id="lib-search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("library.searchPlaceholder")} aria-label={t("library.searchPlaceholder")} />
        </div>
        <div className="lib-chips" role="tablist" style={{ marginTop: 18 }}>
          {["all", ...TYPES].map((key) => (
            <button key={key} className={`lib-chip${type === key ? " is-active" : ""}`} role="tab" aria-selected={type === key} onClick={() => setType(key)}>
              {t(`types.${key}`)}
            </button>
          ))}
        </div>
        <div className="lib-controls-row">
          <CategoryChips active={cat} onChange={setCat} keys={ALL_CATS} />
        </div>
        <div className="lib-controls-row">
          <span className="lib-sorts">
            <select className="lib-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("sort.newest")}>
              {["newest", "popular", "views", "alpha"].map((key) => (
                <option key={key} value={key}>
                  {t(`sort.${key}`)}
                </option>
              ))}
            </select>
            <select className="lib-select" value={duration} onChange={(e) => setDuration(e.target.value)} aria-label={t("sort.allDurations")}>
              <option value="all">{t("sort.allDurations")}</option>
              {["under15", "d15to30", "d30to60", "over60"].map((key) => (
                <option key={key} value={key}>
                  {t(`sort.${key}`)}
                </option>
              ))}
            </select>
          </span>
        </div>
        {loading ? (
          <div className="lib-grid">
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="lib-empty">
            <Search size={30} />
            <p>{query ? t("library.emptySearch") : t("library.emptyCategory")}</p>
          </div>
        ) : (
          <>
            <div className="lib-grid">
              {filtered.slice(0, limit).map((video) => (
                <VideoCard key={video.slug} video={video} />
              ))}
            </div>
            {filtered.length > limit ? (
              <div className="lib-loadmore">
                <button className="lib-btn is-ghost" onClick={() => setLimit((n) => n + GRID_STEP)}>
                  {t("library.loadMore")}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Secondary banner */}
      <div className="lib-wrap">
        <FeaturedBanner video={banner} />
      </div>

      {/* Similar */}
      <section className="lib-section is-tight lib-wrap" aria-label={t("similar.title")} style={{ paddingBottom: 90 }}>
        <div className="lib-sec-head">
          <h2 className="lib-sec-title">
            <Sparkles size={19} /> {t("similar.title")}
          </h2>
        </div>
        <VideoCarousel videos={similar} loading={loading} ariaLabel={t("similar.title")} />
      </section>
    </>
  );
}

function FeaturedBanner({ video }) {
  const { t, lang, title, desc, catName, saved, toggleSave } = useLib();
  const [tab, setTab] = React.useState("overview");
  const isSaved = saved.includes(video.slug);
  const durationSec = video.durationMin * 60;
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const similarTitles = VIDEOS.filter((v) => v.slug !== video.slug && v.category === video.category).slice(0, 3);
  return (
    <section className="lib-banner" aria-label={title(video)}>
      <div className="lib-banner-media" style={{ backgroundImage: `url(${BASE()}${BANNER_IMAGE})` }} />
      <div className="lib-banner-shade" />
      <div className="lib-banner-in">
        <div className="lib-banner-box">
          <p className="lib-hero-label">{t("hero.label")}</p>
          <h2 className="lib-banner-title">{title(video)}</h2>
          <div className="lib-hero-meta">
            <span>{catName(video.category)}</span>
            <span>·</span>
            <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
            <span>·</span>
            <span>{t(`access.${video.access}`)}</span>
          </div>
          <div className="lib-hero-cta">
            <a className="lib-btn is-primary" href={`#/watch/${video.slug}`}>
              <Play size={16} /> {t("hero.watch")}
            </a>
            <button className="lib-btn is-ghost" onClick={() => toggleSave(video.slug)}>
              <Bookmark size={16} fill={isSaved ? "#fff" : "none"} /> {t(isSaved ? "hero.saved" : "hero.save")}
            </button>
          </div>
          <div className="lib-banner-tabs" role="tablist">
            {["overview", "chapters", "similar"].map((key) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "is-active" : ""} onClick={() => setTab(key)}>
                {t(`banner.tabs.${key}`)}
              </button>
            ))}
          </div>
          <div className="lib-banner-panel">
            {tab === "overview" ? <p>{desc(video)}</p> : null}
            {tab === "chapters"
              ? CHAPTERS.map((ch) => (
                  <div className="lib-chaprow" key={ch.en}>
                    <span className="lib-ts" dir="ltr">
                      {clock(Math.round(durationSec * ch.frac))}
                    </span>
                    <span>{lang === "fa" ? ch.fa : ch.en}</span>
                  </div>
                ))
              : null}
            {tab === "similar"
              ? similarTitles.map((v) => (
                  <div className="lib-chaprow" key={v.slug}>
                    <Play size={12} />
                    <a href={`#/watch/${v.slug}`} style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>
                      {title(v)}
                    </a>
                  </div>
                ))
              : null}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Watch page (#/watch/:slug)
// ---------------------------------------------------------------------------

function WatchPageInner() {
  const { t, lang, rtl, viewer, title, desc, catName, saved, toggleSave } = useLib();
  const slug = window.location.hash.replace(/^#\/watch\//, "").split("?")[0];
  const video = bySlug(slug);
  const [playing, setPlaying] = React.useState(false);
  React.useEffect(() => {
    window.scrollTo(0, 0);
    setPlaying(false);
  }, [slug]);

  if (!video) {
    window.location.replace("#/library");
    return null;
  }

  const canWatchFull = video.access === "free" || viewer === "subscriber";
  const canPreview = canWatchFull || video.access === "preview";
  const isSaved = saved.includes(video.slug);
  const durationSec = video.durationMin * 60;
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const similar = VIDEOS.filter((v) => v.slug !== video.slug && v.category === video.category)
    .concat(VIDEOS.filter((v) => v.slug !== video.slug && v.category !== video.category))
    .slice(0, 8);
  const gateCta = viewer === "guest" ? { label: t("watch.guestCta"), href: `#/login?redirect=/watch/${video.slug}` } : { label: t("watch.memberCta"), href: "#/dashboard/subscription" };
  const gateMsg = viewer === "guest" ? t("watch.guestGate") : t("watch.memberGate");
  const Icon = CAT_ICONS[video.category] || Sparkles;

  return (
    <>
      <LibraryHeader />
      <div className="lib-wrap lib-watch">
        <a className="lib-back" href="#/library">
          {rtl ? <ArrowRight size={14} /> : <ArrowLeft size={14} />} {t("watch.back")}
        </a>

        <div className="lib-player">
          <div className="lib-player-center" style={{ opacity: 0.14 }}>
            <Icon size={140} strokeWidth={0.9} color="#fff" />
          </div>
          {!canPreview && !playing ? null : null}
          {playing ? (
            <div className="lib-player-center">
              <span className="lib-pillbadge">{t("watch.playing")}</span>
            </div>
          ) : canPreview ? (
            <div className="lib-player-center">
              <button className="lib-playbtn" onClick={() => setPlaying(true)} aria-label={canWatchFull ? t("hero.watch") : t("watch.playPreview")}>
                <Play size={28} style={{ marginInlineStart: 3 }} />
              </button>
            </div>
          ) : null}
          {!canWatchFull && !canPreview ? (
            <div className="lib-gate">
              <Lock size={30} />
              <p>{gateMsg}</p>
              <a className="lib-btn is-primary" href={gateCta.href}>
                {gateCta.label}
              </a>
            </div>
          ) : null}
        </div>
        {canPreview && !canWatchFull ? (
          <div className="lib-note">
            {t("watch.previewNote")}{" "}
            <a href={gateCta.href} style={{ color: "#fff", textDecoration: "underline", textUnderlineOffset: 3 }}>
              {gateCta.label}
            </a>
          </div>
        ) : null}

        <div className="lib-watch-head">
          <div style={{ flex: 1, minWidth: 240 }}>
            <h1 className="lib-watch-title">{title(video)}</h1>
            <div className="lib-watch-meta">
              <span>{catName(video.category)}</span>
              <span>·</span>
              <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
              <span>·</span>
              <span className="lib-pillbadge">{t(`access.${video.access}`)}</span>
            </div>
          </div>
          <button className="lib-btn is-ghost" onClick={() => toggleSave(video.slug)}>
            <Bookmark size={16} fill={isSaved ? "#fff" : "none"} /> {t(isSaved ? "hero.saved" : "hero.save")}
          </button>
        </div>

        <div className="lib-watch-cols">
          <div>
            <h3 style={{ fontSize: 15, fontWeight: 750, marginBottom: 10 }}>{t("watch.about")}</h3>
            <p className="lib-watch-desc">{desc(video)}</p>
          </div>
          <div style={{ display: "grid", gap: 14 }}>
            <div className="lib-side-card">
              <h3>{t("watch.chapters")}</h3>
              {CHAPTERS.map((ch) => (
                <div className="lib-inc" key={ch.en}>
                  <span className="lib-ts" dir="ltr">
                    {clock(Math.round(durationSec * ch.frac))}
                  </span>
                  <span>{lang === "fa" ? ch.fa : ch.en}</span>
                </div>
              ))}
            </div>
            <div className="lib-side-card">
              <h3>{t("watch.includes")}</h3>
              <div className="lib-inc">
                <FileText size={15} /> {t("watch.subtitles")}
              </div>
              <div className="lib-inc">
                <FileText size={15} /> {t("watch.transcript")}
              </div>
              <div className="lib-inc">
                <Sparkles size={15} /> {t("watch.summary")}
              </div>
            </div>
          </div>
        </div>

        <section className="lib-section is-tight" aria-label={t("similar.title")}>
          <div className="lib-sec-head">
            <h2 className="lib-sec-title">
              <Sparkles size={19} /> {t("similar.title")}
            </h2>
          </div>
          <VideoCarousel videos={similar} loading={false} ariaLabel={t("similar.title")} />
        </section>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function LibraryPage() {
  return (
    <LibraryProvider>
      <LibraryPageInner />
    </LibraryProvider>
  );
}

export function WatchPage() {
  return (
    <LibraryProvider>
      <WatchPageInner />
    </LibraryProvider>
  );
}
