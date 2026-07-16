// Vidora Library — public monochrome content-discovery page (#/library), the
// dedicated watch route (#/watch/:slug), and the search route (#/search?q=).
// Main page flow: Hero → Browse by Category → Trending → New on Vidora →
// Continue Watching → Footer. All Videos is a dedicated #/library/all view.
// Search lives only in the header (expanding input + live results overlay).
// Strictly black / white / neutral gray. All copy lives in
// src/locales/{en,fa}/library.json; language follows the site-wide selector.
import React from "react";
import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Bookmark,
  BrainCircuit,
  Building2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Code2,
  Cpu,
  FileText,
  FlaskConical,
  Folder,
  Globe2,
  Headphones,
  Languages,
  LayoutGrid,
  LayoutDashboard,
  ListVideo,
  Lock,
  LogOut,
  Menu as MenuIcon,
  Package,
  Play,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  User,
  X,
} from "lucide-react";
import enDict from "./locales/en/library.json";
import faDict from "./locales/fa/library.json";
import { getCachedSession, getDisplayName, getUserEmail, restoreAuthSession, signOut as signOutUser, subscribeAuthState } from "./lib/auth";
import { loginHashFor } from "./lib/return-to";

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
// Viewer state is derived from the real Supabase session. Subscription checks
// must remain server-side in the payment phase; the public library stays
// browsable for guests, but premium playback is gated after open.
// ---------------------------------------------------------------------------

function readRecentSearches() {
  try {
    return JSON.parse(window.localStorage.getItem("vidora-recent-searches") || "[]");
  } catch (e) {
    return [];
  }
}

function pushRecentSearch(q) {
  const trimmed = q.trim();
  if (!trimmed) return readRecentSearches();
  const next = [trimmed, ...readRecentSearches().filter((item) => item !== trimmed)].slice(0, 5);
  try {
    window.localStorage.setItem("vidora-recent-searches", JSON.stringify(next));
  } catch (e) {/* ignore */}
  return next;
}

// ---------------------------------------------------------------------------
// Curated public seed content until a library CMS/API is connected.
// ---------------------------------------------------------------------------

const CAT_ICONS = {
  ai: BrainCircuit,
  startups: Rocket,
  tech: Cpu,
  product: Package,
  companies: Building2,
  founders: User,
  science: FlaskConical,
  language: Languages,
};

// rotating monochrome thumbnail gradients (kept dark & calm)
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
  V("startup-pricing", "استراتژی قیمت‌گذاری برای استارتاپ‌ها", "Pricing Strategy for Startups", "startups", "course", 42, 71, "subscription", "2026-07-05", { progress: 62 }),
  V("founder-paths", "مسیر رشد بنیان‌گذاران", "The Founder's Growth Path", "founders", "biography", 47, 38, "preview", "2026-06-30"),
  V("product-builders", "درس‌هایی از سازندگان محصول", "Lessons from Product Builders", "product", "interview", 33, 27, "free", "2026-06-26"),
  V("ai-economics", "اقتصاد هوش مصنوعی", "The Economics of AI", "ai", "documentary", 29, 44, "subscription", "2026-06-24"),
  V("successful-products", "چگونه محصولات موفق ساخته می‌شوند", "How Successful Products Are Made", "product", "course", 36, 52, "free", "2026-06-22"),
  V("future-of-work", "آینده بازار کار", "The Future of Work", "startups", "documentary", 31, 76, "preview", "2026-06-18"),
  V("entrepreneur-decisions", "زندگی و تصمیم‌های کارآفرینان بزرگ", "Decisions of Great Entrepreneurs", "founders", "biography", 58, 41, "subscription", "2026-06-15"),
  V("english-with-video", "یادگیری زبان با ویدیوهای واقعی", "Learning Languages with Real Videos", "language", "course", 22, 33, "free", "2026-06-12"),
  V("tech-trends", "روندهای فناوری ۲۰۲۶", "Tech Trends 2026", "tech", "news", 27, 58, "preview", "2026-06-10"),
  V("world-economy", "مرور اقتصاد جهان", "World Economy Brief", "startups", "news", 18, 21, "free", "2026-06-08"),
  V("design-thinking", "تفکر طراحی در عمل", "Design Thinking in Practice", "product", "course", 40, 30, "subscription", "2026-06-05"),
  V("space-science", "علم فضا برای همه", "Space Science for Everyone", "science", "documentary", 44, 66, "preview", "2026-06-02", { progress: 15 }),
  V("bootstrapping", "رشد بدون سرمایه‌گذار", "Growing Without Investors", "startups", "interview", 35, 25, "free", "2026-05-28"),
  V("brand-story", "چگونه برند ساخته می‌شود", "How Brands Are Built", "startups", "course", 30, 19, "subscription", "2026-05-24"),
  V("ai-in-schools", "هوش مصنوعی در آموزش", "AI in Education", "ai", "news", 26, 35, "free", "2026-05-20"),
];

const HERO_SLUGS = ["future-of-ai", "sam-altman-talk", "building-giants"];
const EDITORS_PICK_SLUG = "openai-history";
const TOPICS = ["ai", "startups", "tech", "product", "companies", "founders", "science", "language"];
const BROWSE_TOPICS = ["ai", "product", "language", "business"];
const TYPES = ["course", "interview", "documentary", "news", "biography"];
const NEWEST = [...VIDEOS].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5);

const bySlug = (slug) => VIDEOS.find((v) => v.slug === slug);
const toneOf = (video) => TONES[VIDEOS.indexOf(video) % TONES.length];

const BASE = () => import.meta.env.BASE_URL;
const HERO_MEDIA = {
  "future-of-ai": { src: "uploads/vidora_learning_woman_photo.jpg", position: "center 44%", flip: true },
  "sam-altman-talk": { src: "uploads/vidora_hero_walking_man_background_1600x850.png", position: "center", flip: true },
  "building-giants": { src: "uploads/vidora_hero_man_photo.png", position: "center top", flip: true },
};
const BANNER_IMAGE = "uploads/IMG_0766.JPG";

const LIBRARY_GROUPS = [
  { key: "ai", categories: ["ai", "tech", "science"], icon: BrainCircuit, image: "uploads/1.png" },
  { key: "product", categories: ["product", "companies"], icon: Code2, image: "uploads/Screenshot 2026-07-06 at 10.54.39.png" },
  { key: "language", categories: ["language"], icon: Languages, image: "uploads/vidora_learning_woman_photo.jpg" },
  { key: "business", categories: ["startups", "founders"], icon: BarChart3, image: "uploads/vidora_hero_walking_man_background_1600x850.png" },
];

const VIDEO_VISUALS = [
  "uploads/1.png",
  "uploads/vidora_learning_woman_photo.jpg",
  "uploads/vidora_hero_man_photo.png",
  "uploads/Screenshot 2026-07-06 at 10.54.39.png",
  "uploads/vidora_hero_walking_man_background_1600x850.png",
  "uploads/IMG_0765.JPG",
];

const groupFor = (key) => LIBRARY_GROUPS.find((group) => group.key === key);
const matchesTopic = (video, key) => key === "all" || (groupFor(key)?.categories || [key]).includes(video.category);
const imageOf = (video) => VIDEO_VISUALS[Math.max(0, VIDEOS.indexOf(video)) % VIDEO_VISUALS.length];

const GENERIC_DESC = {
  fa: "در این ویدیوی آموزشی، مفاهیم کلیدی با زیرنویس فارسی، خلاصه هوشمند و نکات کاربردی ارائه می‌شود.",
  en: "In this learning video, the key ideas come with Persian subtitles, a smart summary, and practical takeaways.",
};

const CHAPTERS = [
  { frac: 0.04, fa: "شروع و معرفی", en: "Introduction" },
  { frac: 0.38, fa: "ایده‌های اصلی", en: "Core ideas" },
  { frac: 0.74, fa: "جمع‌بندی و قدم بعدی", en: "Wrap-up & next steps" },
];

function searchVideos(query) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return VIDEOS.filter((v) => v.title.fa.toLowerCase().includes(q) || v.title.en.toLowerCase().includes(q));
}

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
.lib-head{position:sticky;top:0;z-index:60;background:rgba(8,8,10,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.lib-head-in{height:64px;display:flex;align-items:center;gap:22px;position:relative}
.lib-logo{display:flex;align-items:center;flex:none}
.lib-logo img{height:20px;width:auto;display:block}
.lib-logo span{font-weight:800;letter-spacing:.16em;font-size:16px;color:#fff}
.lib-nav{display:flex;gap:4px;margin-inline:auto}
.lib-nav button{height:34px;padding-inline:14px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--mut)}
.lib-nav button:hover{color:#fff}
.lib-head-actions{display:flex;align-items:center;gap:10px;flex:none;margin-inline-start:auto}
.lib-iconbtn{width:36px;height:36px;border-radius:999px;display:grid;place-items:center;color:#d6d6dd}
.lib-iconbtn:hover{background:var(--s2)}
.lib-login{height:36px;padding-inline:16px;border-radius:999px;background:#fff;color:#000;font-weight:700;font-size:13px;display:inline-flex;align-items:center}
.lib-avatarbtn{width:34px;height:34px;border-radius:999px;background:var(--s3);border:1px solid var(--line2);display:grid;place-items:center;color:#fff}
.lib-burger{display:none}

/* header search */
.lib-hsearch{flex:1;display:flex;align-items:center;gap:11px;height:42px;border:1px solid var(--line2);border-radius:999px;background:var(--s1);padding-inline:16px;min-width:0}
.lib-hsearch:focus-within{border-color:rgba(255,255,255,.45)}
.lib-hsearch input{flex:1;min-width:0;background:none;border:0;outline:none;font-size:14px;color:#fff}
.lib-hsearch input::placeholder{color:var(--mut2)}
.lib-hsearch svg{color:var(--mut);flex:none}
.lib-search-close{height:34px;padding-inline:14px;border-radius:999px;font-size:13px;font-weight:650;color:var(--mut);flex:none}
.lib-search-close:hover{color:#fff}
.lib-search-panel{position:absolute;top:calc(100% + 8px);inset-inline-start:0;inset-inline-end:0;margin-inline:auto;width:min(720px,100%);background:var(--s1);border:1px solid var(--line2);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.55);padding:10px;z-index:65;max-height:70vh;overflow-y:auto}
.lib-sp-label{font-size:11px;font-weight:750;letter-spacing:.06em;color:var(--mut2);text-transform:uppercase;padding:8px 10px 4px;display:flex;justify-content:space-between;align-items:center}
.lib-sp-label button{font-size:11px;color:var(--mut);text-transform:none;letter-spacing:0}
.lib-sp-label button:hover{color:#fff}
.lib-sr{display:flex;align-items:center;gap:12px;padding:9px 10px;border-radius:11px;width:100%}
.lib-sr:hover,.lib-sr.is-active{background:var(--s2)}
.lib-sr-thumb{width:58px;height:38px;border-radius:8px;flex:none;display:grid;place-items:center;overflow:hidden}
.lib-sr-thumb svg{opacity:.3;color:#fff}
.lib-sr-title{font-size:13.5px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lib-sr-meta{font-size:11.5px;color:var(--mut);margin-top:2px;display:flex;gap:6px;align-items:center}
.lib-sr-badge{margin-inline-start:auto;flex:none;height:22px;padding-inline:8px;border-radius:999px;border:1px solid rgba(255,255,255,.28);font-size:10px;font-weight:700;display:inline-flex;align-items:center;color:var(--mut)}
.lib-sp-empty{padding:22px 10px;text-align:center;color:var(--mut);font-size:13px}

/* drawer */
.lib-drawer-veil{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:70}
.lib-drawer{position:fixed;top:0;bottom:0;inset-inline-start:0;width:270px;background:var(--s1);border-inline-end:1px solid var(--line);z-index:75;padding:20px;display:none;flex-direction:column;gap:4px}
.lib-drawer.is-open{display:flex}
.lib-drawer button{height:44px;border-radius:11px;padding-inline:13px;text-align:start;font-weight:650;font-size:14.5px;color:var(--mut);display:flex;align-items:center;gap:10px}
.lib-drawer button:hover{background:var(--s2);color:#fff}

/* buttons */
.lib-btn{height:44px;border-radius:10px;padding-inline:22px;font-size:14px;font-weight:750;display:inline-flex;align-items:center;justify-content:center;gap:9px;white-space:nowrap}
.lib-btn.is-primary{background:#fff;color:#000}
.lib-btn.is-primary:hover{background:#e4e4e8}
.lib-btn.is-ghost{background:rgba(255,255,255,.08);border:1px solid var(--line2);color:#fff}
.lib-btn.is-ghost:hover{background:rgba(255,255,255,.14)}
.lib-btn.is-sm{height:34px;padding-inline:13px;font-size:12.5px;border-radius:9px}

/* hero */
.lib-hero{position:relative;overflow:hidden;border-bottom:1px solid var(--line)}
.lib-hero-media{position:absolute;inset:0;background-size:cover;background-position:center;filter:grayscale(1);transition:opacity .5s ease;z-index:0}
.lib-hero-media.is-current{z-index:1}
.lib-hero-media.is-revealing{animation:lib-hero-reveal 1.15s cubic-bezier(.22,.8,.24,1) both}
.lib-hero-glass-wave{position:absolute;z-index:2;top:50%;left:50%;width:22%;aspect-ratio:1;border-radius:50%;border:1px solid rgba(255,255,255,.42);box-shadow:inset 0 0 28px rgba(255,255,255,.16),0 0 40px rgba(255,255,255,.12);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);pointer-events:none;animation:lib-glass-wave 1.15s cubic-bezier(.22,.8,.24,1) both}
.lib-hero-shade{position:absolute;inset:0;z-index:3;background:linear-gradient(90deg,rgba(8,8,10,.94) 0%,rgba(8,8,10,.72) 34%,rgba(8,8,10,.28) 62%,rgba(8,8,10,.55) 100%)}
[dir="rtl"] .lib-hero-shade{background:linear-gradient(270deg,rgba(8,8,10,.94) 0%,rgba(8,8,10,.72) 34%,rgba(8,8,10,.28) 62%,rgba(8,8,10,.55) 100%)}
.lib-hero-shade::after{content:"";position:absolute;inset-inline:0;bottom:0;height:34%;background:linear-gradient(180deg,transparent,rgba(8,8,10,.9))}
.lib-hero-in{position:relative;z-index:4;min-height:clamp(420px,56vh,600px);display:flex;align-items:center;padding-block:64px}
.lib-hero-box{max-width:41%;display:grid;gap:16px}
.lib-hero-box.is-revealing{animation:lib-hero-content-in .8s cubic-bezier(.22,.8,.24,1) both}
.lib-hero-label{font-size:12px;font-weight:750;letter-spacing:.08em;color:var(--mut);text-transform:uppercase}
.lib-hero-title{font-size:clamp(30px,3.4vw,50px);font-weight:800;line-height:1.16;letter-spacing:-.01em}
.lib-hero-desc{color:#cfcfd6;font-size:15px;line-height:1.85;max-width:52ch}
.lib-hero-meta{display:flex;align-items:center;gap:9px;color:var(--mut);font-size:13px;font-weight:600;flex-wrap:wrap}
.lib-hero-cta{display:flex;gap:11px;margin-top:6px}
.lib-hero-counter{position:absolute;z-index:5;top:20px;left:22px;direction:ltr;display:flex;align-items:baseline;gap:6px;padding:7px 9px;border:1px solid rgba(255,255,255,.24);border-radius:8px;background:rgba(0,0,0,.28);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;letter-spacing:.08em;text-shadow:0 1px 12px rgba(0,0,0,.45)}
.lib-hero-counter strong{font-size:17px;font-weight:650}.lib-hero-counter span{color:rgba(255,255,255,.58)}
.lib-hero-nav{position:absolute;z-index:5;bottom:17px;left:50%;width:min(520px,calc(100% - 190px));transform:translateX(-50%);display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.lib-hero-nav-item{min-width:0;display:grid;gap:6px;color:rgba(255,255,255,.58);text-align:start}
.lib-hero-nav-item:hover,.lib-hero-nav-item.is-active{color:#fff}
.lib-hero-nav-track{display:block;height:2px;background:rgba(255,255,255,.24);overflow:hidden}
.lib-hero-nav-fill{display:block;width:0;height:100%;background:#d4af37}
.lib-hero-nav-item.is-active .lib-hero-nav-fill{animation:lib-hero-progress 6s linear forwards}
.lib-hero-nav-label{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px;font-weight:650;letter-spacing:0}
@keyframes lib-hero-reveal{0%{clip-path:circle(0 at 50% 50%);filter:grayscale(1) blur(8px)}100%{clip-path:circle(145% at 50% 50%);filter:grayscale(1) blur(0)}}
@keyframes lib-glass-wave{0%{transform:translate(-50%,-50%) scale(.08);opacity:0}18%{opacity:.9}100%{transform:translate(-50%,-50%) scale(7);opacity:0}}
@keyframes lib-hero-content-in{0%{opacity:0;transform:translateY(18px);filter:blur(7px)}100%{opacity:1;transform:translateY(0);filter:blur(0)}}
@keyframes lib-hero-progress{from{width:0}to{width:100%}}

/* sections */
.lib-section{margin-top:96px}
.lib-section.is-first{margin-top:72px}
.lib-sec-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.lib-sec-title{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:800;letter-spacing:-.01em}
.lib-sec-title svg{color:var(--mut)}
.lib-sec-spacer{flex:1}
.lib-toplinks{display:flex;gap:4px}
.lib-toplinks button{height:32px;padding-inline:13px;border-radius:999px;font-size:12.5px;font-weight:650;color:var(--mut);display:inline-flex;align-items:center;gap:7px}
.lib-toplinks button:hover{color:#fff}
.lib-toplinks button.is-active{background:#fff;color:#000}

/* chips */
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
.lib-arrow.is-only{left:-19px;right:auto}

/* standard card */
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

/* continue watching */
.lib-cw-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-top:24px}
.lib-cw-card{display:flex;gap:13px;align-items:center;border:1px solid var(--line);border-radius:13px;background:var(--s1);padding:13px;min-width:0}
.lib-cw-card:hover{border-color:rgba(255,255,255,.28);background:var(--s2)}
.lib-cw-thumb{width:84px;height:56px;border-radius:9px;flex:none;display:grid;place-items:center;position:relative;overflow:hidden}
.lib-cw-thumb svg{opacity:.28;color:#fff}
.lib-cw-body{flex:1;min-width:0;display:grid;gap:7px}
.lib-cw-title{font-size:13px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lib-cw-meter{height:4px;border-radius:999px;background:rgba(255,255,255,.14);overflow:hidden}
.lib-cw-meter>span{display:block;height:100%;background:#fff;border-radius:inherit}
.lib-cw-sub{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11.5px;color:var(--mut)}
.lib-cw-resume{font-weight:750;color:#fff;display:inline-flex;align-items:center;gap:5px}

/* browse by category */
.lib-cats{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:14px;margin-top:26px}
.lib-cat-card{border:1px solid var(--line);border-radius:14px;background:var(--s1);padding:20px 16px;display:grid;gap:12px;justify-items:center;text-align:center;min-width:0}
.lib-cat-card:hover{border-color:rgba(255,255,255,.32);background:var(--s2)}
.lib-cat-icon{width:46px;height:46px;border-radius:999px;background:var(--s3);border:1px solid var(--line2);display:grid;place-items:center;color:#e6e6ec}
.lib-cat-name{font-size:13px;font-weight:750;line-height:1.5}
.lib-cat-count{font-size:11.5px;color:var(--mut2)}

/* editor's pick (compact banner) */
.lib-banner{position:relative;border-radius:18px;overflow:hidden;border:1px solid var(--line)}
.lib-banner-media{position:absolute;inset:0;background-size:cover;background-position:center 30%;filter:grayscale(1)}
.lib-banner-shade{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,10,.95) 0%,rgba(8,8,10,.7) 42%,rgba(8,8,10,.3) 100%)}
[dir="rtl"] .lib-banner-shade{background:linear-gradient(270deg,rgba(8,8,10,.95) 0%,rgba(8,8,10,.7) 42%,rgba(8,8,10,.3) 100%)}
.lib-banner-in{position:relative;padding:38px clamp(24px,4vw,52px);min-height:264px;display:flex;flex-direction:column;justify-content:center}
.lib-banner-box{max-width:48%;display:grid;gap:12px}
.lib-banner-title{font-size:clamp(22px,2.4vw,32px);font-weight:800;letter-spacing:-.01em;line-height:1.25}
.lib-banner-desc{color:#cfcfd6;font-size:13.5px;line-height:1.8;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* controls + grid */
.lib-select{height:36px;border-radius:9px;border:1px solid var(--line2);background:var(--s1);color:#d6d6dd;padding-inline:10px;font-size:12.5px;font-weight:600;outline:none}
.lib-select:focus{border-color:rgba(255,255,255,.4)}
.lib-controls-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:16px}
.lib-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:26px 16px;margin-top:30px}
.lib-loadmore{display:grid;place-items:center;margin-top:36px}
.lib-empty{display:grid;place-items:center;text-align:center;gap:6px;padding:70px 20px;border:1px dashed var(--line);border-radius:14px;margin-top:30px}
.lib-empty svg{color:var(--mut2);margin-bottom:6px}
.lib-empty p{color:var(--mut);font-size:14px}

/* skeletons */
.lib-skel{background:linear-gradient(100deg,var(--s2) 40%,var(--s3) 50%,var(--s2) 60%);background-size:200% 100%;animation:libshimmer 1.4s infinite linear;border-radius:12px}
@keyframes libshimmer{to{background-position:-200% 0}}
.lib-skel-line{height:13px;border-radius:6px}

/* toast */
.lib-toasts{position:fixed;bottom:22px;inset-inline-end:22px;display:grid;gap:8px;z-index:90}
.lib-toast{background:#fff;color:#000;border-radius:11px;padding:11px 15px;font-size:13px;font-weight:700;box-shadow:0 16px 40px rgba(0,0,0,.45);max-width:320px}

/* footer */
.lib-footer{margin-top:104px;border-top:1px solid var(--line);padding-block:34px 44px}
.lib-footer-in{display:flex;align-items:center;gap:22px;flex-wrap:wrap}
.lib-footer-links{display:flex;gap:18px;margin-inline:auto}
.lib-footer-links button{font-size:13px;color:var(--mut);font-weight:600}
.lib-footer-links button:hover{color:#fff}
.lib-footer-rights{font-size:12px;color:var(--mut2)}

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
.lib-ts{color:#fff;font-weight:750;font-size:11.5px;font-variant-numeric:tabular-nums}

@media(prefers-reduced-motion:reduce){.lib-root *{transition:none!important;animation:none!important}}

/* responsive */
@media(max-width:1120px){
  .lib-row{grid-auto-columns:calc((100% - 32px)/3)}
  .lib-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
  .lib-hero-box{max-width:60%}
  .lib-banner-box{max-width:70%}
  .lib-watch-cols{grid-template-columns:1fr}
  .lib-cw-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lib-cats{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@media(max-width:760px){
  .lib-wrap{padding-inline:18px}
  .lib-nav,.lib-login{display:none}
  .lib-burger{display:grid}
  .lib-head-in{height:56px;gap:12px}
  .lib-search-panel{width:100%}
  .lib-row{grid-auto-columns:calc((100% - 12px)/1.9);gap:12px}
  .lib-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:20px 12px}
  .lib-hero-in{min-height:420px;align-items:flex-end;padding-block:40px 56px}
  .lib-hero-box{max-width:100%}
  .lib-section{margin-top:60px}
  .lib-banner-box{max-width:100%}
  .lib-banner-in{min-height:0;padding:26px 18px}
  .lib-arrow{display:none}
  .lib-cw-grid{grid-template-columns:1fr}
  .lib-cats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .lib-controls-row .lib-select{flex:1}
  .lib-toasts{inset-inline:14px;bottom:14px}
  .lib-footer-in{flex-direction:column;align-items:flex-start;gap:14px}
  .lib-footer-links{margin-inline:0}
}

/* Library redesign: scoped white editorial surface. Watch and search keep the
   original dark theme above. */
.lib-root.is-library{--bg:#fff;--s1:#fff;--s2:#f5f5f5;--s3:#ededed;--ink:#111;--mut:#666;--mut2:#8c8c8c;--line:#e4e4e4;--line2:#d5d5d5;background:#fff;color:#111}
.is-library .lib-wrap{max-width:1320px;padding-inline:46px}
.is-library .lib-head{position:relative;background:#fff;border:0;backdrop-filter:none;-webkit-backdrop-filter:none}
.is-library .lib-head-in{height:88px;gap:26px}
.is-library .lib-logo span{color:#111;font-size:22px;letter-spacing:.15em}
.is-library .lib-ref-nav{position:absolute;inset-inline:50%;transform:translateX(50%);display:flex;align-self:stretch;gap:38px;direction:rtl}
[dir="ltr"] .is-library .lib-ref-nav{transform:translateX(-50%);direction:ltr}
.is-library .lib-ref-nav button{position:relative;padding-inline:5px;color:#555;font-size:14px;font-weight:500;white-space:nowrap}
.is-library .lib-ref-nav button.is-active{color:#111;font-weight:700}
.is-library .lib-ref-nav button.is-active::after{content:"";position:absolute;inset-inline:0;bottom:21px;height:1.5px;background:#111}
.is-library .lib-head-actions{margin-inline-start:auto;gap:14px}
.is-library .lib-iconbtn{color:#111;border-radius:6px}
.is-library .lib-iconbtn:hover{background:#f4f4f4}
.is-library .lib-login{height:40px;border-radius:11px;background:#111;color:#fff;padding-inline:19px;font-size:12.5px}
.is-library .lib-avatarbtn{background:#111;color:#fff;border:0}
.is-library .lib-hsearch{background:#fff;border-color:#d6d6d6;color:#111}
.is-library .lib-hsearch input{color:#111}
.is-library .lib-search-close{color:#555}
.is-library .lib-search-panel{background:#fff;border-color:#ddd;box-shadow:0 18px 50px rgba(0,0,0,.12)}
.is-library .lib-sr:hover,.is-library .lib-sr.is-active{background:#f5f5f5}
.is-library .lib-sr-badge{border-color:#ddd;color:#555}
.is-library .lib-profile-trigger{display:inline-flex;align-items:center;gap:8px;min-width:0;max-width:190px}
.is-library .lib-profile-avatar{position:relative;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;overflow:hidden;flex:none;background:#111;color:#fff;border:1px solid rgba(0,0,0,.12);font-size:11px;font-weight:800}
.is-library .lib-profile-avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.is-library .lib-profile-name{max-width:104px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:750}
.is-library .lib-profile-trigger svg{flex:none;color:#666}
.lib-profile-scrim{position:fixed;inset:0;z-index:74;background:transparent}
.is-library .lib-profile-menu{position:fixed;z-index:75;top:68px;right:max(16px,calc((100vw - 1024px)/2 + 16px));width:286px;padding:9px;border:1px solid rgba(255,255,255,.74);border-radius:14px;background:rgba(250,250,250,.84);box-shadow:0 22px 60px rgba(0,0,0,.17),inset 0 1px 0 rgba(255,255,255,.82);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);color:#111}
.is-library .lib-profile-menu-head{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:11px;padding:9px 9px 13px;border-bottom:1px solid rgba(0,0,0,.09)}
.is-library .lib-profile-menu-head .lib-profile-avatar{width:42px;height:42px;font-size:14px}
.is-library .lib-profile-menu-head strong,.is-library .lib-profile-menu-head span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.is-library .lib-profile-menu-head strong{font-size:13px}.is-library .lib-profile-menu-head span{margin-top:3px;color:#717171;font-size:11px;direction:ltr;text-align:left}
.is-library .lib-profile-menu-actions{display:grid;gap:2px;padding-top:7px}
.is-library .lib-profile-menu-actions button{width:100%;height:39px;padding-inline:10px;border-radius:8px;display:flex;align-items:center;gap:10px;color:#292929;font-size:12px;font-weight:700}
.is-library .lib-profile-menu-actions button:hover,.is-library .lib-profile-menu-actions button:focus-visible{background:rgba(255,255,255,.78);outline:none}
.is-library .lib-profile-menu-actions button.is-danger{margin-top:5px;border-top:1px solid rgba(0,0,0,.08);border-radius:0 0 8px 8px;color:#6d2020}

.is-library .lib-hero-shell{padding-inline:46px;max-width:1320px;margin:0 auto}
.is-library .lib-hero{height:430px;border:0;border-radius:14px;background:#111}
.is-library .lib-hero-media{display:block;width:100%;height:100%;object-fit:cover;object-position:center;filter:grayscale(1);transform:none}
.is-library .lib-hero-media.is-flipped{transform:scaleX(-1)}
.lib-root.is-library[dir="rtl"] .lib-hero-shade{background:linear-gradient(90deg,transparent 14%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.62) 72%,rgba(0,0,0,.84) 100%)}
.lib-root.is-library[dir="ltr"] .lib-hero-shade{background:linear-gradient(270deg,transparent 14%,rgba(0,0,0,.12) 42%,rgba(0,0,0,.62) 72%,rgba(0,0,0,.84) 100%)}
.is-library .lib-hero-shade::after{display:none}
.is-library .lib-hero-in{height:100%;min-height:0;padding:52px 96px;align-items:center;justify-content:flex-start}
.is-library .lib-hero-box{max-width:46%;gap:14px;color:#fff}
.is-library .lib-hero-label{color:#ddd;text-transform:none;letter-spacing:0;font-size:13px}
.is-library .lib-hero-title{font-size:34px;letter-spacing:0;line-height:1.35}
.is-library .lib-hero-desc{font-size:14px;line-height:1.95;color:#f2f2f2}
.is-library .lib-hero-meta{color:#e5e5e5;font-size:12px}
.is-library .lib-hero-arrow{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border:1px solid rgba(255,255,255,.22);border-radius:50%;background:rgba(0,0,0,.42);color:#fff;display:grid;place-items:center;z-index:6}
.is-library .lib-hero-arrow.is-prev{inset-inline-start:16px}
.is-library .lib-hero-arrow.is-next{inset-inline-end:16px}
.is-library .lib-btn.is-primary{height:50px;border-radius:11px;background:#fff;color:#111;padding-inline:23px}
.is-library .lib-btn.is-primary:hover{background:#eee}

.is-library .lib-search-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:start;margin-top:32px;position:relative}
.is-library .lib-page-search{height:58px;border:1px solid #d9d9d9;border-radius:12px;display:flex;align-items:center;gap:12px;padding-inline:20px;background:#fff}
.is-library .lib-page-search input{border:0;outline:0;background:transparent;color:#111;min-width:0;flex:1;font-size:14px}
.is-library .lib-page-search>button{width:30px;height:30px;display:grid;place-items:center;border-radius:6px;flex:none}
.is-library .lib-page-search>button:hover{background:#f2f2f2}
.is-library .lib-page-search svg{color:#777;flex:none}
.is-library .lib-filter-btn{height:58px;min-width:132px;border:1px solid #d9d9d9;border-radius:12px;background:#fff;display:inline-flex;align-items:center;justify-content:center;gap:10px;font-size:13px;font-weight:700}
.is-library .lib-filter-btn:hover{border-color:#111}
.is-library .lib-filter-popover{position:absolute;top:68px;inset-inline-end:0;z-index:20;width:min(390px,100%);padding:16px;border:1px solid #ddd;border-radius:10px;background:#fff;box-shadow:0 18px 48px rgba(0,0,0,.12);display:grid;gap:12px}
.is-library .lib-filter-popover p{font-size:13px;font-weight:750}
.is-library .lib-filter-options{display:flex;gap:8px;flex-wrap:wrap}
.is-library .lib-filter-options button{height:34px;border:1px solid #ddd;border-radius:999px;padding-inline:13px;color:#555;font-size:12px}
.is-library .lib-filter-options button.is-active{background:#111;border-color:#111;color:#fff}

.is-library .lib-section{margin-top:58px}
.is-library .lib-sec-head{flex-wrap:nowrap}
.is-library .lib-sec-title{font-size:25px;letter-spacing:0;color:#111}
.is-library .lib-sec-title svg{display:none}
.is-library .lib-view-all{color:#111;font-size:12px;font-weight:700;white-space:nowrap}
.is-library .lib-view-all:hover{text-decoration:underline;text-underline-offset:4px}
.is-library .lib-view-all:focus-visible{outline:2px solid #111;outline-offset:5px;border-radius:2px}
.is-library .lib-cats{grid-template-columns:repeat(4,minmax(0,1fr));gap:26px;margin-top:24px}
.is-library .lib-cat-card{padding:0;display:block;border:1px solid #ddd;border-radius:10px;background:#fff;text-align:start;overflow:hidden}
.is-library .lib-cat-card:hover{background:#fff;border-color:#aaa}
.is-library .lib-cat-media{display:block;height:182px;position:relative;background:#eee}
.is-library .lib-cat-media img{width:100%;height:100%;display:block;object-fit:cover;filter:grayscale(1)}
.is-library .lib-cat-icon{position:absolute;inset-inline-start:18px;bottom:-24px;width:52px;height:52px;border-radius:10px;background:#fff;border:1px solid #ddd;color:#111}
.is-library .lib-cat-body{display:grid;gap:9px;padding:38px 20px 19px}
.is-library .lib-cat-name{font-size:15px;color:#111}
.is-library .lib-cat-desc{font-size:12.5px;color:#555;line-height:1.75;min-height:44px}
.is-library .lib-cat-count{display:flex;align-items:center;gap:7px;color:#555;font-size:11.5px;margin-top:4px}

.is-library .lib-media-tools{display:flex;align-items:center;gap:10px;margin-top:22px}
.is-library .lib-chips{margin-top:0;flex:1;justify-content:flex-start;gap:9px}
.is-library .lib-chip{height:38px;color:#444;border-color:#ddd;background:#fff;padding-inline:18px;font-weight:500}
.is-library .lib-chip:hover{border-color:#999}
.is-library .lib-chip.is-active{background:#111;border-color:#111;color:#fff}
.is-library .lib-select{height:40px;background:#fff;color:#111;border-color:#d7d7d7;border-radius:9px;min-width:150px}
.is-library .lib-carousel{margin-top:22px}
.is-library .lib-row{grid-auto-columns:calc((100% - 54px)/4);gap:18px;padding-block:0 4px}
.is-library .lib-card{gap:7px;color:#111}
.is-library .lib-card.is-landscape .lib-thumb{aspect-ratio:16/9;border:0;border-radius:8px;background:#eee}
.is-library .lib-thumb-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;filter:grayscale(1);transition:transform .3s ease}
.is-library .lib-card:hover .lib-thumb-image{transform:scale(1.025)}
.is-library .lib-card:hover .lib-thumb{box-shadow:none}
.is-library .lib-card.is-landscape .lib-thumb-shade{height:35%;background:rgba(0,0,0,.18)}
.is-library .lib-duration{position:absolute;bottom:7px;inset-inline-start:7px;padding:3px 6px;border-radius:4px;background:rgba(0,0,0,.78);color:#fff;font-size:10px;font-weight:700}
.is-library .lib-card-title{font-size:13px;line-height:1.55;min-height:0;color:#111}
.is-library .lib-card-meta{font-size:11.5px;color:#777;min-height:17px}
.is-library .lib-card-extra{display:none}
.is-library .lib-play-overlay{background:rgba(0,0,0,.18)}
.is-library .lib-play-circle{width:40px;height:40px}
.is-library .lib-arrow{top:44%;width:40px;height:40px;background:#fff;color:#111;border-color:#ddd}
.is-library .lib-arrow:hover{background:#f4f4f4}
.is-library .lib-arrow.is-only{left:-20px;right:auto}

.is-library .lib-cw-card{background:#fff;border-color:#ddd;color:#111}
.is-library .lib-cw-card:hover{background:#f7f7f7;border-color:#aaa}
.is-library .lib-cw-resume{color:#111}
.is-library .lib-cw-meter{background:#ddd}.is-library .lib-cw-meter>span{background:#111}
.is-library .lib-controls-row .lib-select{background:#fff;color:#111}
.is-library .lib-grid{grid-template-columns:repeat(4,minmax(0,1fr));gap:28px 18px}
.is-library .lib-btn.is-ghost{background:#fff;border-color:#ccc;color:#111}
.is-library .lib-all-page{padding-top:34px;padding-bottom:32px}
.is-library .lib-all-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:4px}
.is-library .lib-all-page-title{font-size:32px;line-height:1.35;letter-spacing:0;color:#111}
.is-library .lib-all-back{display:inline-flex;align-items:center;gap:7px;color:#555;font-size:12px;font-weight:700}
.is-library .lib-all-back:hover{color:#111}
.is-library .lib-all-back:focus-visible{outline:2px solid #111;outline-offset:5px;border-radius:2px}
.is-library .lib-all-content{margin-top:46px}
.is-library .lib-all-content.lib-section{margin-top:46px}

.is-library .lib-trust{margin-top:72px;background:#0d0d0f;color:#fff}
.is-library .lib-trust-in{min-height:158px;display:grid;grid-template-columns:repeat(3,1fr);align-items:center;padding-block:28px}
.is-library .lib-trust-item{display:grid;grid-template-columns:auto 1fr;gap:15px;align-items:start;padding-inline:38px}
.is-library .lib-trust-item+ .lib-trust-item{border-inline-start:1px solid #373737}
.is-library .lib-trust-item h3{font-size:15px;color:#fff}
.is-library .lib-trust-item p{font-size:12px;line-height:1.8;color:#aaa;margin-top:7px}
.is-library .lib-trust-item svg{margin-top:3px}
.is-library .lib-footer{margin-top:0;background:#0d0d0f;border-top:1px solid #303030;padding-block:24px 30px;color:#fff}
.is-library .lib-footer-in{display:grid;grid-template-columns:auto 1fr auto;gap:30px}
.is-library .lib-footer .lib-logo span{color:#fff;font-size:18px}
.is-library .lib-footer-links{margin:0;justify-content:center;gap:34px}
.is-library .lib-footer-links button{color:#ddd;font-size:12px}
.is-library .lib-footer-rights{color:#777;text-align:end}

@media(max-width:1000px){
  .is-library .lib-wrap,.is-library .lib-hero-shell{padding-inline:28px}
  .is-library .lib-hero-in{padding-inline:60px}.is-library .lib-hero-box{max-width:58%}
  .is-library .lib-cats{grid-template-columns:repeat(2,minmax(0,1fr))}
  .is-library .lib-row{grid-auto-columns:calc((100% - 18px)/2)}
  .is-library .lib-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .is-library .lib-trust-item{padding-inline:22px}
}
@media(max-width:760px){
  .is-library .lib-wrap,.is-library .lib-hero-shell{padding-inline:16px}
  .is-library .lib-head-in{height:66px}.is-library .lib-logo span{font-size:18px}
  .is-library .lib-ref-nav,.is-library .lib-login{display:none}
  .is-library .lib-burger{display:grid}.is-library .lib-head-actions{gap:5px}
  .is-library .lib-hero{height:470px;border-radius:10px}
  .is-library .lib-hero-shade{background:linear-gradient(0deg,rgba(0,0,0,.72) 0%,rgba(0,0,0,.34) 58%,rgba(0,0,0,.08) 100%)}
  .is-library .lib-hero-in{align-items:flex-end;padding:32px 24px 72px}
  .is-library .lib-hero-box{max-width:100%;gap:11px}
  .is-library .lib-hero-title{font-size:26px}.is-library .lib-hero-desc{font-size:13px;line-height:1.8}
  .is-library .lib-hero-arrow{width:38px;height:38px;top:34%}
  .is-library .lib-hero-counter{top:16px;left:16px}.is-library .lib-hero-nav{bottom:16px;width:calc(100% - 32px);gap:8px}.is-library .lib-hero-nav-label{display:none}
  .is-library .lib-profile-menu{top:66px;left:16px;right:16px;width:auto}
  .is-library .lib-search-row{grid-template-columns:1fr auto;gap:10px;margin-top:20px}
  .is-library .lib-page-search{height:52px;padding-inline:14px}.is-library .lib-filter-btn{height:52px;min-width:52px;font-size:0}
  .is-library .lib-section{margin-top:48px}.is-library .lib-sec-title{font-size:21px}
  .is-library .lib-cats{grid-template-columns:1fr;gap:16px}.is-library .lib-cat-media{height:168px}
  .is-library .lib-media-tools{align-items:stretch;flex-direction:column-reverse}
  .is-library .lib-chips{width:100%;justify-content:flex-start}.is-library .lib-select{width:100%}
  .is-library .lib-row{grid-auto-columns:84%;gap:13px}
  .is-library .lib-arrow{display:none}
  .is-library .lib-trust-in{grid-template-columns:1fr;padding-block:12px}
  .is-library .lib-trust-item{padding:24px 10px}.is-library .lib-trust-item+ .lib-trust-item{border-inline-start:0;border-top:1px solid #303030}
  .is-library .lib-footer-in{grid-template-columns:1fr;justify-items:start}.is-library .lib-footer-links{justify-content:flex-start;gap:18px;flex-wrap:wrap}.is-library .lib-footer-rights{text-align:start}
  .is-library .lib-all-page{padding-top:26px}.is-library .lib-all-page-head{align-items:flex-start;flex-direction:column-reverse;gap:12px}.is-library .lib-all-page-title{font-size:27px}
  .is-library .lib-all-content,.is-library .lib-all-content.lib-section{margin-top:34px}
}
`;

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

const Ctx = React.createContext(null);
const useLib = () => React.useContext(Ctx);

function LibraryProvider({ children, surface = "default" }) {
  const { lang } = window.useLang();
  const rtl = lang === "fa";
  const t = React.useMemo(() => makeT(lang), [lang]);
  const [session, setSession] = React.useState(getCachedSession);
  const [toasts, setToasts] = React.useState([]);

  React.useEffect(() => {
    let alive = true;
    restoreAuthSession().then((activeSession) => {
      if (alive) setSession(activeSession);
    });
    const unsubscribe = subscribeAuthState(setSession);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const showToast = React.useCallback((msg) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((list) => [...list, { id, msg }]);
    window.setTimeout(() => setToasts((list) => list.filter((item) => item.id !== id)), 2600);
  }, []);

  const catName = (key) => t(`categories.${key}`);
  const title = (video) => video.title[lang] || video.title.en;
  const desc = (video) => (video.desc ? video.desc[lang] || video.desc.en : GENERIC_DESC[lang] || GENERIC_DESC.en);

  const viewer = session ? "member" : "guest";
  const ctx = { t, lang, rtl, viewer, session, showToast, catName, title, desc };
  return (
    <Ctx.Provider value={ctx}>
      <div className={`lib-root is-${surface}`} dir={rtl ? "rtl" : "ltr"} lang={lang}>
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
// Header — logo stays physically left; search expands in place with a live
// results overlay (no page scrolling), recent searches, keyboard navigation.
// ---------------------------------------------------------------------------

function HeaderSearch({ onClose }) {
  const { t, lang, catName, title } = useLib();
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(-1);
  const [recent, setRecent] = React.useState(readRecentSearches);
  const inputRef = React.useRef(null);
  const wrapRef = React.useRef(null);

  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  React.useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);

  const results = React.useMemo(() => searchVideos(q).slice(0, 6), [q]);
  const suggestions = React.useMemo(() => [...VIDEOS].sort((a, b) => b.viewsK - a.viewsK).slice(0, 4), []);

  const openVideo = (video) => {
    pushRecentSearch(q || title(video));
    onClose();
    window.location.hash = `#/watch/${video.slug}`;
  };
  const submit = () => {
    if (active >= 0 && results[active]) return openVideo(results[active]);
    if (!q.trim()) return;
    setRecent(pushRecentSearch(q));
    onClose();
    window.location.hash = `#/search?q=${encodeURIComponent(q.trim())}`;
  };
  const onKey = (e) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === "Enter") submit();
  };

  const resultRow = (video, i) => {
    const Icon = CAT_ICONS[video.category] || Sparkles;
    return (
      <button key={video.slug} className={`lib-sr${i === active ? " is-active" : ""}`} onClick={() => openVideo(video)}>
        <span className="lib-sr-thumb" style={{ background: toneOf(video) }}>
          <Icon size={22} strokeWidth={1.4} />
        </span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="lib-sr-title" style={{ display: "block" }}>
            {title(video)}
          </span>
          <span className="lib-sr-meta">
            <span>{catName(video.category)}</span>
            <span>·</span>
            <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
          </span>
        </span>
        <span className="lib-sr-badge">{t(`access.${video.access}`)}</span>
      </button>
    );
  };

  return (
    <div ref={wrapRef} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
      <div className="lib-hsearch" role="search">
        <Search size={16} />
        <input
          id="lib-header-search"
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(-1);
          }}
          onKeyDown={onKey}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          dir={/[؀-ۿ]/.test(q) || (!q && useLib) ? undefined : undefined}
        />
        {q ? (
          <button onClick={() => setQ("")} aria-label={t("search.clear")} style={{ display: "grid", color: "var(--mut)" }}>
            <X size={15} />
          </button>
        ) : null}
      </div>
      <button className="lib-search-close" onClick={onClose}>
        {t("search.close")}
      </button>
      <div className="lib-search-panel" role="listbox" aria-label={t("search.placeholder")}>
        {q.trim() ? (
          results.length ? (
            results.map(resultRow)
          ) : (
            <p className="lib-sp-empty">{t("search.empty")}</p>
          )
        ) : (
          <>
            {recent.length ? (
              <>
                <p className="lib-sp-label">
                  {t("search.recent")}
                  <button
                    onClick={() => {
                      try {
                        window.localStorage.removeItem("vidora-recent-searches");
                      } catch (e) {/* ignore */}
                      setRecent([]);
                    }}
                  >
                    {t("search.clear")}
                  </button>
                </p>
                {recent.map((term) => (
                  <button key={term} className="lib-sr" onClick={() => setQ(term)}>
                    <span className="lib-sr-thumb" style={{ background: "var(--s2)" }}>
                      <Clock3 size={16} strokeWidth={1.6} style={{ opacity: 0.5 }} />
                    </span>
                    <span className="lib-sr-title">{term}</span>
                  </button>
                ))}
              </>
            ) : null}
            <p className="lib-sp-label">{t("search.suggestions")}</p>
            {suggestions.map(resultRow)}
          </>
        )}
      </div>
    </div>
  );
}

function LibraryHeader({ reference = false }) {
  const { t, lang, rtl, viewer, session, catName, title } = useLib();
  const [drawer, setDrawer] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [logoBroken, setLogoBroken] = React.useState(false);
  const [headerQuery, setHeaderQuery] = React.useState("");
  const [headerActive, setHeaderActive] = React.useState(-1);
  const [headerRecent, setHeaderRecent] = React.useState(readRecentSearches);
  const headerInputRef = React.useRef(null);
  const profileMenuRef = React.useRef(null);
  const profileName = getDisplayName(session);
  const profileEmail = getUserEmail(session);
  const profileInitial = (profileName || profileEmail || "V").trim().charAt(0).toUpperCase();
  const profileAvatarUrl = session?.user.user_metadata?.avatar_url;
  const goMyList = () => {
    window.location.hash = viewer === "guest" ? loginHashFor("/dashboard/saved") : "#/dashboard/saved";
  };
  const items = [
    { key: "home", label: t("nav.home"), go: () => (window.location.hash = "#/") },
    { key: "new", label: t("nav.new"), go: () => document.getElementById("lib-new")?.scrollIntoView({ behavior: "smooth" }) },
    { key: "mylist", label: t("nav.myList"), go: goMyList },
  ];
  const closeSearch = React.useCallback(() => setSearchOpen(false), []);
  const headerResults = React.useMemo(() => searchVideos(headerQuery).slice(0, 6), [headerQuery]);
  const headerSuggestions = React.useMemo(() => [...VIDEOS].sort((a, b) => b.viewsK - a.viewsK).slice(0, 4), []);

  React.useEffect(() => {
    if (searchOpen) headerInputRef.current?.focus();
  }, [searchOpen]);

  React.useEffect(() => {
    if (!profileOpen) return undefined;
    profileMenuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [profileOpen]);

  React.useEffect(() => {
    if (viewer === "guest") setProfileOpen(false);
  }, [viewer]);

  const renderProfileAvatar = (large = false) => (
    <span className="lib-profile-avatar" style={large ? { width: 42, height: 42, fontSize: 14 } : undefined} aria-hidden="true">
      {profileInitial}
      {profileAvatarUrl ? <img src={String(profileAvatarUrl)} alt="" onError={(event) => event.currentTarget.remove()} /> : null}
    </span>
  );

  const openProfileRoute = (hash) => {
    setProfileOpen(false);
    window.location.hash = hash;
  };

  const logout = async () => {
    setProfileOpen(false);
    await signOutUser();
    window.location.hash = "#/";
  };

  const openHeaderVideo = (video) => {
    pushRecentSearch(headerQuery || title(video));
    setSearchOpen(false);
    window.location.hash = `#/watch/${video.slug}`;
  };
  const submitHeaderSearch = () => {
    if (headerActive >= 0 && headerResults[headerActive]) return openHeaderVideo(headerResults[headerActive]);
    if (!headerQuery.trim()) return;
    setHeaderRecent(pushRecentSearch(headerQuery));
    setSearchOpen(false);
    window.location.hash = `#/search?q=${encodeURIComponent(headerQuery.trim())}`;
  };
  const onHeaderSearchKey = (event) => {
    if (event.key === "Escape") closeSearch();
    else if (event.key === "ArrowDown") {
      event.preventDefault();
      setHeaderActive((index) => Math.min(headerResults.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHeaderActive((index) => Math.max(-1, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      submitHeaderSearch();
    }
  };
  const headerResultRow = (video, index) => {
    const Icon = CAT_ICONS[video.category] || Sparkles;
    return (
      <button key={video.slug} className={`lib-sr${index === headerActive ? " is-active" : ""}`} onClick={() => openHeaderVideo(video)}>
        <span className="lib-sr-thumb" style={{ background: toneOf(video) }}><Icon size={22} strokeWidth={1.4} /></span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="lib-sr-title" style={{ display: "block" }}>{title(video)}</span>
          <span className="lib-sr-meta"><span>{catName(video.category)}</span><span>·</span><span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span></span>
        </span>
        <span className="lib-sr-badge">{t(`access.${video.access}`)}</span>
      </button>
    );
  };

  if (reference && window.EditorialHeader) {
    const referenceItems = [
      { label: t("libraryPage.header.library"), active: true, onClick: () => (window.location.hash = "#/library") },
      { label: t("libraryPage.header.subscription"), onClick: () => (window.location.hash = viewer === "guest" ? loginHashFor("/dashboard/subscription") : "#/dashboard/subscription") },
    ];
    const Header = window.EditorialHeader;
    const panelItems = headerQuery.trim() ? headerResults : headerSuggestions;
    const headerPanel = (
      <div className="lib-search-panel" role="listbox" aria-label={t("search.placeholder")}>
        {headerQuery.trim() && panelItems.length === 0 ? <p className="lib-sp-empty">{t("search.empty")}</p> : null}
        {!headerQuery.trim() && headerRecent.length ? (
          <>
            <p className="lib-sp-label">
              {t("search.recent")}
              <button onClick={() => { try { window.localStorage.removeItem("vidora-recent-searches"); } catch (e) {/* ignore */} setHeaderRecent([]); }}>{t("search.clear")}</button>
            </p>
            {headerRecent.map((term) => <button key={term} className="lib-sr" onClick={() => setHeaderQuery(term)}><span className="lib-sr-thumb" style={{ background: "var(--s2)" }}><Clock3 size={16} /></span><span className="lib-sr-title">{term}</span></button>)}
            <p className="lib-sp-label">{t("search.suggestions")}</p>
          </>
        ) : !headerQuery.trim() ? <p className="lib-sp-label">{t("search.suggestions")}</p> : null}
        {panelItems.map(headerResultRow)}
      </div>
    );
    const authLabel = viewer === "guest" ? t("libraryPage.header.login") : (
      <span className="lib-profile-trigger" aria-haspopup="menu" aria-expanded={profileOpen}>
        {renderProfileAvatar()}
        <span className="lib-profile-name">{profileName}</span>
        <ChevronDown size={14} />
      </span>
    );
    return (
      <>
        <Header
          mode="library"
          layoutDirection="ltr"
          navItems={referenceItems}
          search={{
            open: searchOpen,
            query: headerQuery,
            onChange: (event) => { setHeaderQuery(event.target.value); setHeaderActive(-1); },
            onKeyDown: onHeaderSearchKey,
            onOpen: () => setSearchOpen(true),
            onClose: closeSearch,
            inputRef: headerInputRef,
            placeholder: t("search.placeholder"),
            closeLabel: t("search.close"),
            searchLabel: t("nav.search"),
            rtl,
            panel: headerPanel,
          }}
          auth={{
            label: authLabel,
            onClick: () => {
              if (viewer === "guest") window.location.hash = loginHashFor("/library");
              else setProfileOpen((value) => !value);
            },
          }}
        />
        {profileOpen && session ? (
          <>
            <div className="lib-profile-scrim" aria-hidden="true" onClick={() => setProfileOpen(false)} />
            <div className="lib-profile-menu" role="menu" ref={profileMenuRef} aria-label={t("libraryPage.profile.menuLabel")} dir={rtl ? "rtl" : "ltr"}>
              <div className="lib-profile-menu-head">
                {renderProfileAvatar(true)}
                <div><strong>{profileName}</strong><span>{profileEmail}</span></div>
              </div>
              <div className="lib-profile-menu-actions">
                <button role="menuitem" onClick={() => openProfileRoute("#/dashboard")}><LayoutDashboard size={16} />{t("libraryPage.profile.dashboard")}</button>
                <button role="menuitem" onClick={() => openProfileRoute("#/dashboard/saved")}><Bookmark size={16} />{t("libraryPage.profile.saved")}</button>
                <button role="menuitem" onClick={() => openProfileRoute("#/dashboard/profile")}><User size={16} />{t("libraryPage.profile.account")}</button>
                <button role="menuitem" onClick={() => openProfileRoute("#/dashboard/settings")}><Settings size={16} />{t("libraryPage.profile.settings")}</button>
                <button role="menuitem" className="is-danger" onClick={logout}><LogOut size={16} />{t("libraryPage.profile.logout")}</button>
              </div>
            </div>
          </>
        ) : null}
      </>
    );
  }
  return (
    <header className="lib-head">
      <div className="lib-wrap lib-head-in" dir="ltr">
        <a className="lib-logo" href="#/" aria-label="Vidora" style={{ gap: 9 }}>
          {logoBroken ? null : <img src={`${BASE()}assets/logos/vidora-mark-white.png`} alt="" onError={() => setLogoBroken(true)} />}
          <span>VIDORA</span>
        </a>
        {searchOpen ? (
          <HeaderSearch onClose={closeSearch} />
        ) : (
          <>
            <nav className="lib-nav" aria-label={t("nav.menu")}>
              {items.map((item) => (
                <button key={item.key} onClick={item.go}>
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="lib-head-actions">
              <button className="lib-iconbtn" aria-label={t("nav.search")} aria-expanded={searchOpen} onClick={() => setSearchOpen(true)}>
                <Search size={17} />
              </button>
              {viewer === "guest" ? (
                <a className="lib-login" href="#/login">
                  {t("nav.login")}
                </a>
              ) : (
                <a className="lib-avatarbtn" href="#/dashboard" aria-label={t("nav.profile")} title={t("nav.profile")}>
                  <User size={16} />
                </a>
              )}
              <button className="lib-iconbtn lib-burger" aria-label={t("nav.menu")} onClick={() => setDrawer(true)}>
                <MenuIcon size={19} />
              </button>
            </div>
          </>
        )}
      </div>
      {drawer ? <div className="lib-drawer-veil" onClick={() => setDrawer(false)} /> : null}
      <div className={`lib-drawer${drawer ? " is-open" : ""}`}>
        <button onClick={() => setDrawer(false)} aria-label={t("nav.close")} style={{ justifyContent: "flex-end" }}>
          <X size={18} />
        </button>
        {items.map((item) => (
          <button key={item.key} onClick={() => { setDrawer(false); item.go(); }}>
            {item.label}
          </button>
        ))}
        {viewer === "guest" ? <button onClick={() => (window.location.hash = "#/login")}>{t("nav.login")}</button> : <button onClick={() => (window.location.hash = "#/dashboard")}>{t("nav.profile")}</button>}
      </div>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Primitives — one standard media card + one compact progress card
// ---------------------------------------------------------------------------

function VideoCard({ video, flag, landscape = false }) {
  const { t, lang, catName, title } = useLib();
  const Icon = CAT_ICONS[video.category] || Sparkles;
  const extra = flag || (video.progress ? t("card.watching") : video.viewsK >= 40 ? t("card.views", { count: fmtNum(lang, video.viewsK) }) : null);
  return (
    <a className={`lib-card${landscape ? " is-landscape" : ""}`} href={`#/watch/${video.slug}`} aria-label={title(video)}>
      <span className="lib-thumb">
        {landscape ? <img className="lib-thumb-image" src={`${BASE()}${imageOf(video)}`} alt="" /> : (
          <span className="lib-thumb-art" style={{ background: toneOf(video) }}>
            <Icon size={72} strokeWidth={1.1} />
          </span>
        )}
        <span className="lib-thumb-shade" />
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
        {landscape ? <span className="lib-duration" dir="ltr">{video.durationMin}:00</span> : null}
      </span>
      <span className="lib-card-title">{title(video)}</span>
      <span className="lib-card-meta">
        <span>{catName(video.category)}</span>
        <span>·</span>
        <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
      </span>
      <span className="lib-card-extra">{extra || " "}</span>
    </a>
  );
}

function ContinueCard({ video }) {
  const { t, lang, title } = useLib();
  const Icon = CAT_ICONS[video.category] || Sparkles;
  const remaining = Math.max(1, Math.round((video.durationMin * (100 - video.progress)) / 100));
  return (
    <a className="lib-cw-card" href={`#/watch/${video.slug}`} aria-label={title(video)}>
      <span className="lib-cw-thumb" style={{ background: toneOf(video) }}>
        <Icon size={24} strokeWidth={1.3} />
      </span>
      <span className="lib-cw-body">
        <span className="lib-cw-title">{title(video)}</span>
        <span className="lib-cw-meter" dir="ltr">
          <span style={{ width: `${video.progress}%` }} />
        </span>
        <span className="lib-cw-sub">
          <span>{t("continueWatching.remaining", { minutes: fmtNum(lang, remaining) })}</span>
          <span className="lib-cw-resume">
            <Play size={11} /> {t("continueWatching.resume")}
          </span>
        </span>
      </span>
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

function VideoCarousel({ videos, loading, ariaLabel, flagFor, landscape = false }) {
  const { t, rtl } = useLib();
  const rowRef = React.useRef(null);
  const scroll = (fwd) => {
    const row = rowRef.current;
    if (!row) return;
    const amount = row.clientWidth * 0.9 * (fwd ? 1 : -1) * (rtl ? -1 : 1);
    row.scrollBy({ left: amount, behavior: "smooth" });
  };
  const showArrow = !loading && videos.length > 4;
  return (
    <div className="lib-carousel">
      <div className="lib-row" ref={rowRef} tabIndex={0} role="list" aria-label={ariaLabel}>
        {loading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : videos.map((video) => <VideoCard key={video.slug} video={video} landscape={landscape} flag={flagFor ? flagFor(video) : undefined} />)}
      </div>
      {showArrow ? (
        <button className="lib-arrow is-only" aria-label={rtl ? t("trending.next") : t("trending.prev")} onClick={() => scroll(rtl)}>
          <ChevronLeft size={19} />
        </button>
      ) : null}
    </div>
  );
}

function CategoryChips({ active, onChange, keys, max = 6 }) {
  const { t, catName } = useLib();
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? keys : keys.slice(0, max);
  return (
    <div className="lib-chips" role="tablist">
      <button className={`lib-chip${active === "all" ? " is-active" : ""}`} role="tab" aria-selected={active === "all"} onClick={() => onChange("all")}>
        {t("categories.all")}
      </button>
      {visible.map((key) => (
        <button key={key} className={`lib-chip${active === key ? " is-active" : ""}`} role="tab" aria-selected={active === key} onClick={() => onChange(key)}>
          {groupFor(key) ? t(`libraryPage.groups.${key}.short`) : catName(key)}
        </button>
      ))}
      {!expanded && keys.length > max ? (
        <button className="lib-chip" onClick={() => setExpanded(true)}>
          {t("trending.more")} +
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function FeaturedHero({ loading }) {
  const { t, lang, rtl, title, desc, catName } = useLib();
  const [slide, setSlide] = React.useState(0);
  const [previousSlide, setPreviousSlide] = React.useState(null);
  const [transitionId, setTransitionId] = React.useState(0);
  const [paused, setPaused] = React.useState(false);
  const transitionTimerRef = React.useRef(null);
  const items = HERO_SLUGS.map(bySlug);
  const video = items[slide];
  const media = HERO_MEDIA[video.slug];
  const selectSlide = React.useCallback((target) => {
    if (target === slide) return;
    window.clearTimeout(transitionTimerRef.current);
    setPreviousSlide(slide);
    setSlide(target);
    setTransitionId((value) => value + 1);
    transitionTimerRef.current = window.setTimeout(() => setPreviousSlide(null), 1200);
  }, [slide]);
  const move = React.useCallback((delta) => selectSlide((slide + delta + items.length) % items.length), [items.length, selectSlide, slide]);
  React.useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;
    const timer = window.setInterval(() => move(1), 6000);
    return () => window.clearInterval(timer);
  }, [move, paused]);
  React.useEffect(() => () => window.clearTimeout(transitionTimerRef.current), []);
  if (loading) {
    return (
      <div className="lib-hero-shell"><div className="lib-hero">
        <div className="lib-hero-in">
          <div className="lib-hero-box" style={{ width: "100%" }}>
            <div className="lib-skel lib-skel-line" style={{ width: 130 }} />
            <div className="lib-skel" style={{ height: 52, width: "78%" }} />
            <div className="lib-skel lib-skel-line" style={{ width: "94%" }} />
            <div className="lib-skel lib-skel-line" style={{ width: "60%" }} />
          </div>
        </div>
      </div></div>
    );
  }
  return (
    <div className="lib-hero-shell">
      <section
        className="lib-hero"
        aria-label={t("hero.label")}
        aria-roledescription="carousel"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        {previousSlide !== null ? (
          <img
            className={`lib-hero-media is-previous${HERO_MEDIA[items[previousSlide].slug].flip ? " is-flipped" : ""}`}
            src={`${BASE()}${HERO_MEDIA[items[previousSlide].slug].src}`}
            alt=""
            aria-hidden="true"
            style={{ objectPosition: HERO_MEDIA[items[previousSlide].slug].position }}
          />
        ) : null}
        <img
          key={`${video.slug}-${transitionId}`}
          className={`lib-hero-media is-current${previousSlide !== null ? " is-revealing" : ""}${media.flip ? " is-flipped" : ""}`}
          src={`${BASE()}${media.src}`}
          alt={title(video)}
          style={{ objectPosition: media.position }}
        />
        {previousSlide !== null ? <span key={transitionId} className="lib-hero-glass-wave" aria-hidden="true" /> : null}
        <div className="lib-hero-shade" />
        <div className="lib-hero-in">
          <div key={video.slug} className={`lib-hero-box${previousSlide !== null ? " is-revealing" : ""}`}>
            <p className="lib-hero-label">{t("libraryPage.hero.eyebrow")}</p>
            <h1 className="lib-hero-title">{title(video)}</h1>
            <p className="lib-hero-desc">{desc(video)}</p>
            <div className="lib-hero-meta">
              <Folder size={15} />
              <span>{catName(video.category)}</span>
              <span>·</span>
              <Clock3 size={15} />
              <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
            </div>
            <div className="lib-hero-cta">
              <a className="lib-btn is-primary" href={`#/watch/${video.slug}`}>
                {t("libraryPage.hero.watch")} <Play size={17} />
              </a>
            </div>
          </div>
        </div>
        <button className="lib-hero-arrow is-prev" aria-label={t("trending.prev")} onClick={() => move(-1)}>{rtl ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}</button>
        <button className="lib-hero-arrow is-next" aria-label={t("trending.next")} onClick={() => move(1)}>{rtl ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}</button>
        <div className="lib-hero-counter" aria-hidden="true">
          <strong>{String(slide + 1).padStart(2, "0")}</strong>
          <span>/ {String(items.length).padStart(2, "0")}</span>
        </div>
        <nav className="lib-hero-nav" aria-label={t("hero.label")}>
          {items.map((item, i) => (
            <button key={`${item.slug}-${i === slide ? transitionId : "idle"}`} className={`lib-hero-nav-item${i === slide ? " is-active" : ""}`} aria-label={t("hero.slide", { n: fmtNum(lang, i + 1) })} aria-current={i === slide ? "true" : undefined} onClick={() => selectSlide(i)}>
              <span className="lib-hero-nav-track"><span className="lib-hero-nav-fill" /></span>
              <span className="lib-hero-nav-label" dir="auto">{title(item)}</span>
            </button>
          ))}
        </nav>
      </section>
    </div>
  );
}

function ContinueWatching() {
  const { t, viewer } = useLib();
  const videos = VIDEOS.filter((video) => video.progress > 0 && video.progress < 100);
  if (viewer === "guest" || videos.length === 0) return null;
  return (
    <section className="lib-section lib-wrap" aria-label={t("continueWatching.title")}>
      <div className="lib-sec-head"><h2 className="lib-sec-title">{t("continueWatching.title")}</h2></div>
      <div className="lib-cw-grid">{videos.map((video) => <ContinueCard key={video.slug} video={video} />)}</div>
    </section>
  );
}

function LibrarySearchAndFilter({ topic, setTopic }) {
  const { t } = useLib();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const submit = (event) => {
    event.preventDefault();
    if (!query.trim()) return;
    pushRecentSearch(query);
    window.location.hash = `#/search?q=${encodeURIComponent(query.trim())}`;
  };
  return (
    <div className="lib-wrap lib-search-row">
      <form className="lib-page-search" role="search" onSubmit={submit}>
        <button type="submit" aria-label={t("nav.search")}><Search size={19} /></button>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("libraryPage.search.placeholder")} aria-label={t("libraryPage.search.placeholder")} />
      </form>
      <button className="lib-filter-btn" aria-expanded={open} aria-controls="library-filter-panel" onClick={() => setOpen((value) => !value)}>
        <SlidersHorizontal size={18} /> {t("libraryPage.search.filters")}
      </button>
      {open ? (
        <div className="lib-filter-popover" id="library-filter-panel">
          <p>{t("libraryPage.search.filterTitle")}</p>
          <div className="lib-filter-options">
            {["all", ...BROWSE_TOPICS].map((key) => (
              <button key={key} className={topic === key ? "is-active" : ""} onClick={() => { setTopic(key); setOpen(false); }}>
                {key === "all" ? t("categories.all") : t(`libraryPage.groups.${key}.title`)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TrendingSection({ loading, topic, setTopic }) {
  const { t } = useLib();
  const trending = React.useMemo(() => {
    let list = [...VIDEOS];
    if (topic !== "all") list = list.filter((video) => matchesTopic(video, topic));
    list.sort((a, b) => b.viewsK - a.viewsK);
    return list.slice(0, 10);
  }, [topic]);
  return (
    <section className="lib-section lib-wrap" id="lib-popular" aria-label={t("trending.title")}>
      <div className="lib-sec-head">
        <h2 className="lib-sec-title">{t("trending.title")}</h2>
        <span className="lib-sec-spacer" />
        <a className="lib-view-all" href="#/library/all?sort=popular">{t("libraryPage.viewAll")}</a>
      </div>
      <div className="lib-media-tools">
        <CategoryChips active={topic} onChange={setTopic} keys={BROWSE_TOPICS} max={4} />
      </div>
      {trending.length === 0 && !loading ? (
        <div className="lib-empty">
          <ListVideo size={30} />
          <p>{t("allVideos.emptyCategory")}</p>
        </div>
      ) : (
        <VideoCarousel videos={trending} loading={loading} landscape ariaLabel={t("trending.title")} />
      )}
    </section>
  );
}

function BrowseByCategory({ onPick }) {
  const { t, lang } = useLib();
  return (
    <section className="lib-section lib-wrap" aria-label={t("libraryPage.categoriesTitle")}>
      <div className="lib-sec-head">
        <h2 className="lib-sec-title">{t("libraryPage.categoriesTitle")}</h2>
        <span className="lib-sec-spacer" />
        <a className="lib-view-all" href="#/library/all">{t("libraryPage.viewAll")}</a>
      </div>
      <div className="lib-cats">
        {LIBRARY_GROUPS.map((group) => {
          const Icon = group.icon;
          const count = VIDEOS.filter((video) => group.categories.includes(video.category)).length;
          return (
            <button key={group.key} className="lib-cat-card" onClick={() => onPick(group.key)}>
              <span className="lib-cat-media">
                <img src={`${BASE()}${group.image}`} alt="" />
                <span className="lib-cat-icon"><Icon size={23} strokeWidth={1.7} /></span>
              </span>
              <span className="lib-cat-body">
                <span className="lib-cat-name">{t(`libraryPage.groups.${group.key}.title`)}</span>
                <span className="lib-cat-desc">{t(`libraryPage.groups.${group.key}.description`)}</span>
                <span className="lib-cat-count"><Play size={13} />{t("browse.count", { count: fmtNum(lang, count) })}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function NewOnVidora({ loading }) {
  const { t } = useLib();
  return (
    <section className="lib-section lib-wrap" id="lib-new" aria-label={t("newOn.title")}>
      <div className="lib-sec-head">
        <h2 className="lib-sec-title">{t("newOn.title")}</h2>
        <span className="lib-sec-spacer" />
        <a className="lib-view-all" href="#/library/all?sort=newest">{t("libraryPage.viewAll")}</a>
      </div>
      <VideoCarousel videos={NEWEST.concat(VIDEOS.filter((video) => !NEWEST.includes(video)).slice(0, 4))} loading={loading} landscape ariaLabel={t("newOn.title")} />
    </section>
  );
}

function EditorsPick() {
  const { t, lang, title, desc, catName } = useLib();
  const video = bySlug(EDITORS_PICK_SLUG);
  return (
    <section className="lib-section lib-wrap" aria-label={t("editorsPick.label")}>
      <div className="lib-banner">
        <div className="lib-banner-media" style={{ backgroundImage: `url(${BASE()}${BANNER_IMAGE})` }} />
        <div className="lib-banner-shade" />
        <div className="lib-banner-in">
          <div className="lib-banner-box">
            <p className="lib-hero-label">{t("editorsPick.label")}</p>
            <h2 className="lib-banner-title">{title(video)}</h2>
            <p className="lib-banner-desc">{desc(video)}</p>
            <div className="lib-hero-meta">
              <span>{catName(video.category)}</span>
              <span>·</span>
              <span>{t("card.minutes", { minutes: fmtNum(lang, video.durationMin) })}</span>
            </div>
            <div className="lib-hero-cta">
              <a className="lib-btn is-primary" href={`#/watch/${video.slug}`}>
                <Play size={16} /> {t("hero.watch")}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const GRID_STEP = 10;

function AllVideos({ loading, topic, setTopic, initialSort = "newest", initialType = "all", initialDuration = "all", onFiltersChange = null }) {
  const { t, lang } = useLib();
  const [type, setType] = React.useState(initialType);
  const [sort, setSort] = React.useState(initialSort);
  const [duration, setDuration] = React.useState(initialDuration);
  const [limit, setLimit] = React.useState(GRID_STEP);

  const filtered = React.useMemo(() => {
    let list = VIDEOS.filter((v) => {
      if (type !== "all" && v.type !== type) return false;
      if (topic !== "all" && !matchesTopic(v, topic)) return false;
      if (duration === "under15" && v.durationMin >= 15) return false;
      if (duration === "d15to30" && (v.durationMin < 15 || v.durationMin > 30)) return false;
      if (duration === "d30to60" && (v.durationMin < 30 || v.durationMin > 60)) return false;
      if (duration === "over60" && v.durationMin <= 60) return false;
      return true;
    });
    if (sort === "newest") list.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
    if (sort === "popular" || sort === "views") list.sort((a, b) => b.viewsK - a.viewsK);
    return list;
  }, [type, topic, sort, duration]);

  React.useEffect(() => setLimit(GRID_STEP), [type, topic, sort, duration]);

  React.useEffect(() => {
    onFiltersChange?.({ topic, type, sort, duration });
  }, [duration, onFiltersChange, sort, topic, type]);

  return (
    <section className="lib-all-content" id="lib-all" aria-label={t("allVideos.title")}>
      <div className="lib-chips" role="tablist" style={{ marginTop: 20 }}>
        {["all", ...TYPES].map((key) => (
          <button key={key} className={`lib-chip${type === key ? " is-active" : ""}`} role="tab" aria-selected={type === key} onClick={() => setType(key)}>
            {t(`types.${key}`)}
          </button>
        ))}
      </div>
      <div className="lib-controls-row">
        <select className="lib-select" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label={t("categories.allTopics")}>
          <option value="all">{t("categories.allTopics")}</option>
          {LIBRARY_GROUPS.map((group) => <option key={group.key} value={group.key}>{t(`libraryPage.groups.${group.key}.title`)}</option>)}
          {TOPICS.filter((key) => !groupFor(key)).map((key) => (
            <option key={key} value={key}>
              {t(`categories.${key}`)}
            </option>
          ))}
        </select>
        <select className="lib-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={t("sort.newest")}>
          {["newest", "popular", "views"].map((key) => (
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
      </div>
      {loading ? (
        <div className="lib-grid">
          {Array.from({ length: 10 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="lib-empty">
          <ListVideo size={30} />
          <p>{t("allVideos.emptyCategory")}</p>
        </div>
      ) : (
        <>
          <div className="lib-grid">
            {filtered.slice(0, limit).map((video) => (
              <VideoCard key={video.slug} video={video} landscape />
            ))}
          </div>
          {filtered.length > limit ? (
            <div className="lib-loadmore">
              <button className="lib-btn is-ghost" onClick={() => setLimit((n) => n + GRID_STEP)}>
                {t("allVideos.loadMore")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function TrustStrip() {
  const { t } = useLib();
  const items = [
    { key: "support", icon: Headphones },
    { key: "secure", icon: ShieldCheck },
    { key: "global", icon: Globe2 },
  ];
  return (
    <section className="lib-trust" aria-label={t("libraryPage.trust.label")}>
      <div className="lib-wrap lib-trust-in">
        {items.map(({ key, icon: Icon }) => (
          <div className="lib-trust-item" key={key}>
            <Icon size={34} strokeWidth={1.5} />
            <div><h3>{t(`libraryPage.trust.${key}.title`)}</h3><p>{t(`libraryPage.trust.${key}.description`)}</p></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function LibraryFooter() {
  const { t } = useLib();
  return (
    <footer className="lib-footer">
      <div className="lib-wrap lib-footer-in">
        <a className="lib-logo" href="#/" aria-label="Vidora"><span>VIDORA</span></a>
        <div className="lib-footer-links">
          <button onClick={() => (window.location.hash = "#/")}>{t("libraryPage.footer.about")}</button>
          <button onClick={() => (window.location.hash = "#/dashboard/support")}>{t("libraryPage.footer.contact")}</button>
          <button onClick={() => (window.location.hash = "#/")}>{t("libraryPage.footer.privacy")}</button>
        </div>
        <p className="lib-footer-rights">{t("footer.rights")}</p>
      </div>
    </footer>
  );
}

// ---------------------------------------------------------------------------
// Library page
// ---------------------------------------------------------------------------

function readTopicFromHash() {
  const query = window.location.hash.split("?")[1] || "";
  const topic = new URLSearchParams(query).get("topic");
  return topic && (TOPICS.includes(topic) || BROWSE_TOPICS.includes(topic)) ? topic : "all";
}

const ALL_VIDEO_SORTS = ["newest", "popular", "views"];
const ALL_VIDEO_DURATIONS = ["all", "under15", "d15to30", "d30to60", "over60"];

function readAllVideoParams() {
  const query = window.location.hash.split("?")[1] || "";
  const params = new URLSearchParams(query);
  const category = params.get("category");
  const sort = params.get("sort");
  const type = params.get("type");
  const duration = params.get("duration");
  return {
    topic: category && (TOPICS.includes(category) || BROWSE_TOPICS.includes(category)) ? category : "all",
    sort: sort && ALL_VIDEO_SORTS.includes(sort) ? sort : "newest",
    type: type && TYPES.includes(type) ? type : "all",
    duration: duration && ALL_VIDEO_DURATIONS.includes(duration) ? duration : "all",
  };
}

function AllVideosPageInner() {
  const { t, rtl } = useLib();
  const initial = React.useMemo(readAllVideoParams, []);
  const [topic, setTopic] = React.useState(initial.topic);

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, []);

  const syncUrl = React.useCallback(({ topic: nextTopic, type, sort, duration }) => {
    const params = new URLSearchParams();
    params.set("sort", sort);
    if (nextTopic !== "all") params.set("category", nextTopic);
    if (type !== "all") params.set("type", type);
    if (duration !== "all") params.set("duration", duration);
    const query = params.toString();
    try {
      window.history.replaceState(null, "", `#/library/all${query ? `?${query}` : ""}`);
    } catch (error) {/* ignore */}
  }, []);

  return (
    <>
      <LibraryHeader reference />
      <main className="lib-all-page">
        <div className="lib-wrap">
          <div className="lib-all-page-head">
            <h1 className="lib-all-page-title">{t("allVideos.title")}</h1>
            <a className="lib-all-back" href="#/library">
              {rtl ? <ArrowRight size={15} /> : <ArrowLeft size={15} />}
              {t("allVideos.backToLibrary")}
            </a>
          </div>
        </div>
        <LibrarySearchAndFilter topic={topic} setTopic={setTopic} />
        <div className="lib-wrap">
          <AllVideos
            loading={false}
            topic={topic}
            setTopic={setTopic}
            initialSort={initial.sort}
            initialType={initial.type}
            initialDuration={initial.duration}
            onFiltersChange={syncUrl}
          />
        </div>
      </main>
      <TrustStrip />
      <LibraryFooter />
    </>
  );
}

function LibraryPageInner() {
  const loading = false;
  const [topic, setTopic] = React.useState(readTopicFromHash);

  const updateTopic = (key) => {
    setTopic(key);
    try {
      window.history.replaceState(null, "", key === "all" ? "#/library" : `#/library?topic=${key}`);
    } catch (e) {/* ignore */}
  };
  const pickTopic = (key) => {
    updateTopic(key);
    document.getElementById("lib-popular")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <>
      <LibraryHeader reference />
      <FeaturedHero loading={loading} />
      <LibrarySearchAndFilter topic={topic} setTopic={updateTopic} />
      <BrowseByCategory onPick={pickTopic} />
      <TrendingSection loading={loading} topic={topic} setTopic={updateTopic} />
      <NewOnVidora loading={loading} />
      <ContinueWatching />
      <TrustStrip />
      <LibraryFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// Search results page (#/search?q=…)
// ---------------------------------------------------------------------------

function SearchPageInner() {
  const { t, lang } = useLib();
  const q = React.useMemo(() => {
    const query = window.location.hash.split("?")[1] || "";
    return new URLSearchParams(query).get("q") || "";
  }, [window.location.hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = searchVideos(q);
  return (
    <>
      <LibraryHeader />
      <div className="lib-wrap" style={{ paddingBlock: "38px 90px" }}>
        <a className="lib-back" href="#/library">
          <Search size={13} /> {t("watch.back")}
        </a>
        <h1 style={{ fontSize: 24, fontWeight: 800, marginTop: 8 }}>{t("search.resultsFor", { q })}</h1>
        <p style={{ color: "var(--mut)", fontSize: 13.5, marginTop: 8 }}>{t("search.resultsCount", { count: fmtNum(lang, results.length) })}</p>
        {results.length === 0 ? (
          <div className="lib-empty">
            <Search size={30} />
            <p>{t("search.empty")}</p>
          </div>
        ) : (
          <div className="lib-grid">
            {results.map((video) => (
              <VideoCard key={video.slug} video={video} />
            ))}
          </div>
        )}
      </div>
      <LibraryFooter />
    </>
  );
}

// ---------------------------------------------------------------------------
// Watch page (#/watch/:slug)
// ---------------------------------------------------------------------------

function WatchPageInner() {
  const { t, lang, rtl, viewer, title, desc, catName } = useLib();
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

  const canWatchFull = video.access === "free";
  const canPreview = canWatchFull || video.access === "preview";
  const durationSec = video.durationMin * 60;
  const clock = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  const similar = VIDEOS.filter((v) => v.slug !== video.slug && v.category === video.category)
    .concat(VIDEOS.filter((v) => v.slug !== video.slug && v.category !== video.category))
    .slice(0, 8);
  const gateCta = viewer === "guest" ? { label: t("watch.guestCta"), href: loginHashFor(`/watch/${video.slug}`) } : { label: t("watch.memberCta"), href: "#/dashboard/subscription" };
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

        <section className="lib-section" style={{ marginTop: 72 }} aria-label={t("watch.similar")}>
          <div className="lib-sec-head">
            <h2 className="lib-sec-title">
              <Sparkles size={19} /> {t("watch.similar")}
            </h2>
          </div>
          <VideoCarousel videos={similar} loading={false} ariaLabel={t("watch.similar")} />
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
    <LibraryProvider surface="library">
      {window.location.hash.startsWith("#/library/all") ? <AllVideosPageInner /> : <LibraryPageInner />}
    </LibraryProvider>
  );
}

export function WatchPage() {
  return (
    <LibraryProvider surface="watch">
      <WatchPageInner />
    </LibraryProvider>
  );
}

export function SearchPage() {
  return (
    <LibraryProvider surface="search">
      <SearchPageInner />
    </LibraryProvider>
  );
}
