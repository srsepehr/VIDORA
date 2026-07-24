import React from "react";
import { createRoot } from "react-dom/client";
import {
  BadgeDollarSign,
  BookOpen,
  Bookmark,
  CheckCircle2,
  CirclePlus,
  Crown,
  Download,
  FileText,
  Captions,
  CircleHelp,
  Folder,
  Gauge,
  Heart,
  Headphones,
  Home,
  Library,
  Menu,
  MessageCircle,
  MoreHorizontal,
  ChevronDown,
  Lock,
  Search,
  Trash2,
  Upload,
  Video,
  User,
  X,
} from "lucide-react";
import "./styles.css";
import "./tailwind.css";
import "./components/dashboard/dashboard-shell.css";
import dashboardEn from "./locales/en/dashboard.json";
import dashboardFa from "./locales/fa/dashboard.json";
import { ArrowLeft, ArrowRight, BrainCircuit, Code2, Languages, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/heroui-card";
import MotionButton from "@/components/ui/motion-button";
import { VidoraFooter } from "@/components/ui/footer-section";
import { SignInPage } from "@/components/ui/sign-in";
import { SignUpPage } from "@/components/ui/sign-up";
import { LibraryPage, WatchPage, SearchPage } from "./library.jsx";
import { AuthDiagnostics } from "./components/dev/AuthDiagnostics";
import {
  getDisplayName,
  getCachedSession,
  getUserEmail,
  restoreAuthSession,
  signInWithPassword,
  signOut as signOutUser,
  signUpWithPassword,
  subscribeAuthState,
} from "./lib/auth";
import { AppError, logAppError, toAppError } from "./lib/app-error";
import { getCurrentInternalPath, sanitizeReturnTo, toHash } from "./lib/return-to";
import { fetchActiveSubscription, fetchUserVideos, normalizeVideoStatus } from "./lib/user-data";
import { buildAuthHash, consumeAuthIntent, createAuthIntent, persistAuthIntent, readAuthIntent, readAuthIntentFromHash } from "./lib/auth-intent";
import { isSubscriptionActive } from "./lib/subscription-access";
import { fetchPublicPlans, formatPlanPrice } from "./lib/plans";
import { paymentAdapter, PaymentNotConfiguredError } from "./lib/payment";
import { ROUTES } from "./lib/routes";
import { trackEvent } from "./lib/analytics";
import { deleteVideo, retryVideoProcessing } from "./lib/video-service";
import { TranslationIntakePanel, VideoProcessingDetail, isActiveVideoStatus, statusLabel } from "./video-workflow.jsx";
import { DashboardHome } from "./components/dashboard/dashboard-home.jsx";

window.React = React;
window.ReactDOM = { createRoot };


// work/vidora/ui_kits/_shared/image-slot.js
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever you want the user to
 * supply an image. You control the slot's shape and size; the user fills it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The host bridge only allows sidecar writes at the project root, so the
 * HTML that uses this component is assumed to live at the project root too
 * (same constraint as design_canvas.jsx).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          object-fit: cover | contain | fill.       (default 'cover')
 *                With cover (the default) double-clicking the filled slot
 *                enters a reframe mode: the whole image spills past the mask
 *                (translucent outside, opaque inside), drag to reposition,
 *                corner-drag to scale. The crop persists alongside the image
 *                in the sidecar. contain/fill stay static.
 *   position     object-position for fit=contain|fill.     (default '50% 50%')
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. A user drop overrides
 *                it; clearing the drop reveals src again.
 *   credit       Optional attribution text (e.g. 'Photo by Jane Doe on
 *                Unsplash') shown as a small overlay at the bottom-left of
 *                the filled slot. It belongs to the src image, so it only
 *                shows while src is what's displayed — a user-dropped
 *                image hides it.
 *   credit-href  Optional link for the credit overlay (e.g. the
 *                photographer's profile). http(s) URLs only — anything
 *                else renders the credit as plain text.
 *
 * Size and layout come from ordinary CSS on the element — width/height
 * inline or from a parent grid — so it composes with any layout.
 *
 * Usage:
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';
  // 2× a ~600px slot in a 1920-wide deck — retina-sharp without making the
  // sidecar enormous. A 1200px WebP at q=0.85 is ~150-300KB.
  const MAX_DIM = 1200;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;

  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        // Merge: sidecar loses to any in-memory change that raced ahead of
        // the fetch (drop or clear) so neither is clobbered by hydration.
        if (j && typeof j === 'object') {
          const merged = Object.assign({}, j, slots);
          // A framing-only write that raced ahead of hydration must not
          // drop a user image that's only on disk — inherit u from the
          // sidecar for any in-memory entry that lacks one.
          for (const k in slots) {
            if (merged[k] && !merged[k].u && j[k]) {
              merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
            }
          }
          for (const id of tombstones) delete merged[id];
          slots = merged;
        }
        tombstones.clear();
      })
      .catch(() => {})
      .then(() => { loaded = true; subs.forEach((fn) => fn()); });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  function save() {
    if (saving) { saveDirty = true; return; }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots)))
      .catch(() => {})
      .then(() => { saving = false; if (saveDirty) { saveDirty = false; save(); } });
  }

  const S_MAX = 5;
  const clampS = (s) => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? { u: v, s: 1, x: 0, y: 0 } : v;
  }

  function setSlot(id, val) {
    if (!id) return;
    if (val) { slots[id] = val; tombstones.delete(id); }
    else { delete slots[id]; if (!loaded) tombstones.add(id); }
    subs.forEach((fn) => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save(); else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the
  // raw upload. Longest side is capped at 2× the slot's rendered width
  // (retina) and at MAX_DIM. WebP keeps alpha and is ~10× smaller than PNG
  // for photos, so there's no need for per-image format picking.
  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet =
    ':host{display:inline-block;position:relative;vertical-align:top;' +
    '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);width:240px;height:160px}' +
    '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.04)}' +
    // .frame img (clipped) and .spill (unclipped ghost + handles) share the
    // same left/top/width/height in frame-%, computed by _applyView(), so the
    // inside-mask crop and the outside-mask spill stay pixel-aligned.
    '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' +
    '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
    // Reframe mode (double-click): the full image spills past the mask. The
    // spill layer is sized to the IMAGE bounds so its corners are where the
    // resize handles belong. The ghost <img> inside is translucent; the real
    // clipped <img> underneath shows the opaque in-mask crop.
    '.spill{position:absolute;transform:translate(-50%,-50%);display:none;z-index:1;' +
    '  cursor:grab;touch-action:none}' +
    ':host([data-panning]) .spill{cursor:grabbing}' +
    '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' +
    '  pointer-events:none;-webkit-user-drag:none;user-select:none;' +
    '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' +
    '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' +
    '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' +
    '  transform:translate(-50%,-50%)}' +
    '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' +
    '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' +
    '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' +
    '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' +
    ':host([data-reframe]){z-index:10}' +
    ':host([data-reframe]) .spill{display:block}' +
    ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' +
    '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
    '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' +
    '  cursor:pointer;user-select:none}' +
    '.empty svg{opacity:.45}' +
    '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' +
    '.empty .sub{font-size:11px}' +
    '.empty .sub u{text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' +
    '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' +
    ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' +
    '  background:rgba(201,100,66,.10)}' +
    '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' +
    '  transition:border-color .12s}' +
    ':host([data-over]) .ring{border-color:#c96442}' +
    ':host([data-filled]) .ring{display:none}' +
    // Controls sit BELOW the mask (top:100%), absolutely positioned so the
    // author-declared slot height is unaffected. The gap is padding, not a
    // top offset, so the hover target stays contiguous with the frame.
    '.ctl{position:absolute;top:100%;left:50%;transform:translateX(-50%);padding-top:8px;' +
    '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' +
    '  white-space:nowrap}' +
    ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' +
    '  {opacity:1;pointer-events:auto}' +
    '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' +
    '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' +
    '  backdrop-filter:blur(6px)}' +
    '.ctl button:hover{background:rgba(0,0,0,.8)}' +
    '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' +
    '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}' +
    '.credit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:none;' +
    '  padding:3px 7px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;' +
    '  font:10px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;' +
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px)}' +
    '.credit[href]:hover{background:rgba(0,0,0,.8);text-decoration:underline}' +
    ':host([data-filled][data-credit]) .credit{display:block}';

  const icon =
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' +
    '<path d="m21 15-5-5L5 21"/></svg>';

  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'id', 'credit', 'credit-href'];
    }

    constructor() {
      super();
      const root = this.attachShadow({ mode: 'open' });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML =
        '<style>' + stylesheet + '</style>' +
        '<div class="frame" part="frame">' +
        '  <img part="image" alt="" draggable="false" style="display:none">' +
        '  <div class="empty" part="empty">' + icon +
        '    <div class="cap"></div>' +
        '    <div class="sub">or <u>browse files</u></div></div>' +
        '  <div class="ring" part="ring"></div>' +
        '</div>' +
        // Outside .frame, like .spill/.ctl — the frame's overflow:hidden +
        // border-radius/clip-path would cut the credit off on circle/pill/mask.
        '<a class="credit" part="credit" target="_blank" rel="noopener noreferrer"></a>' +
        '<div class="spill">' +
        '  <img class="ghost" alt="" draggable="false">' +
        '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' +
        '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' +
        '</div>' +
        '<div class="ctl"><button data-act="replace" title="Replace image">Replace</button>' +
        '  <button data-act="clear" title="Remove image">Remove</button></div>' +
        '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._credit = root.querySelector('.credit');
      // Credit clicks open the link, not browse/reframe.
      this._credit.addEventListener('click', (e) => e.stopPropagation());
      this._credit.addEventListener('dblclick', (e) => e.stopPropagation());
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      this._view = { s: 1, x: 0, y: 0 };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', (e) => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'replace') { this._exitReframe(true); this._input.click(); }
        if (act === 'clear') {
          this._exitReframe(false);
          this._gen++;
          this._local = null;
          if (this.id) setSlot(this.id, null); else this._render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      this._img.addEventListener('load', () => this._applyView());
      // Gated on editable + fit=cover so share links and contain/fill slots
      // stay static.
      this.addEventListener('dblclick', (e) => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);
        else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1, fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1, ih = this._img.naturalHeight || 1;
          const base = Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0, h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2, oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0, uy = sy * h0 / diag0;
          move = (ev) => {
            const proj = (ev.clientX - rect.left - ox) * ux +
                         (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = { px: e.clientX, py: e.clientY, x: this._view.x, y: this._view.y };
          move = (ev) => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try { this._spill.releasePointerCapture(e.pointerId); } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', (e) => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, { passive: false });
    }

    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }

    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) { this._ro.disconnect(); this._ro = null; }
      this._exitReframe(false);
    }

    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = (e) => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = (e) => { if (e.key === 'Escape') this._exitReframe(true); };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }

    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (commit) this._commitView();
    }

    attributeChangedCallback() { if (this.shadowRoot) this._render(); }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) { this._depth = 0; this.removeAttribute('data-over'); }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }

    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        const val = { u: url, s: 1, x: 0, y: 0 };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) { this._local = val; this._render(); }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }

    _setError(msg) {
      if (this._err) { this._err.remove(); this._err = null; }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err'; d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => { if (this._err === d) { d.remove(); this._err = null; } }, 3000);
    }

    // Reframing (pan/resize) is only meaningful for fit=cover — contain/fill
    // keep the old object-fit path and double-click is a no-op.
    _reframes() {
      return this.hasAttribute('data-filled') &&
        (this.getAttribute('fit') || 'cover') === 'cover';
    }

    // Cover-baseline geometry, shared by clamp/apply/resize. Null until the
    // img has loaded (naturalWidth is 0 before that) or when the slot has no
    // layout box — ResizeObserver fires with a 0×0 rect under display:none,
    // and clamping against a degenerate 1×1 frame would silently pull the
    // stored pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth, ih = this._img.naturalHeight;
      const fw = this.clientWidth, fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      return { iw, ih, fw, fh, base: Math.max(fw / iw, fh / ih) };
    }

    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }

    _applyView() {
      const g = this._geom();
      const fit = this.getAttribute('fit') || 'cover';
      if (fit !== 'cover' || !g) {
        // Non-cover, or dimensions not known yet (before img load).
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      // Cover baseline: img fills the frame on its tighter axis at s=1, so
      // pan works immediately on the overflowing axis without zooming first.
      // Width/height and left/top are all frame-% — depends only on the
      // frame aspect ratio, so a responsive resize keeps the same crop. The
      // spill layer mirrors the same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = (g.iw * k / g.fw * 100) + '%';
      const h = (g.ih * k / g.fh * 100) + '%';
      const l = (50 + this._view.x) + '%';
      const t = (50 + this._view.y) + '%';
      this._img.style.width = w; this._img.style.height = h;
      this._img.style.left = l; this._img.style.top = t;
      this._img.style.objectFit = '';
      this._spill.style.width = w; this._spill.style.height = h;
      this._spill.style.left = l; this._spill.style.top = t;
    }

    _commitView() {
      const v = { s: this._view.s, x: this._view.x, y: this._view.y };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);
      else { this._local = v; }
    }

    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';
      else if (shape === 'pill') radius = '9999px';
      else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = (stored && stored.u) || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        this._view = {
          s: stored && Number.isFinite(stored.s) ? clampS(stored.s) : 1,
          x: stored && Number.isFinite(stored.x) ? stored.x : 0,
          y: stored && Number.isFinite(stored.y) ? stored.y : 0,
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      if (url) {
        if (this._img.getAttribute('src') !== url) {
          this._img.src = url;
          this._ghost.src = url;
        }
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        this._empty.style.display = 'flex';
        this.removeAttribute('data-filled');
      }

      // Credit belongs to the author src, so a user drop hides it.
      // textContent + http(s)-only href keep external strings inert.
      const credit = this.getAttribute('credit');
      const showCredit = !!(url && credit && !this._userUrl);
      if (showCredit) {
        this._credit.textContent = credit;
        let href = '';
        const rawHref = this.getAttribute('credit-href') || '';
        if (rawHref) {
          try {
            const u = new URL(rawHref, document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
          } catch {}
        }
        if (href) this._credit.setAttribute('href', href);
        else this._credit.removeAttribute('href');
      } else {
        this._credit.textContent = '';
        this._credit.removeAttribute('href');
      }
      this.toggleAttribute('data-credit', showCredit);
    }
  }

  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();


// work/vidora/_ds_bundle.js
/* @ds-bundle: {"format":4,"namespace":"VidoraDesignSystem_0f84f2","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"LanguageToggle","sourcePath":"components/core/LanguageToggle.jsx"},{"name":"ProgressBar","sourcePath":"components/feedback/ProgressBar.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton.jsx"},{"name":"Spinner","sourcePath":"components/feedback/Spinner.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"SearchBar","sourcePath":"components/forms/SearchBar.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"CategoryChip","sourcePath":"components/media/CategoryChip.jsx"},{"name":"LanguageBadge","sourcePath":"components/media/LanguageBadge.jsx"},{"name":"PlayerControls","sourcePath":"components/media/PlayerControls.jsx"},{"name":"PosterCard","sourcePath":"components/media/PosterCard.jsx"},{"name":"TranscriptLine","sourcePath":"components/media/TranscriptLine.jsx"},{"name":"VideoCard","sourcePath":"components/media/VideoCard.jsx"},{"name":"Breadcrumb","sourcePath":"components/navigation/Breadcrumb.jsx"},{"name":"NavItem","sourcePath":"components/navigation/NavItem.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"507989b21726","components/core/Badge.jsx":"7465d21eaa5d","components/core/Button.jsx":"278db4ebd664","components/core/Card.jsx":"632a43dc6e5a","components/core/IconButton.jsx":"a2dac777dd0e","components/core/LanguageToggle.jsx":"150ec38db6da","components/feedback/ProgressBar.jsx":"19c46eacc444","components/feedback/Skeleton.jsx":"7d035fb89c30","components/feedback/Spinner.jsx":"1c4d98ac6d3c","components/feedback/Toast.jsx":"2f1293c45757","components/forms/Checkbox.jsx":"c9e8a5181af5","components/forms/Input.jsx":"f2e8807b3d95","components/forms/SearchBar.jsx":"96ffa52cf243","components/forms/Select.jsx":"a86f7bc032c5","components/forms/Switch.jsx":"5f9293b58701","components/media/CategoryChip.jsx":"f514f983367a","components/media/LanguageBadge.jsx":"a15e974d3925","components/media/PlayerControls.jsx":"d95af709e271","components/media/PosterCard.jsx":"cee9323903f5","components/media/TranscriptLine.jsx":"638ff1e25625","components/media/VideoCard.jsx":"637a22cbadd1","components/navigation/Breadcrumb.jsx":"0115667b4a48","components/navigation/NavItem.jsx":"fe52e72acf17","components/navigation/Tabs.jsx":"69f2f8cbc846","ui_kits/_shared/icons.jsx":"4b40a20b5964","ui_kits/_shared/image-slot.js":"4cffaf8e50f6","ui_kits/app/AppSidebar.jsx":"29bbcc65d449","ui_kits/app/AppTopbar.jsx":"a55eb0d4ecb7","ui_kits/app/DiscoverScreen.jsx":"398c750a0f93","ui_kits/app/LibraryScreen.jsx":"2a00ab2b4cf3","ui_kits/app/WatchScreen.jsx":"6e25a27c73ae","ui_kits/marketing/EditorialFooter.jsx":"c9e8efa3b3fd","ui_kits/marketing/EditorialHeader.jsx":"28efc6977ada","ui_kits/marketing/EditorialHero.jsx":"478a3ff9c0c3","ui_kits/marketing/EditorialSections.jsx":"9dadfb79a865","ui_kits/marketing/Footer.jsx":"515a1f273b35","ui_kits/marketing/Hero.jsx":"d20e88e15d7e","ui_kits/marketing/MarketingHeader.jsx":"ab0f1f84b228","ui_kits/marketing/Sections.jsx":"c6c4b2fc9c91","ui_kits/marketing/i18n.js":"71e229122cc9","ui_kits/mobile/MobileScreens.jsx":"d554220acc69","ui_kits/mobile/PhoneFrame.jsx":"38e9557d1b47"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.VidoraDesignSystem_0f84f2 = window.VidoraDesignSystem_0f84f2 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * User avatar. Shows an image when `src` is set, otherwise initials.
 * Optional presence dot and brand ring (e.g. AI assistant).
 */
function Avatar({
  src,
  name = "",
  size = "md",
  ring = false,
  presence = null,
  style = {},
  ...rest
}) {
  const sizes = {
    xs: 24,
    sm: 32,
    md: 40,
    lg: 56,
    xl: 80
  };
  const dim = sizes[size] || sizes.md;
  const initials = name.split(" ").map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  const presenceColor = {
    online: "var(--success)",
    away: "var(--warning)",
    offline: "var(--muted-foreground)"
  }[presence];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      position: "relative",
      display: "inline-flex",
      flex: "none",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      width: dim,
      height: dim,
      borderRadius: "var(--radius-full)",
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-sans)",
      fontSize: Math.max(11, dim * 0.4),
      fontWeight: 600,
      overflow: "hidden",
      boxShadow: ring ? "0 0 0 2px var(--background), 0 0 0 4px var(--brand)" : "none"
    }
  }, src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials || "?"), presence ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: Math.max(8, dim * 0.28),
      height: Math.max(8, dim * 0.28),
      borderRadius: "50%",
      background: presenceColor,
      boxShadow: "0 0 0 2px var(--background)"
    }
  }) : null);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Compact status / metadata label. `tone` sets the color intent.
 * Use `dot` for a leading status dot; `brand` marks AI/translated states.
 */
function Badge({
  tone = "neutral",
  size = "md",
  dot = false,
  style = {},
  children,
  ...rest
}) {
  const tones = {
    neutral: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      border: "1px solid transparent"
    },
    outline: {
      background: "transparent",
      color: "var(--muted-foreground)",
      border: "1px solid var(--border)"
    },
    brand: {
      background: "var(--brand-subtle)",
      color: "var(--brand-subtle-foreground)",
      border: "1px solid transparent"
    },
    success: {
      background: "color-mix(in oklch, var(--success) 16%, transparent)",
      color: "var(--success)",
      border: "1px solid transparent"
    },
    warning: {
      background: "color-mix(in oklch, var(--warning) 24%, transparent)",
      color: "var(--warning-foreground)",
      border: "1px solid transparent"
    },
    destructive: {
      background: "color-mix(in oklch, var(--destructive) 14%, transparent)",
      color: "var(--destructive)",
      border: "1px solid transparent"
    },
    solid: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "1px solid var(--primary)"
    }
  };
  const t = tones[tone] || tones.neutral;
  const pad = size === "sm" ? "2px 8px" : "3px 10px";
  const font = size === "sm" ? "var(--text-xs)" : "var(--text-xs)";
  const dotColor = {
    brand: "var(--brand)",
    success: "var(--success)",
    warning: "var(--warning)",
    destructive: "var(--destructive)"
  }[tone] || "var(--muted-foreground)";
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: pad,
      fontFamily: "var(--font-sans)",
      fontSize: font,
      fontWeight: 500,
      lineHeight: 1.4,
      letterSpacing: "0.005em",
      borderRadius: "var(--radius-full)",
      ...t,
      ...style
    }
  }, rest), dot ? /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: dotColor,
      flex: "none"
    }
  }) : null, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Vidora primary action control. Monochrome by default; the `brand`
 * variant is the single blue CTA reserved for one primary action per view.
 * Visual spec follows the shadcn/ReUI base-button treatment: compact
 * heights (28/34/40), radius-md, /90 hover fills, xs shadow on filled
 * variants, 60% icon opacity on quiet variants, opacity-60 disabled.
 */
function Button({
  variant = "primary",
  size = "md",
  iconLeft = null,
  iconRight = null,
  disabled = false,
  fullWidth = false,
  type = "button",
  style = {},
  children,
  ...rest
}) {
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  const sizes = {
    sm: {
      height: 28,
      padding: "0 10px",
      font: "var(--text-xs)",
      gap: 5,
      radius: "var(--radius-md)"
    },
    md: {
      height: 34,
      padding: "0 12px",
      font: "0.8125rem",
      gap: 6,
      radius: "var(--radius-md)"
    },
    lg: {
      height: 40,
      padding: "0 16px",
      font: "var(--text-sm)",
      gap: 6,
      radius: "var(--radius-md)"
    }
  };
  const s = sizes[size] || sizes.md;

  // hover fill = 90% of the base color (ReUI `hover:bg-primary/90`)
  const mix = c => `color-mix(in oklab, ${c} 90%, transparent)`;
  const shadowXs = "0 1px 2px 0 rgb(0 0 0 / 0.05)";
  const variants = {
    primary: {
      background: hover ? mix("var(--primary)") : "var(--primary)",
      color: "var(--primary-foreground)",
      border: "1px solid transparent",
      boxShadow: shadowXs
    },
    brand: {
      background: hover ? "var(--brand-hover)" : "var(--brand)",
      color: "var(--brand-foreground)",
      border: "1px solid transparent",
      boxShadow: shadowXs
    },
    // Secondary = the canonical quiet action: transparent surface, subtle
    // border, foreground text/icon that inverts automatically in dark mode.
    // (Replaces the old `outline` usage; `outline` is kept below as an alias.)
    secondary: {
      background: hover ? "var(--accent)" : "transparent",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      boxShadow: shadowXs
    },
    // Ghost = no border, no surface, foreground text/icon only.
    ghost: {
      background: hover ? "var(--accent)" : "transparent",
      color: "var(--foreground)",
      border: "1px solid transparent"
    },
    destructive: {
      background: hover ? mix("var(--destructive)") : "var(--destructive)",
      color: "var(--destructive-foreground)",
      border: "1px solid transparent",
      boxShadow: shadowXs
    }
  };
  // Backward-compatible alias: `outline` now resolves to the secondary style.
  variants.outline = variants.secondary;
  const v = variants[variant] || variants.primary;

  // quiet variants render icons at 60% opacity (ReUI icon treatment)
  const quietIcon = variant === "ghost" || variant === "outline" || variant === "secondary";
  const iconStyle = {
    display: "inline-flex",
    flex: "none",
    opacity: quietIcon ? 0.6 : 1
  };
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    "data-variant": variant,
    className: "vd-button",
    onMouseEnter: e => {
      setHover(true);
      rest.onMouseEnter && rest.onMouseEnter(e);
    },
    onMouseLeave: e => {
      setHover(false);
      rest.onMouseLeave && rest.onMouseLeave(e);
    },
    onFocus: e => {
      setFocus(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur && rest.onBlur(e);
    },
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      gap: s.gap,
      height: s.height,
      padding: s.padding,
      width: fullWidth ? "100%" : "auto",
      fontFamily: "var(--font-sans)",
      fontSize: s.font,
      fontWeight: 500,
      lineHeight: 1,
      letterSpacing: "-0.01em",
      borderRadius: s.radius,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.6 : 1,
      pointerEvents: disabled ? "none" : "auto",
      whiteSpace: "nowrap",
      outline: "none",
      transition: "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
      WebkitTapHighlightColor: "transparent",
      ...v,
      ...(focus ? {
        boxShadow: `${v.boxShadow ? v.boxShadow + ", " : ""}0 0 0 2px var(--background), 0 0 0 4px var(--ring)`
      } : {}),
      ...style
    }
  }, rest), iconLeft ? /*#__PURE__*/React.createElement("span", {
    style: iconStyle
  }, iconLeft) : null, children, iconRight ? /*#__PURE__*/React.createElement("span", {
    style: iconStyle
  }, iconRight) : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Generic surface container. `interactive` adds hover elevation.
 * `padding` accepts a spacing token size (4|5|6) or any CSS value.
 */
function Card({
  interactive = false,
  padding = 6,
  header = null,
  footer = null,
  style = {},
  children,
  ...rest
}) {
  const pad = {
    4: "var(--space-4)",
    5: "var(--space-5)",
    6: "var(--space-6)"
  }[padding] || padding;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "vd-card",
    style: {
      background: "var(--card)",
      color: "var(--card-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-xl)",
      boxShadow: "var(--shadow-sm)",
      overflow: "hidden",
      transition: "box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard)",
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, rest), header ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad,
      borderBottom: "1px solid var(--border)"
    }
  }, header) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad
    }
  }, children), footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: pad,
      borderTop: "1px solid var(--border)",
      background: "var(--muted)"
    }
  }, footer) : null);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Icon-only control. Always give an aria-label; hit area stays >=32/40px.
 * Pass a Lucide (or any) icon node as `icon`.
 */
function IconButton({
  icon,
  variant = "ghost",
  size = "md",
  disabled = false,
  label,
  style = {},
  ...rest
}) {
  const sizes = {
    sm: 32,
    md: 40,
    lg: 48
  };
  const dim = sizes[size] || sizes.md;
  const variants = {
    ghost: {
      background: "transparent",
      color: "var(--foreground)",
      border: "1px solid transparent"
    },
    outline: {
      background: "transparent",
      color: "var(--foreground)",
      border: "1px solid var(--border)"
    },
    secondary: {
      background: "var(--secondary)",
      color: "var(--secondary-foreground)",
      border: "1px solid var(--secondary)"
    },
    primary: {
      background: "var(--primary)",
      color: "var(--primary-foreground)",
      border: "1px solid var(--primary)"
    },
    brand: {
      background: "var(--brand)",
      color: "var(--brand-foreground)",
      border: "1px solid var(--brand)"
    },
    glass: {
      background: "rgba(0,0,0,0.4)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.16)",
      backdropFilter: "blur(var(--blur-sm))"
    }
  };
  const v = variants[variant] || variants.ghost;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    disabled: disabled,
    className: "vd-icon-button",
    style: {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: dim,
      height: dim,
      borderRadius: "var(--radius-md)",
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "background var(--duration-fast) var(--ease-standard), transform var(--duration-fast) var(--ease-standard)",
      WebkitTapHighlightColor: "transparent",
      ...v,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex"
    }
  }, icon));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/LanguageToggle.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Minimal language toggle — segmented فارسی / English pill. Persian-first.
 * Self-contained: on select it sets `lang` on <html>, toggles the `.lang-fa`
 * Persian-webfont class, persists to localStorage, and broadcasts
 * `vidoralangchange` so `useLang()` hooks re-render. Layout stays LTR — RTL is
 * applied at the text level, not on the page wrapper. If the page's i18n
 * runtime (`window.applyVidoraLang`) is loaded it defers to that.
 */
function LanguageToggle({
  style = {},
  ...rest
}) {
  const read = () => {
    try {
      return window.localStorage.getItem("vidora-lang") || "fa";
    } catch (e) {
      return "fa";
    }
  };
  const [lang, setLang] = React.useState(read);
  React.useEffect(() => {
    const on = e => setLang(e && e.detail || read());
    window.addEventListener("vidoralangchange", on);
    return () => window.removeEventListener("vidoralangchange", on);
  }, []);
  function select(next) {
    if (next === lang) return;
    if (typeof window.applyVidoraLang === "function") {
      window.applyVidoraLang(next);
      return;
    }
    // Fallback: switch language + webfont only; keep layout LTR (no page mirroring).
    try {
      window.localStorage.setItem("vidora-lang", next);
    } catch (e) {/* ignore */}
    const h = document.documentElement;
    h.setAttribute("dir", "ltr");
    h.setAttribute("lang", next);
    h.classList.toggle("lang-fa", next === "fa");
    setLang(next);
    window.dispatchEvent(new CustomEvent("vidoralangchange", {
      detail: next
    }));
  }
  const opts = [{
    k: "fa",
    label: "فارسی"
  }, {
    k: "en",
    label: "English"
  }];
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "group",
    "aria-label": "Language",
    dir: "ltr",
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 2,
      padding: 2,
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-full)",
      background: "transparent",
      ...style
    }
  }, rest), opts.map(o => {
    const active = lang === o.k;
    return /*#__PURE__*/React.createElement("button", {
      key: o.k,
      type: "button",
      onClick: () => select(o.k),
      "aria-pressed": active,
      style: {
        appearance: "none",
        border: "none",
        cursor: "pointer",
        fontFamily: '"Vazirmatn", var(--font-sans)',
        fontSize: 12.5,
        fontWeight: 500,
        lineHeight: 1,
        padding: "6px 12px",
        borderRadius: "var(--radius-full)",
        color: active ? "var(--primary-foreground)" : "var(--muted-foreground)",
        background: active ? "var(--primary)" : "transparent",
        transition: "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
        whiteSpace: "nowrap"
      }
    }, o.label);
  }));
}
Object.assign(__ds_scope, { LanguageToggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/LanguageToggle.jsx", error: String((e && e.message) || e) }); }

// components/feedback/ProgressBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Linear progress. Use for uploads, subtitle generation and watch progress.
 * `tone="brand"` for AI/processing; `indeterminate` for unknown duration.
 */
function ProgressBar({
  value = 0,
  tone = "brand",
  size = "md",
  indeterminate = false,
  style = {},
  ...rest
}) {
  const heights = {
    sm: 4,
    md: 6,
    lg: 8
  };
  const h = heights[size] || heights.md;
  const fill = {
    brand: "var(--brand)",
    neutral: "var(--foreground)",
    success: "var(--success)"
  }[tone] || "var(--brand)";
  const pct = Math.max(0, Math.min(100, value));
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "progressbar",
    "aria-valuenow": indeterminate ? undefined : pct,
    style: {
      position: "relative",
      width: "100%",
      height: h,
      borderRadius: "var(--radius-full)",
      background: "var(--muted)",
      overflow: "hidden",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: indeterminate ? "40%" : pct + "%",
      background: fill,
      borderRadius: "var(--radius-full)",
      transition: indeterminate ? "none" : "width var(--duration-slow) var(--ease-standard)",
      animation: indeterminate ? "vd-indeterminate 1.2s var(--ease-in-out) infinite" : "none"
    }
  }), /*#__PURE__*/React.createElement("style", null, `@keyframes vd-indeterminate{0%{left:-40%}100%{left:100%}}`));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Shimmer placeholder for loading states. */
function Skeleton({
  width = "100%",
  height = 16,
  radius = "var(--radius-md)",
  circle = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    "aria-hidden": "true",
    style: {
      display: "block",
      width,
      height: circle ? width : height,
      borderRadius: circle ? "50%" : radius,
      background: "linear-gradient(90deg, var(--muted) 25%, color-mix(in oklch, var(--muted) 60%, var(--secondary)) 37%, var(--muted) 63%)",
      backgroundSize: "400% 100%",
      animation: "vd-shimmer 1.4s ease infinite",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("style", null, `@keyframes vd-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}`));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Spinner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Circular loading spinner. Sizes match the icon grid. */
function Spinner({
  size = 20,
  tone = "brand",
  strokeWidth = 2.5,
  style = {},
  ...rest
}) {
  const color = {
    brand: "var(--brand)",
    neutral: "var(--muted-foreground)",
    inverse: "#fff"
  }[tone] || "var(--brand)";
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: "inline-flex",
      width: size,
      height: size,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    style: {
      animation: "vd-spin 0.8s linear infinite"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "9",
    stroke: "currentColor",
    strokeOpacity: "0.18",
    strokeWidth: strokeWidth,
    style: {
      color
    }
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 0 0-9-9",
    stroke: color,
    strokeWidth: strokeWidth,
    strokeLinecap: "round"
  })), /*#__PURE__*/React.createElement("style", null, `@keyframes vd-spin{to{transform:rotate(360deg)}}`));
}
Object.assign(__ds_scope, { Spinner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Spinner.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Toast / inline notification. Presentational — parent controls mount/unmount.
 * `tone` sets the accent; pass an `icon` node and optional `action`.
 */
function Toast({
  tone = "neutral",
  title,
  description,
  icon = null,
  action = null,
  onClose,
  style = {},
  ...rest
}) {
  const accents = {
    neutral: "var(--foreground)",
    brand: "var(--brand)",
    success: "var(--success)",
    warning: "var(--warning)",
    destructive: "var(--destructive)"
  };
  const accent = accents[tone] || accents.neutral;
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "status",
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 12,
      width: 360,
      maxWidth: "100%",
      padding: "14px 14px 14px 16px",
      background: "var(--popover)",
      color: "var(--popover-foreground)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-lg)",
      position: "relative",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      top: 12,
      bottom: 12,
      width: 3,
      borderRadius: "var(--radius-full)",
      background: accent
    }
  }), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: accent,
      flex: "none",
      marginTop: 1
    }
  }, icon) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      fontWeight: 600,
      lineHeight: 1.4
    }
  }, title) : null, description ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      color: "var(--muted-foreground)",
      lineHeight: 1.5,
      marginTop: 2
    }
  }, description) : null, action ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, action) : null), onClose ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onClose,
    style: {
      display: "inline-flex",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      padding: 2,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))) : null);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Checkbox with a custom check glyph. Controlled via `checked`. */
function Checkbox({
  checked = false,
  disabled = false,
  label,
  onChange,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      color: "var(--foreground)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 18,
      height: 18,
      flex: "none",
      borderRadius: "var(--radius-sm)",
      border: `1px solid ${checked ? "var(--brand)" : "var(--border)"}`,
      background: checked ? "var(--brand)" : "var(--card)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      transition: "background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard)"
    }
  }, checked ? /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--brand-foreground)",
    strokeWidth: "3",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  })) : null), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    disabled: disabled,
    onChange: onChange
  }, rest, {
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  })), label ? /*#__PURE__*/React.createElement("span", null, label) : null);
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input. Optional leading/trailing icon nodes and error state.
 * Focus shows the brand ring.
 */
function Input({
  size = "md",
  iconLeft = null,
  iconRight = null,
  invalid = false,
  disabled = false,
  style = {},
  wrapStyle = {},
  ...rest
}) {
  const heights = {
    sm: 36,
    md: 40,
    lg: 48
  };
  const h = heights[size] || heights.md;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      height: h,
      padding: "0 12px",
      background: "var(--card)",
      border: `1px solid ${invalid ? "var(--destructive)" : focused ? "var(--brand)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      boxShadow: focused && !invalid ? "var(--glow-brand)" : "none",
      transition: "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
      opacity: disabled ? 0.5 : 1,
      ...wrapStyle
    }
  }, iconLeft ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, iconLeft) : null, /*#__PURE__*/React.createElement("input", _extends({
    disabled: disabled,
    onFocus: e => {
      setFocused(true);
      rest.onFocus && rest.onFocus(e);
    },
    onBlur: e => {
      setFocused(false);
      rest.onBlur && rest.onBlur(e);
    }
  }, rest, {
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      lineHeight: 1.4,
      ...style
    }
  })), iconRight ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }, iconRight) : null);
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/SearchBar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Prominent search field used across discovery. Pill-shaped, with a
 * leading search glyph and optional clear button. Purely cosmetic here.
 */
function SearchBar({
  value = "",
  placeholder = "Search videos, courses, topics…",
  size = "md",
  onChange,
  onClear,
  style = {},
  ...rest
}) {
  const heights = {
    md: 44,
    lg: 52
  };
  const h = heights[size] || heights.md;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: h,
      padding: "0 16px",
      background: "var(--card)",
      border: `1px solid ${focused ? "var(--brand)" : "var(--border)"}`,
      borderRadius: "var(--radius-full)",
      boxShadow: focused ? "var(--glow-brand)" : "var(--shadow-xs)",
      transition: "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted-foreground)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m21 21-4.3-4.3"
  })), /*#__PURE__*/React.createElement("input", _extends({
    value: value,
    placeholder: placeholder,
    onChange: onChange,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, rest, {
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)"
    }
  })), value ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Clear",
    onClick: onClear,
    style: {
      display: "inline-flex",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: "var(--muted-foreground)",
      padding: 2
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18M6 6l12 12"
  }))) : null);
}
Object.assign(__ds_scope, { SearchBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SearchBar.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Native select styled to match Vidora inputs, with a chevron affordance.
 */
function Select({
  size = "md",
  invalid = false,
  disabled = false,
  options = [],
  placeholder,
  style = {},
  ...rest
}) {
  const heights = {
    sm: 36,
    md: 40,
    lg: 48
  };
  const h = heights[size] || heights.md;
  const [focused, setFocused] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "inline-flex",
      alignItems: "center",
      height: h,
      background: "var(--card)",
      border: `1px solid ${invalid ? "var(--destructive)" : focused ? "var(--brand)" : "var(--border)"}`,
      borderRadius: "var(--radius-md)",
      boxShadow: focused && !invalid ? "var(--glow-brand)" : "none",
      transition: "border-color var(--duration-fast) var(--ease-standard), box-shadow var(--duration-fast) var(--ease-standard)",
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, /*#__PURE__*/React.createElement("select", _extends({
    disabled: disabled,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false)
  }, rest, {
    style: {
      appearance: "none",
      WebkitAppearance: "none",
      border: "none",
      outline: "none",
      background: "transparent",
      color: "var(--foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      height: "100%",
      padding: "0 34px 0 12px",
      cursor: disabled ? "not-allowed" : "pointer",
      width: "100%"
    }
  }), placeholder ? /*#__PURE__*/React.createElement("option", {
    value: ""
  }, placeholder) : null, options.map(o => {
    const value = typeof o === "string" ? o : o.value;
    const label = typeof o === "string" ? o : o.label;
    return /*#__PURE__*/React.createElement("option", {
      key: value,
      value: value
    }, label);
  })), /*#__PURE__*/React.createElement("svg", {
    width: "16",
    height: "16",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "var(--muted-foreground)",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      position: "absolute",
      right: 10,
      pointerEvents: "none"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  })));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** On/off switch. Controlled via `checked`. Brand fill when on. */
function Switch({
  checked = false,
  disabled = false,
  label,
  onChange,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      color: "var(--foreground)",
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 36,
      height: 20,
      flex: "none",
      borderRadius: "var(--radius-full)",
      background: checked ? "var(--brand)" : "var(--input)",
      position: "relative",
      transition: "background var(--duration-base) var(--ease-standard)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 2,
      left: checked ? 18 : 2,
      width: 16,
      height: 16,
      borderRadius: "50%",
      background: "#fff",
      boxShadow: "var(--shadow-sm)",
      transition: "left var(--duration-base) var(--ease-standard)"
    }
  })), /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: checked,
    disabled: disabled,
    onChange: onChange
  }, rest, {
    style: {
      position: "absolute",
      opacity: 0,
      width: 0,
      height: 0
    }
  })), label ? /*#__PURE__*/React.createElement("span", null, label) : null);
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/media/CategoryChip.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill filter chip for category / topic rows. `active` selected state,
 * optional leading `icon` node.
 */
function CategoryChip({
  label,
  icon = null,
  active = false,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-pressed": active,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      height: 34,
      padding: icon ? "0 14px 0 11px" : "0 14px",
      border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
      borderRadius: "var(--radius-full)",
      background: active ? "var(--primary)" : "var(--card)",
      color: active ? "var(--primary-foreground)" : "var(--foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      fontWeight: 500,
      cursor: "pointer",
      whiteSpace: "nowrap",
      transition: "background var(--duration-fast) var(--ease-standard), border-color var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      flex: "none"
    }
  }, icon) : null, label);
}
Object.assign(__ds_scope, { CategoryChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/CategoryChip.jsx", error: String((e && e.message) || e) }); }

// components/media/LanguageBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Language indicator / picker trigger. Shows a globe, language name and a
 * chevron. `translated` marks AI-translated availability (brand tint).
 */
function LanguageBadge({
  language = "English",
  translated = false,
  interactive = true,
  style = {},
  ...rest
}) {
  const Tag = interactive ? "button" : "span";
  return /*#__PURE__*/React.createElement(Tag, _extends({
    type: interactive ? "button" : undefined,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      height: 32,
      padding: "0 10px",
      border: `1px solid ${translated ? "transparent" : "var(--border)"}`,
      borderRadius: "var(--radius-full)",
      background: translated ? "var(--brand-subtle)" : "var(--card)",
      color: translated ? "var(--brand-subtle-foreground)" : "var(--foreground)",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      fontWeight: 500,
      cursor: interactive ? "pointer" : "default",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("svg", {
    width: "15",
    height: "15",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      flex: "none",
      color: translated ? "var(--brand)" : "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"
  })), language, interactive ? /*#__PURE__*/React.createElement("svg", {
    width: "14",
    height: "14",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      opacity: 0.6,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "m6 9 6 6 6-6"
  })) : null);
}
Object.assign(__ds_scope, { LanguageBadge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/LanguageBadge.jsx", error: String((e && e.message) || e) }); }

// components/media/PlayerControls.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const IC = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round"
};

/**
 * Dark player control bar (always dark, both themes). Presentational:
 * play/pause, seekbar with buffered + progress, time, volume, CC toggle,
 * language, settings, fullscreen. Wire the callbacks to real state.
 */
function PlayerControls({
  playing = false,
  progress = 30,
  buffered = 50,
  current = "03:04",
  total = "10:12",
  captions = true,
  language = "English",
  onPlayPause,
  onToggleCaptions,
  onOpenLanguage,
  style = {},
  ...rest
}) {
  const iconBtn = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    border: "none",
    background: "transparent",
    color: "#fff",
    cursor: "pointer",
    borderRadius: "var(--radius-md)"
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: "var(--gradient-scrim-bottom)",
      padding: "24px 14px 12px",
      fontFamily: "var(--font-sans)",
      color: "#fff",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      height: 5,
      borderRadius: "var(--radius-full)",
      background: "rgba(255,255,255,0.24)",
      marginBottom: 8,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: buffered + "%",
      background: "rgba(255,255,255,0.28)",
      borderRadius: "var(--radius-full)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: progress + "%",
      background: "var(--brand)",
      borderRadius: "var(--radius-full)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: `calc(${progress}% - 6px)`,
      top: "50%",
      transform: "translateY(-50%)",
      width: 12,
      height: 12,
      borderRadius: "50%",
      background: "#fff",
      boxShadow: "0 1px 3px rgba(0,0,0,0.5)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, /*#__PURE__*/React.createElement("button", {
    "aria-label": playing ? "Pause" : "Play",
    onClick: onPlayPause,
    style: iconBtn
  }, playing ? /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "5",
    width: "4",
    height: "14",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "5",
    width: "4",
    height: "14",
    rx: "1"
  })) : /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 5.5v13l11-6.5-11-6.5Z"
  }))), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Next",
    style: iconBtn
  }, /*#__PURE__*/React.createElement("svg", {
    width: "18",
    height: "18",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M6 5.5v13l9-6.5-9-6.5Z"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "16",
    y: "5",
    width: "3",
    height: "14",
    rx: "1"
  }))), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Volume",
    style: iconBtn
  }, /*#__PURE__*/React.createElement("svg", _extends({
    width: "19",
    height: "19",
    viewBox: "0 0 24 24"
  }, IC), /*#__PURE__*/React.createElement("path", {
    d: "M11 5 6 9H2v6h4l5 4V5Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-sm)",
      color: "rgba(255,255,255,0.9)",
      marginLeft: 6
    }
  }, current, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "rgba(255,255,255,0.5)"
    }
  }, "/ ", total)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Language",
    onClick: onOpenLanguage,
    style: {
      ...iconBtn,
      width: "auto",
      gap: 6,
      padding: "0 10px",
      fontSize: "var(--text-sm)",
      fontWeight: 500
    }
  }, /*#__PURE__*/React.createElement("svg", _extends({
    width: "17",
    height: "17",
    viewBox: "0 0 24 24"
  }, IC), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 12h20M12 2a15.3 15.3 0 0 1 0 20M12 2a15.3 15.3 0 0 0 0 20"
  })), language), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Subtitles",
    "aria-pressed": captions,
    onClick: onToggleCaptions,
    style: {
      ...iconBtn,
      position: "relative"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "5",
    width: "20",
    height: "14",
    rx: "2.5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 12.5h2M7 15h4M13 12.5h4M15 15h2"
  })), captions ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: 5,
      height: 2,
      borderRadius: 2,
      background: "var(--brand)"
    }
  }) : null), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Settings",
    style: iconBtn
  }, /*#__PURE__*/React.createElement("svg", _extends({
    width: "19",
    height: "19",
    viewBox: "0 0 24 24"
  }, IC), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9 2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5 2 2 0 1 1 4 0 1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1 2 2 0 1 1 0 4 1.7 1.7 0 0 0-1.5 1Z"
  }))), /*#__PURE__*/React.createElement("button", {
    "aria-label": "Fullscreen",
    style: iconBtn
  }, /*#__PURE__*/React.createElement("svg", _extends({
    width: "19",
    height: "19",
    viewBox: "0 0 24 24"
  }, IC), /*#__PURE__*/React.createElement("path", {
    d: "M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"
  })))));
}
Object.assign(__ds_scope, { PlayerControls });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/PlayerControls.jsx", error: String((e && e.message) || e) }); }

// components/media/PosterCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Portrait (2:3) poster for courses, documentaries and biographies.
 * Title + optional eyebrow sit on a scrim over the artwork.
 */
function PosterCard({
  title = "Untitled",
  eyebrow,
  thumbnail,
  badge = null,
  size = "md",
  style = {},
  ...rest
}) {
  const widths = {
    sm: 150,
    md: 190,
    lg: 230
  };
  const w = widths[size] || widths.md;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "vd-poster-card",
    style: {
      position: "relative",
      width: w,
      maxWidth: "100%",
      aspectRatio: "2 / 3",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      cursor: "pointer",
      background: thumbnail || "var(--secondary)",
      backgroundSize: "cover",
      backgroundPosition: "center",
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-sm)",
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, rest), !thumbnail ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      opacity: 0.4
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "30",
    height: "30",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 5.5v13l11-6.5-11-6.5Z"
  }))) : null, badge ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 8,
      left: 8
    }
  }, badge) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      padding: "28px 12px 12px",
      background: "var(--gradient-scrim-bottom)"
    }
  }, eyebrow ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-xs)",
      fontWeight: 600,
      letterSpacing: "var(--tracking-caps)",
      textTransform: "uppercase",
      color: "rgba(255,255,255,0.75)",
      marginBottom: 4
    }
  }, eyebrow) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 600,
      lineHeight: 1.3,
      color: "#fff",
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical",
      overflow: "hidden"
    }
  }, title)));
}
Object.assign(__ds_scope, { PosterCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/PosterCard.jsx", error: String((e && e.message) || e) }); }

// components/media/TranscriptLine.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * A single transcript / subtitle line: mono timestamp + text. `active`
 * highlights the current line (brand text + subtle fill); `bilingual`
 * shows the translated text beneath the original.
 */
function TranscriptLine({
  time = "00:00",
  text = "",
  translation = null,
  active = false,
  onClick,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    onClick: onClick,
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 14,
      width: "100%",
      textAlign: "left",
      padding: "10px 12px",
      border: "none",
      borderRadius: "var(--radius-md)",
      background: active ? "var(--brand-subtle)" : "transparent",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      transition: "background var(--duration-fast) var(--ease-standard)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
      color: active ? "var(--brand)" : "var(--muted-foreground)",
      paddingTop: 2,
      flex: "none",
      width: 44
    }
  }, time), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-sm)",
      lineHeight: 1.55,
      color: active ? "var(--foreground)" : "var(--foreground)",
      fontWeight: active ? 500 : 400
    }
  }, text), translation ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: "var(--text-sm)",
      lineHeight: 1.55,
      color: "var(--muted-foreground)",
      marginTop: 2
    }
  }, translation) : null));
}
Object.assign(__ds_scope, { TranscriptLine });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/TranscriptLine.jsx", error: String((e && e.message) || e) }); }

// components/media/VideoCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Landscape (16:9) video card for feeds and rows. Thumbnail + title + source
 * meta. Shows a watch-progress bar, duration chip, and an optional
 * "translated" brand badge. `thumbnail` is a CSS background (url/gradient);
 * a neutral placeholder is shown when absent.
 */
function VideoCard({
  title = "Untitled",
  source,
  meta,
  duration,
  thumbnail,
  progress = null,
  translated = false,
  size = "md",
  style = {},
  ...rest
}) {
  const widths = {
    sm: 240,
    md: 300,
    lg: 360
  };
  const w = widths[size] || widths.md;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: "vd-video-card",
    style: {
      width: w,
      maxWidth: "100%",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16 / 9",
      borderRadius: "var(--radius-xl)",
      overflow: "hidden",
      background: thumbnail || "var(--secondary)",
      backgroundSize: "cover",
      backgroundPosition: "center",
      border: "1px solid var(--border)",
      boxShadow: "var(--shadow-xs)"
    }
  }, !thumbnail ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted-foreground)",
      opacity: 0.5
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "34",
    height: "34",
    viewBox: "0 0 24 24",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M8 5.5v13l11-6.5-11-6.5Z"
  }))) : null, translated ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      top: 8,
      left: 8,
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "3px 8px",
      borderRadius: "var(--radius-full)",
      background: "var(--brand)",
      color: "var(--brand-foreground)",
      fontSize: "var(--text-xs)",
      fontWeight: 600
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "12",
    height: "12",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("path", {
    d: "m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"
  })), "Translated") : null, duration ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      bottom: 8,
      right: 8,
      padding: "2px 6px",
      borderRadius: "var(--radius-sm)",
      background: "rgba(0,0,0,0.78)",
      color: "#fff",
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
      fontWeight: 500
    }
  }, duration) : null, progress != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: 0,
      right: 0,
      bottom: 0,
      height: 3,
      background: "rgba(255,255,255,0.28)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      height: "100%",
      width: Math.max(0, Math.min(100, progress)) + "%",
      background: "var(--brand)"
    }
  })) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "10px 2px 0"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      fontWeight: 600,
      lineHeight: 1.35,
      color: "var(--foreground)",
      display: "-webkit-box",
      WebkitLineClamp: 2,
      WebkitBoxOrient: "vertical",
      overflow: "hidden"
    }
  }, title), source ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-sm)",
      color: "var(--muted-foreground)",
      marginTop: 4
    }
  }, source) : null, meta ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: "var(--text-xs)",
      color: "var(--muted-foreground)",
      marginTop: 2
    }
  }, meta) : null));
}
Object.assign(__ds_scope, { VideoCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/media/VideoCard.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Breadcrumb.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Breadcrumb trail. `items` = [{label, href?}]. Last item is current.
 */
function Breadcrumb({
  items = [],
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("nav", _extends({
    "aria-label": "Breadcrumb",
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      ...style
    }
  }, rest), items.map((it, i) => {
    const last = i === items.length - 1;
    return /*#__PURE__*/React.createElement(React.Fragment, {
      key: i
    }, last ? /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--foreground)",
        fontWeight: 500
      },
      "aria-current": "page"
    }, it.label) : /*#__PURE__*/React.createElement("a", {
      href: it.href || "#",
      style: {
        color: "var(--muted-foreground)",
        textDecoration: "none"
      }
    }, it.label), !last ? /*#__PURE__*/React.createElement("svg", {
      width: "14",
      height: "14",
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "var(--muted-foreground)",
      strokeWidth: "2",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      style: {
        opacity: 0.6
      }
    }, /*#__PURE__*/React.createElement("path", {
      d: "m9 18 6-6-6-6"
    })) : null);
  }));
}
Object.assign(__ds_scope, { Breadcrumb });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Breadcrumb.jsx", error: String((e && e.message) || e) }); }

// components/navigation/NavItem.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Sidebar navigation item. Pass a Lucide `icon`. `active` uses a brand-subtle
 * fill + brand text; `collapsed` hides the label (icon-rail mode).
 */
function NavItem({
  icon = null,
  label,
  active = false,
  collapsed = false,
  badge = null,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-current": active ? "page" : undefined,
    title: collapsed ? label : undefined,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      height: 40,
      padding: collapsed ? "0" : "0 12px",
      justifyContent: collapsed ? "center" : "flex-start",
      border: "none",
      borderRadius: "var(--radius-md)",
      background: active ? "var(--brand-subtle)" : "transparent",
      color: active ? "var(--brand-subtle-foreground)" : "var(--foreground)",
      cursor: "pointer",
      fontFamily: "var(--font-sans)",
      fontSize: "var(--text-sm)",
      fontWeight: active ? 600 : 500,
      transition: "background var(--duration-fast) var(--ease-standard), color var(--duration-fast) var(--ease-standard)",
      ...style
    }
  }, rest), icon ? /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      flex: "none",
      color: active ? "var(--brand)" : "var(--muted-foreground)"
    }
  }, icon) : null, !collapsed ? /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: "left"
    }
  }, label) : null, !collapsed && badge != null ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-xs)",
      color: "var(--muted-foreground)"
    }
  }, badge) : null);
}
Object.assign(__ds_scope, { NavItem });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/NavItem.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Horizontal tabs with an underline indicator. Controlled via `value`.
 * `items` = [{value,label,count?}].
 */
function Tabs({
  items = [],
  value,
  onChange,
  style = {},
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    role: "tablist",
    style: {
      display: "flex",
      gap: 4,
      borderBottom: "1px solid var(--border)",
      ...style
    }
  }, rest), items.map(it => {
    const active = it.value === value;
    return /*#__PURE__*/React.createElement("button", {
      key: it.value,
      role: "tab",
      "aria-selected": active,
      onClick: () => onChange && onChange(it.value),
      style: {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "10px 12px",
        border: "none",
        background: "transparent",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
        fontWeight: active ? 600 : 500,
        color: active ? "var(--foreground)" : "var(--muted-foreground)",
        transition: "color var(--duration-fast) var(--ease-standard)"
      }
    }, it.label, it.count != null ? /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: "var(--text-xs)",
        color: "var(--muted-foreground)",
        background: "var(--muted)",
        borderRadius: "var(--radius-full)",
        padding: "1px 7px"
      }
    }, it.count) : null, /*#__PURE__*/React.createElement("span", {
      style: {
        position: "absolute",
        left: 8,
        right: 8,
        bottom: -1,
        height: 2,
        borderRadius: "var(--radius-full)",
        background: active ? "var(--foreground)" : "transparent",
        transition: "background var(--duration-fast) var(--ease-standard)"
      }
    }));
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/_shared/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Shared Vidora icon set — real Lucide 24×24 path data (lucide.dev, ISC),
// rendered inline as React so UI kits have no network dependency.
// Usage: <Icon name="home" size={20} />  (stroke 1.75, currentColor)
const VD_ICON_PATHS = {
  home: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z|M9 22V12h6v10",
  compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z",
  library: "m16 6 4 14|M12 6v14|M8 8v12|M4 4v16",
  graduation: "M22 10 12 5 2 10l10 5 10-5Z|M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5",
  newspaper: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2|M18 14h-8|M15 18h-5|M10 6h8v4h-8Z",
  film: "M3 3h18v18H3Z|M7 3v18|M17 3v18|M3 7.5h4|M17 7.5h4|M3 12h18|M3 16.5h4|M17 16.5h4",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|m21 21-4.3-4.3",
  heart: "M19 14c1.5-1.5 3-3.3 3-5.5A3.5 3.5 0 0 0 12 5 3.5 3.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7 7-7Z",
  bookmark: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z",
  plus: "M12 5v14|M5 12h14",
  settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  bell: "M10.27 21a2 2 0 0 0 3.46 0|M4 17h16l-1.6-2.1a2 2 0 0 1-.4-1.2V10a6 6 0 0 0-12 0v3.7c0 .43-.14.85-.4 1.2Z",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronLeft: "m15 18-6-6 6-6",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M2 12h20|M12 2a15.3 15.3 0 0 1 0 20|M12 2a15.3 15.3 0 0 0 0 20",
  languages: "m5 8 6 6|M4 14l6-6 2-3|M2 5h12|M7 2h1|m22 22-5-10-5 10|M14 18h6",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z|M19 3v4|M21 5h-4",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5|M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18|M6 6l12 12",
  menu: "M4 6h16|M4 12h16|M4 18h16",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M12 6v6l4 2",
  arrowRight: "M5 12h14|m12 5 7 7-7 7",
  star: "M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1Z",
  volume: "M11 5 6 9H2v6h4l5 4V5Z|M15.5 8.5a5 5 0 0 1 0 7|M18.5 5.5a9 9 0 0 1 0 13",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3|M16 3h3a2 2 0 0 1 2 2v3|M8 21H5a2 2 0 0 1-2-2v-3|M16 21h3a2 2 0 0 0 2-2v-3",
  subtitles: "M2 7.5A2.5 2.5 0 0 1 4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5Z|M7 13h2|M7 16h5|M13 13h4|M15 16h2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9",
  card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z|M2 10h20",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8|M16 6l-4-4-4 4|M12 2v13",
  trending: "m22 7-8.5 8.5-5-5L2 17|M16 7h6v6",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
  list: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
  cpu: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z|M9 9h6v6H9Z|M15 2v2|M15 20v2|M2 15h2|M2 9h2|M20 15h2|M20 9h2|M9 2v2|M9 20v2",
  lock: "M7 11V7a5 5 0 0 1 10 0v4|M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z",
  fileText: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v4a2 2 0 0 0 2 2h4|M16 13H8|M16 17H8|M10 9H8"
};
const VD_FILLED = {
  play: "M8 5.5v13l11-6.5-11-6.5Z",
  pause: ""
};
function Icon({
  name,
  size = 20,
  stroke = 1.75,
  fill = false,
  style = {},
  ...rest
}) {
  if (name === "play") {
    return /*#__PURE__*/React.createElement("svg", _extends({
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      style: {
        display: "block",
        ...style
      }
    }, rest), /*#__PURE__*/React.createElement("path", {
      d: "M8 5.5v13l11-6.5-11-6.5Z"
    }));
  }
  if (name === "pause") {
    return /*#__PURE__*/React.createElement("svg", _extends({
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "currentColor",
      style: {
        display: "block",
        ...style
      }
    }, rest), /*#__PURE__*/React.createElement("rect", {
      x: "6",
      y: "5",
      width: "4",
      height: "14",
      rx: "1"
    }), /*#__PURE__*/React.createElement("rect", {
      x: "14",
      y: "5",
      width: "4",
      height: "14",
      rx: "1"
    }));
  }
  const d = VD_ICON_PATHS[name] || "";
  const segs = d.split("|");
  return /*#__PURE__*/React.createElement("svg", _extends({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: fill ? "currentColor" : "none",
    stroke: fill ? "none" : "currentColor",
    strokeWidth: stroke,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      display: "block",
      ...style
    }
  }, rest), segs.map((p, i) => /*#__PURE__*/React.createElement("path", {
    key: i,
    d: p
  })));
}
window.Icon = Icon;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/_shared/icons.jsx", error: String((e && e.message) || e) }); }

// ui_kits/_shared/image-slot.js
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)
/* BEGIN USAGE */
/**
 * <image-slot> — user-fillable image placeholder.
 *
 * Drop this into a deck, mockup, or page wherever you want the user to
 * supply an image. You control the slot's shape and size; the user fills it
 * by dragging an image file onto it (or clicking to browse). The dropped
 * image persists across reloads via a .image-slots.state.json sidecar —
 * same read-via-fetch / write-via-window.omelette pattern as
 * design_canvas.jsx, so the filled slot shows on share links, downloaded
 * zips, and PPTX export. Outside the omelette runtime the slot is read-only.
 *
 * The host bridge only allows sidecar writes at the project root, so the
 * HTML that uses this component is assumed to live at the project root too
 * (same constraint as design_canvas.jsx).
 *
 * Attributes:
 *   id           Persistence key. REQUIRED for the drop to survive reload —
 *                every slot on the page needs a distinct id.
 *   shape        'rect' | 'rounded' | 'circle' | 'pill'   (default 'rounded')
 *                'circle' applies 50% border-radius; on a non-square slot
 *                that's an ellipse — set equal width and height for a true
 *                circle.
 *   radius       Corner radius in px for 'rounded'.       (default 12)
 *   mask         Any CSS clip-path value. Overrides `shape` — use this for
 *                hexagons, blobs, arbitrary polygons.
 *   fit          object-fit: cover | contain | fill.       (default 'cover')
 *                With cover (the default) double-clicking the filled slot
 *                enters a reframe mode: the whole image spills past the mask
 *                (translucent outside, opaque inside), drag to reposition,
 *                corner-drag to scale. The crop persists alongside the image
 *                in the sidecar. contain/fill stay static.
 *   position     object-position for fit=contain|fill.     (default '50% 50%')
 *   placeholder  Empty-state caption.                      (default 'Drop an image')
 *   src          Optional initial/fallback image URL. A user drop overrides
 *                it; clearing the drop reveals src again.
 *   credit       Optional attribution text (e.g. 'Photo by Jane Doe on
 *                Unsplash') shown as a small overlay at the bottom-left of
 *                the filled slot. It belongs to the src image, so it only
 *                shows while src is what's displayed — a user-dropped
 *                image hides it.
 *   credit-href  Optional link for the credit overlay (e.g. the
 *                photographer's profile). http(s) URLs only — anything
 *                else renders the credit as plain text.
 *
 * Size and layout come from ordinary CSS on the element — width/height
 * inline or from a parent grid — so it composes with any layout.
 *
 * Usage:
 *   <image-slot id="hero"   style="width:800px;height:450px" shape="rounded" radius="20"
 *               placeholder="Drop a hero image"></image-slot>
 *   <image-slot id="avatar" style="width:120px;height:120px" shape="circle"></image-slot>
 *   <image-slot id="kite"   style="width:300px;height:300px"
 *               mask="polygon(50% 0, 100% 50%, 50% 100%, 0 50%)"></image-slot>
 */
/* END USAGE */

(() => {
  const STATE_FILE = '.image-slots.state.json';
  // 2× a ~600px slot in a 1920-wide deck — retina-sharp without making the
  // sidecar enormous. A 1200px WebP at q=0.85 is ~150-300KB.
  const MAX_DIM = 1200;
  // Raster formats only. SVG is excluded (can carry script; createImageBitmap
  // on SVG blobs is inconsistent). GIF is excluded because the canvas
  // re-encode keeps only the first frame, so an animated GIF would silently
  // go still — better to reject than surprise.
  const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/avif'];

  // ── Shared sidecar store ────────────────────────────────────────────────
  // One fetch + immediate write-on-change for every <image-slot> on the
  // page. Reads via fetch() so viewing works anywhere the HTML and sidecar
  // are served together; writes go through window.omelette.writeFile, which
  // the host allowlists to *.state.json basenames only.
  const subs = new Set();
  let slots = {};
  // ids explicitly cleared before the sidecar fetch resolved — otherwise
  // the merge below can't tell "never set" from "just deleted" and would
  // resurrect the sidecar's stale value.
  const tombstones = new Set();
  let loaded = false;
  let loadP = null;
  function load() {
    if (loadP) return loadP;
    loadP = fetch(STATE_FILE).then(r => r.ok ? r.json() : null).then(j => {
      // Merge: sidecar loses to any in-memory change that raced ahead of
      // the fetch (drop or clear) so neither is clobbered by hydration.
      if (j && typeof j === 'object') {
        const merged = Object.assign({}, j, slots);
        // A framing-only write that raced ahead of hydration must not
        // drop a user image that's only on disk — inherit u from the
        // sidecar for any in-memory entry that lacks one.
        for (const k in slots) {
          if (merged[k] && !merged[k].u && j[k]) {
            merged[k].u = typeof j[k] === 'string' ? j[k] : j[k].u;
          }
        }
        for (const id of tombstones) delete merged[id];
        slots = merged;
      }
      tombstones.clear();
    }).catch(() => {}).then(() => {
      loaded = true;
      subs.forEach(fn => fn());
    });
    return loadP;
  }

  // Serialize writes so two near-simultaneous drops on different slots
  // can't reorder at the backend and leave the sidecar with only the
  // first. A save requested mid-flight just marks dirty and re-fires on
  // completion with the then-current slots.
  let saving = false;
  let saveDirty = false;
  function save() {
    if (saving) {
      saveDirty = true;
      return;
    }
    const w = window.omelette && window.omelette.writeFile;
    if (!w) return;
    saving = true;
    Promise.resolve(w(STATE_FILE, JSON.stringify(slots))).catch(() => {}).then(() => {
      saving = false;
      if (saveDirty) {
        saveDirty = false;
        save();
      }
    });
  }
  const S_MAX = 5;
  const clampS = s => Math.max(1, Math.min(S_MAX, s));

  // Normalize a stored slot value. Pre-reframe sidecars stored a bare
  // data-URL string; newer ones store {u, s, x, y}. Either shape is valid.
  function getSlot(id) {
    const v = slots[id];
    if (!v) return null;
    return typeof v === 'string' ? {
      u: v,
      s: 1,
      x: 0,
      y: 0
    } : v;
  }
  function setSlot(id, val) {
    if (!id) return;
    if (val) {
      slots[id] = val;
      tombstones.delete(id);
    } else {
      delete slots[id];
      if (!loaded) tombstones.add(id);
    }
    subs.forEach(fn => fn());
    // A drop is rare + high-value — write immediately so nav-away can't lose
    // it. Gate on the initial read so we don't overwrite a sidecar we haven't
    // merged yet; the merge in load() keeps this change once the read lands.
    if (loaded) save();else load().then(save);
  }

  // ── Image downscale ─────────────────────────────────────────────────────
  // Encode through a canvas so the sidecar carries resized bytes, not the
  // raw upload. Longest side is capped at 2× the slot's rendered width
  // (retina) and at MAX_DIM. WebP keeps alpha and is ~10× smaller than PNG
  // for photos, so there's no need for per-image format picking.
  async function toDataUrl(file, targetW) {
    const bitmap = await createImageBitmap(file);
    try {
      const cap = Math.min(MAX_DIM, Math.max(1, Math.round(targetW * 2)) || MAX_DIM);
      const scale = Math.min(1, cap / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
      return canvas.toDataURL('image/webp', 0.85);
    } finally {
      bitmap.close && bitmap.close();
    }
  }

  // ── Custom element ──────────────────────────────────────────────────────
  const stylesheet = ':host{display:inline-block;position:relative;vertical-align:top;' + '  font:13px/1.3 system-ui,-apple-system,sans-serif;color:rgba(0,0,0,.55);width:240px;height:160px}' + '.frame{position:absolute;inset:0;overflow:hidden;background:rgba(0,0,0,.04)}' +
  // .frame img (clipped) and .spill (unclipped ghost + handles) share the
  // same left/top/width/height in frame-%, computed by _applyView(), so the
  // inside-mask crop and the outside-mask spill stay pixel-aligned.
  '.frame img{position:absolute;max-width:none;transform:translate(-50%,-50%);' + '  -webkit-user-drag:none;user-select:none;touch-action:none}' +
  // Reframe mode (double-click): the full image spills past the mask. The
  // spill layer is sized to the IMAGE bounds so its corners are where the
  // resize handles belong. The ghost <img> inside is translucent; the real
  // clipped <img> underneath shows the opaque in-mask crop.
  '.spill{position:absolute;transform:translate(-50%,-50%);display:none;z-index:1;' + '  cursor:grab;touch-action:none}' + ':host([data-panning]) .spill{cursor:grabbing}' + '.spill .ghost{position:absolute;inset:0;width:100%;height:100%;opacity:.35;' + '  pointer-events:none;-webkit-user-drag:none;user-select:none;' + '  box-shadow:0 0 0 1px rgba(0,0,0,.2),0 12px 32px rgba(0,0,0,.2)}' + '.spill .handle{position:absolute;width:12px;height:12px;border-radius:50%;' + '  background:#fff;box-shadow:0 0 0 1.5px #c96442,0 1px 3px rgba(0,0,0,.3);' + '  transform:translate(-50%,-50%)}' + '.spill .handle[data-c=nw]{left:0;top:0;cursor:nwse-resize}' + '.spill .handle[data-c=ne]{left:100%;top:0;cursor:nesw-resize}' + '.spill .handle[data-c=sw]{left:0;top:100%;cursor:nesw-resize}' + '.spill .handle[data-c=se]{left:100%;top:100%;cursor:nwse-resize}' + ':host([data-reframe]){z-index:10}' + ':host([data-reframe]) .spill{display:block}' + ':host([data-reframe]) .frame{box-shadow:0 0 0 2px #c96442}' + '.empty{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' + '  justify-content:center;gap:6px;text-align:center;padding:12px;box-sizing:border-box;' + '  cursor:pointer;user-select:none}' + '.empty svg{opacity:.45}' + '.empty .cap{max-width:90%;font-weight:500;letter-spacing:.01em}' + '.empty .sub{font-size:11px}' + '.empty .sub u{text-underline-offset:2px;text-decoration-color:rgba(0,0,0,.25)}' + '.empty:hover .sub u{color:rgba(0,0,0,.75);text-decoration-color:currentColor}' + ':host([data-over]) .frame{outline:2px solid #c96442;outline-offset:-2px;' + '  background:rgba(201,100,66,.10)}' + '.ring{position:absolute;inset:0;pointer-events:none;border:1.5px dashed rgba(0,0,0,.25);' + '  transition:border-color .12s}' + ':host([data-over]) .ring{border-color:#c96442}' + ':host([data-filled]) .ring{display:none}' +
  // Controls sit BELOW the mask (top:100%), absolutely positioned so the
  // author-declared slot height is unaffected. The gap is padding, not a
  // top offset, so the hover target stays contiguous with the frame.
  '.ctl{position:absolute;top:100%;left:50%;transform:translateX(-50%);padding-top:8px;' + '  display:flex;gap:6px;opacity:0;pointer-events:none;transition:opacity .12s;z-index:2;' + '  white-space:nowrap}' + ':host([data-filled][data-editable]:hover) .ctl,:host([data-reframe]) .ctl' + '  {opacity:1;pointer-events:auto}' + '.ctl button{appearance:none;border:0;border-radius:6px;padding:5px 10px;cursor:pointer;' + '  background:rgba(0,0,0,.65);color:#fff;font:11px/1 system-ui,-apple-system,sans-serif;' + '  backdrop-filter:blur(6px)}' + '.ctl button:hover{background:rgba(0,0,0,.8)}' + '.err{position:absolute;left:8px;bottom:8px;right:8px;color:#b3261e;font-size:11px;' + '  background:rgba(255,255,255,.85);padding:4px 6px;border-radius:5px;pointer-events:none}' + '.credit{position:absolute;left:6px;bottom:6px;max-width:calc(100% - 12px);display:none;' + '  padding:3px 7px;border-radius:5px;background:rgba(0,0,0,.55);color:#fff;' + '  font:10px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;' + '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;backdrop-filter:blur(6px)}' + '.credit[href]:hover{background:rgba(0,0,0,.8);text-decoration:underline}' + ':host([data-filled][data-credit]) .credit{display:block}';
  const icon = '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' + '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>' + '<path d="m21 15-5-5L5 21"/></svg>';
  class ImageSlot extends HTMLElement {
    static get observedAttributes() {
      return ['shape', 'radius', 'mask', 'fit', 'position', 'placeholder', 'src', 'id', 'credit', 'credit-href'];
    }
    constructor() {
      super();
      const root = this.attachShadow({
        mode: 'open'
      });
      // .spill and .ctl sit OUTSIDE .frame so overflow:hidden + border-radius
      // on the frame (circle, pill, rounded) can't clip them.
      root.innerHTML = '<style>' + stylesheet + '</style>' + '<div class="frame" part="frame">' + '  <img part="image" alt="" draggable="false" style="display:none">' + '  <div class="empty" part="empty">' + icon + '    <div class="cap"></div>' + '    <div class="sub">or <u>browse files</u></div></div>' + '  <div class="ring" part="ring"></div>' + '</div>' +
      // Outside .frame, like .spill/.ctl — the frame's overflow:hidden +
      // border-radius/clip-path would cut the credit off on circle/pill/mask.
      '<a class="credit" part="credit" target="_blank" rel="noopener noreferrer"></a>' + '<div class="spill">' + '  <img class="ghost" alt="" draggable="false">' + '  <div class="handle" data-c="nw"></div><div class="handle" data-c="ne"></div>' + '  <div class="handle" data-c="sw"></div><div class="handle" data-c="se"></div>' + '</div>' + '<div class="ctl"><button data-act="replace" title="Replace image">Replace</button>' + '  <button data-act="clear" title="Remove image">Remove</button></div>' + '<input type="file" accept="' + ACCEPT.join(',') + '" hidden>';
      this._frame = root.querySelector('.frame');
      this._ring = root.querySelector('.ring');
      this._img = root.querySelector('.frame img');
      this._empty = root.querySelector('.empty');
      this._cap = root.querySelector('.cap');
      this._sub = root.querySelector('.sub');
      this._spill = root.querySelector('.spill');
      this._credit = root.querySelector('.credit');
      // Credit clicks open the link, not browse/reframe.
      this._credit.addEventListener('click', e => e.stopPropagation());
      this._credit.addEventListener('dblclick', e => e.stopPropagation());
      this._ghost = root.querySelector('.ghost');
      this._err = null;
      this._input = root.querySelector('input');
      this._depth = 0;
      this._gen = 0;
      this._view = {
        s: 1,
        x: 0,
        y: 0
      };
      this._subFn = () => this._render();
      // Shadow-DOM listeners live with the shadow DOM — bound once here so
      // disconnect/reconnect (e.g. React remount) doesn't stack handlers.
      this._empty.addEventListener('click', () => this._input.click());
      root.addEventListener('click', e => {
        const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act');
        if (act === 'replace') {
          this._exitReframe(true);
          this._input.click();
        }
        if (act === 'clear') {
          this._exitReframe(false);
          this._gen++;
          this._local = null;
          if (this.id) setSlot(this.id, null);else this._render();
        }
      });
      this._input.addEventListener('change', () => {
        const f = this._input.files && this._input.files[0];
        if (f) this._ingest(f);
        this._input.value = '';
      });
      // naturalWidth/Height aren't known until load — re-apply so the cover
      // baseline is computed from real dimensions, not the 100%×100% fallback.
      this._img.addEventListener('load', () => this._applyView());
      // Gated on editable + fit=cover so share links and contain/fill slots
      // stay static.
      this.addEventListener('dblclick', e => {
        if (!this.hasAttribute('data-editable') || !this._reframes()) return;
        e.preventDefault();
        if (this.hasAttribute('data-reframe')) this._exitReframe(true);else this._enterReframe();
      });
      // Pan + resize both originate on the spill layer. A handle pointerdown
      // drives an aspect-locked resize anchored at the opposite corner; any
      // other pointerdown on the spill pans. Offsets are frame-% so a
      // reframed slot survives responsive resize / PPTX export.
      this._spill.addEventListener('pointerdown', e => {
        if (e.button !== 0 || !this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        e.stopPropagation();
        this._spill.setPointerCapture(e.pointerId);
        const rect = this.getBoundingClientRect();
        const fw = rect.width || 1,
          fh = rect.height || 1;
        const corner = e.target.getAttribute && e.target.getAttribute('data-c');
        let move;
        if (corner) {
          // Resize about the OPPOSITE corner. Viewport-px throughout (rect
          // fw/fh, not clientWidth) so the math survives a transform:scale()
          // ancestor — deck_stage renders slides scaled-to-fit.
          const iw = this._img.naturalWidth || 1,
            ih = this._img.naturalHeight || 1;
          const base = Math.max(fw / iw, fh / ih);
          const sx = corner.includes('e') ? 1 : -1;
          const sy = corner.includes('s') ? 1 : -1;
          const s0 = this._view.s;
          const w0 = iw * base * s0,
            h0 = ih * base * s0;
          const cx0 = (50 + this._view.x) / 100 * fw;
          const cy0 = (50 + this._view.y) / 100 * fh;
          const ox = cx0 - sx * w0 / 2,
            oy = cy0 - sy * h0 / 2;
          const diag0 = Math.hypot(w0, h0);
          const ux = sx * w0 / diag0,
            uy = sy * h0 / diag0;
          move = ev => {
            const proj = (ev.clientX - rect.left - ox) * ux + (ev.clientY - rect.top - oy) * uy;
            const s = clampS(s0 * proj / diag0);
            const d = diag0 * s / s0;
            this._view.s = s;
            this._view.x = (ox + ux * d / 2) / fw * 100 - 50;
            this._view.y = (oy + uy * d / 2) / fh * 100 - 50;
            this._clampView();
            this._applyView();
          };
        } else {
          this.setAttribute('data-panning', '');
          const start = {
            px: e.clientX,
            py: e.clientY,
            x: this._view.x,
            y: this._view.y
          };
          move = ev => {
            this._view.x = start.x + (ev.clientX - start.px) / fw * 100;
            this._view.y = start.y + (ev.clientY - start.py) / fh * 100;
            this._clampView();
            this._applyView();
          };
        }
        const up = () => {
          try {
            this._spill.releasePointerCapture(e.pointerId);
          } catch {}
          this._spill.removeEventListener('pointermove', move);
          this._spill.removeEventListener('pointerup', up);
          this._spill.removeEventListener('pointercancel', up);
          this.removeAttribute('data-panning');
          this._dragUp = null;
        };
        // Stashed so _exitReframe (Escape / outside-click mid-drag) can
        // tear the capture + listeners down synchronously.
        this._dragUp = up;
        this._spill.addEventListener('pointermove', move);
        this._spill.addEventListener('pointerup', up);
        this._spill.addEventListener('pointercancel', up);
      });
      // Wheel zoom stays available inside reframe mode as a trackpad nicety —
      // zooms toward the cursor (offset' = cursor·(1-k) + offset·k).
      this.addEventListener('wheel', e => {
        if (!this.hasAttribute('data-reframe')) return;
        e.preventDefault();
        const r = this.getBoundingClientRect();
        const cx = (e.clientX - r.left) / r.width * 100 - 50;
        const cy = (e.clientY - r.top) / r.height * 100 - 50;
        const prev = this._view.s;
        const next = clampS(prev * Math.pow(1.0015, -e.deltaY));
        if (next === prev) return;
        const k = next / prev;
        this._view.s = next;
        this._view.x = cx * (1 - k) + this._view.x * k;
        this._view.y = cy * (1 - k) + this._view.y * k;
        this._clampView();
        this._applyView();
      }, {
        passive: false
      });
    }
    connectedCallback() {
      // Warn once per page — an id-less slot works for the session but
      // cannot persist, and two id-less slots would share nothing.
      if (!this.id && !ImageSlot._warned) {
        ImageSlot._warned = true;
        console.warn('<image-slot> without an id will not persist its dropped image.');
      }
      this.addEventListener('dragenter', this);
      this.addEventListener('dragover', this);
      this.addEventListener('dragleave', this);
      this.addEventListener('drop', this);
      subs.add(this._subFn);
      // width%/height% in _applyView encode the frame aspect at call time —
      // a host resize (responsive grid, pane divider) would stretch the
      // image until the next _render. Re-render on size change: _render()
      // re-seeds _view from stored before clamp/apply, so a shrink→grow
      // cycle round-trips instead of ratcheting x/y toward the narrower
      // frame's clamp range.
      this._ro = new ResizeObserver(() => this._render());
      this._ro.observe(this);
      load();
      this._render();
    }
    disconnectedCallback() {
      subs.delete(this._subFn);
      this.removeEventListener('dragenter', this);
      this.removeEventListener('dragover', this);
      this.removeEventListener('dragleave', this);
      this.removeEventListener('drop', this);
      if (this._ro) {
        this._ro.disconnect();
        this._ro = null;
      }
      this._exitReframe(false);
    }
    _enterReframe() {
      if (this.hasAttribute('data-reframe')) return;
      this.setAttribute('data-reframe', '');
      this._applyView();
      // Close on click outside (the spill handler stopPropagation()s so
      // in-image drags don't reach this) and on Escape. Listeners are held
      // on the instance so _exitReframe / disconnectedCallback can detach
      // exactly what was attached.
      this._outside = e => {
        if (e.composedPath && e.composedPath().includes(this)) return;
        this._exitReframe(true);
      };
      this._esc = e => {
        if (e.key === 'Escape') this._exitReframe(true);
      };
      document.addEventListener('pointerdown', this._outside, true);
      document.addEventListener('keydown', this._esc, true);
    }
    _exitReframe(commit) {
      if (!this.hasAttribute('data-reframe')) return;
      if (this._dragUp) this._dragUp();
      this.removeAttribute('data-reframe');
      this.removeAttribute('data-panning');
      if (this._outside) document.removeEventListener('pointerdown', this._outside, true);
      if (this._esc) document.removeEventListener('keydown', this._esc, true);
      this._outside = this._esc = null;
      if (commit) this._commitView();
    }
    attributeChangedCallback() {
      if (this.shadowRoot) this._render();
    }

    // handleEvent — one listener object for all four drag events keeps the
    // add/remove symmetric and the depth counter correct.
    handleEvent(e) {
      if (e.type === 'dragenter' || e.type === 'dragover') {
        // Without preventDefault the browser never fires 'drop'.
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        if (e.type === 'dragenter') this._depth++;
        this.setAttribute('data-over', '');
      } else if (e.type === 'dragleave') {
        // dragenter/leave fire for every descendant crossing — count depth
        // so hovering the icon inside the empty state doesn't flicker.
        if (--this._depth <= 0) {
          this._depth = 0;
          this.removeAttribute('data-over');
        }
      } else if (e.type === 'drop') {
        e.preventDefault();
        e.stopPropagation();
        this._depth = 0;
        this.removeAttribute('data-over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) this._ingest(f);
      }
    }
    async _ingest(file) {
      this._setError(null);
      if (!file || ACCEPT.indexOf(file.type) < 0) {
        this._setError('Drop a PNG, JPEG, WebP, or AVIF image.');
        return;
      }
      // toDataUrl can take hundreds of ms on a large photo. A Clear or a
      // newer drop during that window would be clobbered when this await
      // resumes — bump + capture a generation so stale encodes bail.
      const gen = ++this._gen;
      try {
        const w = this.clientWidth || this.offsetWidth || MAX_DIM;
        const url = await toDataUrl(file, w);
        if (gen !== this._gen) return;
        // Only exit reframe once the new image is in hand — a rejected type
        // or decode failure leaves the in-progress crop untouched.
        this._exitReframe(false);
        const val = {
          u: url,
          s: 1,
          x: 0,
          y: 0
        };
        setSlot(this.id || '', val);
        // Keep a session-local copy for id-less slots so the drop still
        // shows, even though it cannot persist.
        if (!this.id) {
          this._local = val;
          this._render();
        }
      } catch (err) {
        if (gen !== this._gen) return;
        this._setError('Could not read that image.');
        console.warn('<image-slot> ingest failed:', err);
      }
    }
    _setError(msg) {
      if (this._err) {
        this._err.remove();
        this._err = null;
      }
      if (!msg) return;
      const d = document.createElement('div');
      d.className = 'err';
      d.textContent = msg;
      this.shadowRoot.appendChild(d);
      this._err = d;
      setTimeout(() => {
        if (this._err === d) {
          d.remove();
          this._err = null;
        }
      }, 3000);
    }

    // Reframing (pan/resize) is only meaningful for fit=cover — contain/fill
    // keep the old object-fit path and double-click is a no-op.
    _reframes() {
      return this.hasAttribute('data-filled') && (this.getAttribute('fit') || 'cover') === 'cover';
    }

    // Cover-baseline geometry, shared by clamp/apply/resize. Null until the
    // img has loaded (naturalWidth is 0 before that) or when the slot has no
    // layout box — ResizeObserver fires with a 0×0 rect under display:none,
    // and clamping against a degenerate 1×1 frame would silently pull the
    // stored pan toward zero.
    _geom() {
      const iw = this._img.naturalWidth,
        ih = this._img.naturalHeight;
      const fw = this.clientWidth,
        fh = this.clientHeight;
      if (!iw || !ih || !fw || !fh) return null;
      return {
        iw,
        ih,
        fw,
        fh,
        base: Math.max(fw / iw, fh / ih)
      };
    }
    _clampView() {
      // Pan range on each axis is half the overflow past the frame edge.
      const g = this._geom();
      if (!g) return;
      const mx = Math.max(0, (g.iw * g.base * this._view.s / g.fw - 1) * 50);
      const my = Math.max(0, (g.ih * g.base * this._view.s / g.fh - 1) * 50);
      this._view.x = Math.max(-mx, Math.min(mx, this._view.x));
      this._view.y = Math.max(-my, Math.min(my, this._view.y));
    }
    _applyView() {
      const g = this._geom();
      const fit = this.getAttribute('fit') || 'cover';
      if (fit !== 'cover' || !g) {
        // Non-cover, or dimensions not known yet (before img load).
        this._img.style.width = '100%';
        this._img.style.height = '100%';
        this._img.style.left = '50%';
        this._img.style.top = '50%';
        this._img.style.objectFit = fit;
        this._img.style.objectPosition = this.getAttribute('position') || '50% 50%';
        return;
      }
      // Cover baseline: img fills the frame on its tighter axis at s=1, so
      // pan works immediately on the overflowing axis without zooming first.
      // Width/height and left/top are all frame-% — depends only on the
      // frame aspect ratio, so a responsive resize keeps the same crop. The
      // spill layer mirrors the same box so its corners = image corners.
      const k = g.base * this._view.s;
      const w = g.iw * k / g.fw * 100 + '%';
      const h = g.ih * k / g.fh * 100 + '%';
      const l = 50 + this._view.x + '%';
      const t = 50 + this._view.y + '%';
      this._img.style.width = w;
      this._img.style.height = h;
      this._img.style.left = l;
      this._img.style.top = t;
      this._img.style.objectFit = '';
      this._spill.style.width = w;
      this._spill.style.height = h;
      this._spill.style.left = l;
      this._spill.style.top = t;
    }
    _commitView() {
      const v = {
        s: this._view.s,
        x: this._view.x,
        y: this._view.y
      };
      if (this._userUrl) v.u = this._userUrl;
      // Framing-only (no u) persists too so an author-src slot remembers its
      // crop; clearing the sidecar still falls through to src=.
      if (this.id) setSlot(this.id, v);else {
        this._local = v;
      }
    }
    _render() {
      // Shape / mask. Presets use border-radius so the dashed ring can
      // follow the rounded outline; clip-path is only applied for an
      // explicit `mask` (the ring is hidden there since a rectangle
      // dashed border chopped by an arbitrary polygon looks broken).
      const mask = this.getAttribute('mask');
      const shape = (this.getAttribute('shape') || 'rounded').toLowerCase();
      let radius = '';
      if (shape === 'circle') radius = '50%';else if (shape === 'pill') radius = '9999px';else if (shape === 'rounded') {
        const n = parseFloat(this.getAttribute('radius'));
        radius = (Number.isFinite(n) ? n : 12) + 'px';
      }
      this._frame.style.borderRadius = mask ? '' : radius;
      this._frame.style.clipPath = mask || '';
      this._ring.style.borderRadius = mask ? '' : radius;
      this._ring.style.display = mask ? 'none' : '';

      // Controls and reframe entry gate on this so share links stay read-only.
      const editable = !!(window.omelette && window.omelette.writeFile);
      this.toggleAttribute('data-editable', editable);
      this._sub.style.display = editable ? '' : 'none';

      // Content. The sidecar is also writable by the agent's write_file
      // tool, so its value isn't guaranteed canvas-originated — only accept
      // data:image/ URLs from it. The `src` attribute is author-controlled
      // (Claude wrote it into the HTML) so it passes through unchanged.
      let stored = this.id ? getSlot(this.id) : this._local;
      if (stored && stored.u && !/^data:image\//i.test(stored.u)) stored = null;
      const srcAttr = this.getAttribute('src') || '';
      this._userUrl = stored && stored.u || null;
      const url = this._userUrl || srcAttr;
      // Don't clobber an in-flight reframe with a store-triggered re-render.
      if (!this.hasAttribute('data-reframe')) {
        this._view = {
          s: stored && Number.isFinite(stored.s) ? clampS(stored.s) : 1,
          x: stored && Number.isFinite(stored.x) ? stored.x : 0,
          y: stored && Number.isFinite(stored.y) ? stored.y : 0
        };
      }
      this._cap.textContent = this.getAttribute('placeholder') || 'Drop an image';
      // Toggle via style.display — the [hidden] attribute alone loses to
      // the display:flex / display:block rules in the stylesheet above.
      if (url) {
        if (this._img.getAttribute('src') !== url) {
          this._img.src = url;
          this._ghost.src = url;
        }
        this._img.style.display = 'block';
        this._empty.style.display = 'none';
        this.setAttribute('data-filled', '');
        this._clampView();
        this._applyView();
      } else {
        this._img.style.display = 'none';
        this._img.removeAttribute('src');
        this._ghost.removeAttribute('src');
        this._empty.style.display = 'flex';
        this.removeAttribute('data-filled');
      }

      // Credit belongs to the author src, so a user drop hides it.
      // textContent + http(s)-only href keep external strings inert.
      const credit = this.getAttribute('credit');
      const showCredit = !!(url && credit && !this._userUrl);
      if (showCredit) {
        this._credit.textContent = credit;
        let href = '';
        const rawHref = this.getAttribute('credit-href') || '';
        if (rawHref) {
          try {
            const u = new URL(rawHref, document.baseURI);
            if (u.protocol === 'http:' || u.protocol === 'https:') href = u.href;
          } catch {}
        }
        if (href) this._credit.setAttribute('href', href);else this._credit.removeAttribute('href');
      } else {
        this._credit.textContent = '';
        this._credit.removeAttribute('href');
      }
      this.toggleAttribute('data-credit', showCredit);
    }
  }
  if (!customElements.get('image-slot')) {
    customElements.define('image-slot', ImageSlot);
  }
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/_shared/image-slot.js", error: String((e && e.message) || e) }); }

// ui_kits/app/AppSidebar.jsx
try { (() => {
// Vidora app — left sidebar
const {
  NavItem,
  Avatar,
  Badge
} = window.VidoraDesignSystem_0f84f2;
function AppSidebar({
  route,
  onNavigate
}) {
  const nav = [{
    id: "discover",
    icon: "home",
    label: "Home"
  }, {
    id: "explore",
    icon: "compass",
    label: "Discover"
  }, {
    id: "library",
    icon: "library",
    label: "My library",
    badge: "12"
  }, {
    id: "courses",
    icon: "graduation",
    label: "Courses"
  }, {
    id: "news",
    icon: "newspaper",
    label: "News"
  }, {
    id: "docs",
    icon: "film",
    label: "Documentaries"
  }];
  const cont = [{
    t: "How Stripe was built",
    s: "Founder Stories"
  }, {
    t: "The state of AI in 2026",
    s: "Vidora News"
  }, {
    t: "Foundations of ML",
    s: "Courses"
  }];
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: "var(--sidebar-width)",
      flex: "none",
      background: "var(--sidebar)",
      borderRight: "1px solid var(--sidebar-border)",
      display: "flex",
      flexDirection: "column",
      height: "100%",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 68,
      display: "flex",
      alignItems: "center",
      padding: "0 20px",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/assets/logos/vidora-logo-black.png",
    alt: "Vidora",
    style: {
      height: 24
    }
  })), /*#__PURE__*/React.createElement("nav", {
    style: {
      padding: "8px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, nav.map(n => /*#__PURE__*/React.createElement(NavItem, {
    key: n.id,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: n.icon,
      size: 19
    }),
    label: n.label,
    badge: n.badge,
    active: route === n.id,
    onClick: () => onNavigate(n.id)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "16px 20px 8px",
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)"
    }
  }, "Continue watching"), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "0 12px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
      overflow: "hidden"
    }
  }, cont.map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    onClick: () => onNavigate("watch"),
    style: {
      display: "flex",
      gap: 10,
      alignItems: "center",
      padding: "8px 8px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      borderRadius: "var(--radius-md)",
      textAlign: "left",
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 42,
      height: 26,
      borderRadius: 5,
      background: ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#26313f,#1f2937)", "linear-gradient(135deg,#243b2f,#14532d)"][i],
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 500,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, c.t), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, c.s))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 12,
      borderTop: "1px solid var(--sidebar-border)",
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Avatar, {
    name: "Maya Chen",
    size: "sm",
    presence: "online"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      minWidth: 0,
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 13,
      fontWeight: 600,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, "Maya Chen"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontSize: 12,
      color: "var(--muted-foreground)"
    }
  }, "Pro plan")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--muted-foreground)",
      display: "inline-flex"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "settings",
    size: 18
  }))));
}
window.AppSidebar = AppSidebar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/AppSidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/AppTopbar.jsx
try { (() => {
// Vidora app — top bar
const {
  Button,
  IconButton,
  LanguageBadge,
  Avatar
} = window.VidoraDesignSystem_0f84f2;
function AppTopbar({
  onNavigate
}) {
  const [q, setQ] = React.useState("");
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 68,
      flex: "none",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 16,
      padding: "0 24px",
      background: "color-mix(in oklch, var(--background) 80%, transparent)",
      backdropFilter: "blur(var(--blur-md))"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      maxWidth: 520
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: 42,
      padding: "0 16px",
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-full)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18,
    style: {
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: q,
    onChange: e => setQ(e.target.value),
    placeholder: "Search videos, courses, topics\u2026",
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      color: "var(--foreground)"
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(LanguageBadge, {
    language: "Espa\xF1ol",
    translated: true
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bell",
      size: 20
    }),
    label: "Notifications",
    variant: "ghost"
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "brand",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "plus",
      size: 18,
      stroke: 2.2
    }),
    onClick: () => onNavigate("upload")
  }, "Upload"));
}
window.AppTopbar = AppTopbar;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/AppTopbar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/DiscoverScreen.jsx
try { (() => {
// Vidora app — Home / Discover
const {
  VideoCard,
  PosterCard,
  CategoryChip,
  Badge
} = window.VidoraDesignSystem_0f84f2;
const GG = ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#243b2f,#14532d)", "linear-gradient(135deg,#3a2733,#5e2f3b)", "linear-gradient(135deg,#26313f,#1f2937)", "linear-gradient(135deg,#3a3320,#5e4a2f)", "linear-gradient(135deg,#2b1f3f,#4a2f5e)"];
function Row({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 40
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "-0.01em"
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      border: "none",
      background: "transparent",
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 500,
      color: "var(--muted-foreground)"
    }
  }, "See all ", /*#__PURE__*/React.createElement(Icon, {
    name: "chevronRight",
    size: 16
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      overflowX: "auto",
      paddingBottom: 6
    }
  }, children));
}
function DiscoverScreen({
  onOpenVideo
}) {
  const cats = ["All", "AI", "Business", "Founder stories", "Documentaries", "Technology", "Personal growth"];
  const [cat, setCat] = React.useState("All");
  const cont = [{
    title: "How Stripe was built from scratch",
    source: "Founder Stories",
    duration: "42:10",
    p: 35,
    g: 0
  }, {
    title: "The state of AI in 2026",
    source: "Vidora News",
    duration: "08:24",
    p: 72,
    g: 3
  }, {
    title: "Building companies that last",
    source: "Courses",
    duration: "18:02",
    p: 12,
    g: 4
  }, {
    title: "Inside the mind of a founder",
    source: "Biographies",
    duration: "31:55",
    p: 88,
    g: 1
  }];
  const news = [{
    title: "What the new AI regulations mean",
    source: "Reuters · translated",
    duration: "06:12",
    g: 3
  }, {
    title: "Markets react to earnings season",
    source: "Bloomberg · translated",
    duration: "04:45",
    g: 5
  }, {
    title: "The week in technology",
    source: "The Verge · translated",
    duration: "11:30",
    g: 2
  }, {
    title: "Climate summit: key takeaways",
    source: "BBC · translated",
    duration: "09:08",
    g: 4
  }];
  const courses = [{
    eyebrow: "Course",
    title: "Foundations of Machine Learning",
    g: 0
  }, {
    eyebrow: "Documentary",
    title: "The Rise of Silicon Valley",
    g: 2
  }, {
    eyebrow: "Biography",
    title: "The Woman Who Built Modern Computing",
    g: 3
  }, {
    eyebrow: "Series",
    title: "How Iconic Companies Were Built",
    g: 1
  }, {
    eyebrow: "Course",
    title: "Negotiation for Founders",
    g: 5
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 32px 48px",
      maxWidth: 1240
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      borderRadius: "var(--radius-2xl)",
      overflow: "hidden",
      padding: "40px 40px",
      marginBottom: 40,
      background: "var(--gradient-brand)",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 560
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      opacity: 0.85,
      marginBottom: 12
    }
  }, "Featured documentary"), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 34,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      lineHeight: 1.1
    }
  }, "The Rise of Silicon Valley"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "12px 0 20px",
      fontSize: 16,
      lineHeight: 1.6,
      color: "rgba(255,255,255,0.82)"
    }
  }, "How a stretch of orchards became the engine of the modern world \u2014 now with subtitles in 48 languages."), /*#__PURE__*/React.createElement("button", {
    onClick: onOpenVideo,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      height: 44,
      padding: "0 20px",
      borderRadius: "var(--radius-full)",
      border: "none",
      background: "#fff",
      color: "#000",
      fontFamily: "var(--font-sans)",
      fontSize: 15,
      fontWeight: 600,
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 18,
    fill: true
  }), " Watch now"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      marginBottom: 32
    }
  }, cats.map(c => /*#__PURE__*/React.createElement(CategoryChip, {
    key: c,
    label: c,
    active: c === cat,
    onClick: () => setCat(c)
  }))), /*#__PURE__*/React.createElement(Row, {
    title: "Continue watching"
  }, cont.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    },
    onClick: onOpenVideo
  }, /*#__PURE__*/React.createElement(VideoCard, {
    size: "md",
    title: v.title,
    source: v.source,
    duration: v.duration,
    progress: v.p,
    translated: true,
    thumbnail: GG[v.g]
  })))), /*#__PURE__*/React.createElement(Row, {
    title: "Translated world news"
  }, news.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    },
    onClick: onOpenVideo
  }, /*#__PURE__*/React.createElement(VideoCard, {
    size: "md",
    title: v.title,
    source: v.source,
    duration: v.duration,
    translated: true,
    thumbnail: GG[v.g]
  })))), /*#__PURE__*/React.createElement(Row, {
    title: "Courses & documentaries"
  }, courses.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    },
    onClick: onOpenVideo
  }, /*#__PURE__*/React.createElement(PosterCard, {
    size: "md",
    eyebrow: v.eyebrow,
    title: v.title,
    thumbnail: GG[v.g]
  })))));
}
window.DiscoverScreen = DiscoverScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/DiscoverScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/LibraryScreen.jsx
try { (() => {
// Vidora app — My library
const {
  Tabs,
  VideoCard,
  Breadcrumb,
  SearchBar
} = window.VidoraDesignSystem_0f84f2;
function LibraryScreen({
  onOpenVideo
}) {
  const [tab, setTab] = React.useState("saved");
  const GG = ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#243b2f,#14532d)", "linear-gradient(135deg,#3a2733,#5e2f3b)", "linear-gradient(135deg,#26313f,#1f2937)", "linear-gradient(135deg,#3a3320,#5e4a2f)", "linear-gradient(135deg,#2b1f3f,#4a2f5e)"];
  const items = [{
    title: "How Stripe was built from scratch",
    source: "Founder Stories",
    duration: "42:10",
    p: 35
  }, {
    title: "The state of AI in 2026",
    source: "Vidora News",
    duration: "08:24",
    p: 72
  }, {
    title: "Foundations of Machine Learning",
    source: "Courses",
    duration: "1:24:00",
    p: 12
  }, {
    title: "Inside the mind of a founder",
    source: "Biographies",
    duration: "31:55",
    p: 88
  }, {
    title: "A Brief History of the Internet",
    source: "Documentary",
    duration: "58:12",
    p: 0
  }, {
    title: "Negotiation for Founders",
    source: "Courses",
    duration: "22:40",
    p: 100
  }];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "28px 32px 48px",
      maxWidth: 1240
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-end",
      gap: 16,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: "0 0 8px",
      fontSize: 30,
      fontWeight: 600,
      letterSpacing: "-0.025em"
    }
  }, "My library"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      color: "var(--muted-foreground)"
    }
  }, "Everything you've saved, watched and organized.")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 280
    }
  }, /*#__PURE__*/React.createElement(SearchBar, {
    value: "",
    onChange: () => {},
    placeholder: "Search your library\u2026"
  }))), /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      value: "saved",
      label: "Saved",
      count: 24
    }, {
      value: "history",
      label: "History"
    }, {
      value: "playlists",
      label: "Playlists",
      count: 5
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
      gap: 22
    }
  }, items.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: onOpenVideo,
    style: {
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(VideoCard, {
    style: {
      width: "100%"
    },
    title: v.title,
    source: v.source,
    duration: v.duration,
    progress: v.p || null,
    translated: true,
    thumbnail: GG[i % GG.length]
  })))));
}
window.LibraryScreen = LibraryScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/LibraryScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/app/WatchScreen.jsx
try { (() => {
// Vidora app — Watch page (player + transcript + up next)
const {
  PlayerControls,
  Tabs,
  TranscriptLine,
  LanguageBadge,
  Badge,
  Button,
  IconButton,
  Avatar,
  VideoCard
} = window.VidoraDesignSystem_0f84f2;
function WatchScreen({
  onBack,
  onOpenVideo
}) {
  const [playing, setPlaying] = React.useState(true);
  const [tab, setTab] = React.useState("transcript");
  const [active, setActive] = React.useState(2);
  const lines = [{
    t: "01:02",
    o: "This is a story about a place that changed the world.",
    tr: "Esta es la historia de un lugar que cambió el mundo."
  }, {
    t: "01:09",
    o: "It didn't start with computers. It started with fruit.",
    tr: "No empezó con computadoras. Empezó con fruta."
  }, {
    t: "01:18",
    o: "We started with a very simple idea.",
    tr: "Empezamos con una idea muy simple."
  }, {
    t: "01:24",
    o: "Nobody thought it would work at first.",
    tr: "Al principio nadie pensó que funcionaría."
  }, {
    t: "01:31",
    o: "So we just kept shipping, week after week.",
    tr: "Así que seguimos lanzando, semana tras semana."
  }, {
    t: "01:40",
    o: "And slowly, people started to notice.",
    tr: "Y poco a poco, la gente empezó a notarlo."
  }];
  const next = [{
    title: "How Stripe was built from scratch",
    source: "Founder Stories",
    duration: "42:10",
    g: 0
  }, {
    title: "Inside the mind of a founder",
    source: "Biographies",
    duration: "31:55",
    g: 1
  }, {
    title: "Building companies that last",
    source: "Courses",
    duration: "18:02",
    g: 4
  }];
  const GG = ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#243b2f,#14532d)", "", "", "linear-gradient(135deg,#3a3320,#5e4a2f)"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) 360px",
      gap: 28,
      padding: "24px 32px 48px",
      maxWidth: 1360
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: onBack,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      border: "none",
      background: "transparent",
      cursor: "pointer",
      fontSize: 14,
      fontWeight: 500,
      color: "var(--muted-foreground)",
      marginBottom: 14
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "chevronLeft",
    size: 18
  }), " Back"), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16 / 9",
      borderRadius: "var(--radius-2xl)",
      overflow: "hidden",
      background: "linear-gradient(135deg,#101828,#1e2a4a 60%,#3b2f5e)",
      display: "flex",
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => setPlaying(!playing),
    "aria-label": "Play",
    style: {
      position: "absolute",
      inset: 0,
      margin: "auto",
      width: 72,
      height: 72,
      borderRadius: "50%",
      border: "none",
      background: "rgba(0,0,0,0.45)",
      backdropFilter: "blur(8px)",
      color: "#fff",
      display: playing ? "none" : "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 30,
    fill: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 14,
      left: 14,
      background: "rgba(0,0,0,0.55)",
      backdropFilter: "blur(8px)",
      borderRadius: "var(--radius-md)",
      padding: "6px 10px",
      color: "#fff",
      fontSize: 13,
      fontWeight: 500
    }
  }, "Now playing subtitles in ", /*#__PURE__*/React.createElement("strong", null, "Espa\xF1ol")), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement(PlayerControls, {
    playing: playing,
    progress: 30,
    buffered: 52,
    current: "03:04",
    total: "42:10",
    captions: true,
    language: "Espa\xF1ol",
    onPlayPause: () => setPlaying(!playing)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 24,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      lineHeight: 1.2
    }
  }, "The Rise of Silicon Valley"), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      display: "flex",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "neutral"
  }, "Documentary"), /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    dot: true
  }, "Translated \xB7 48 languages"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--muted-foreground)"
    }
  }, "1.2M views \xB7 2 weeks ago"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "heart",
      size: 19
    }),
    label: "Like",
    variant: "outline"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bookmark",
      size: 19
    }),
    label: "Save",
    variant: "outline"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "share",
      size: 19
    }),
    label: "Share",
    variant: "outline"
  }), /*#__PURE__*/React.createElement(LanguageBadge, {
    language: "Espa\xF1ol",
    translated: true
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    value: tab,
    onChange: setTab,
    items: [{
      value: "transcript",
      label: "Transcript"
    }, {
      value: "chapters",
      label: "Chapters",
      count: 8
    }, {
      value: "about",
      label: "About"
    }]
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, tab === "transcript" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 12px",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 15,
    style: {
      color: "var(--brand)"
    }
  }), " Bilingual transcript \xB7 click any line to jump"), lines.map((l, i) => /*#__PURE__*/React.createElement(TranscriptLine, {
    key: i,
    time: l.t,
    text: l.o,
    translation: l.tr,
    active: active === i,
    onClick: () => setActive(i)
  }))) : tab === "about" ? /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 15,
      lineHeight: 1.7,
      color: "var(--foreground)",
      maxWidth: "68ch"
    }
  }, "A sweeping look at how a quiet stretch of orchards south of San Francisco became the center of the technology world \u2014 and the people, ideas and accidents that made it happen. Now understandable in your language with Vidora's AI subtitles.") : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, ["Cold open", "The orchards", "The first startups", "Venture capital arrives", "The PC revolution", "Going global", "The internet era", "What comes next"].map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    style: {
      display: "flex",
      gap: 12,
      alignItems: "center",
      padding: "10px 12px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      borderRadius: "var(--radius-md)",
      textAlign: "left"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 13,
      color: "var(--muted-foreground)",
      width: 40
    }
  }, String(i * 5 + 2).padStart(2, "0"), ":00"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      fontWeight: 500
    }
  }, i + 1, ". ", c)))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      marginBottom: 14
    }
  }, "Up next"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, next.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    onClick: onOpenVideo,
    style: {
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement(VideoCard, {
    size: "lg",
    style: {
      width: "100%"
    },
    title: v.title,
    source: v.source,
    duration: v.duration,
    translated: true,
    thumbnail: GG[v.g]
  }))))));
}
window.WatchScreen = WatchScreen;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/WatchScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/EditorialFooter.jsx
try { (() => {
// Vidora editorial landing — footer. Persian-first i18n via useLang(); RTL-safe.
function useReveal(delay) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  const reduce = React.useRef(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    if (reduce.current) {
      setShown(true);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      });
    }, {
      threshold: 0.15
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const style = reduce.current ? {} : {
    filter: shown ? "blur(0px)" : "blur(4px)",
    transform: shown ? "translateY(0)" : "translateY(-8px)",
    opacity: shown ? 1 : 0,
    transition: `filter 800ms var(--ease-standard) ${delay}ms, transform 800ms var(--ease-standard) ${delay}ms, opacity 800ms var(--ease-standard) ${delay}ms`
  };
  return [ref, style];
}
function AnimatedContainer({
  delay = 100,
  style = {},
  children
}) {
  const [ref, revealStyle] = useReveal(delay);
  return /*#__PURE__*/React.createElement("div", {
    ref: ref,
    style: {
      ...revealStyle,
      ...style
    }
  }, children);
}
function EditorialFooter() {
  const {
    d
  } = window.useLang();
  const sections = d.footer.sections;
  const rights = d.footer.rights.replace("{year}", new Date().getFullYear());
  const heading = {
    margin: 0,
    fontFamily: "var(--font-sans)",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "var(--ed-caps-tracking)",
    color: "#f5f5f4"
  };
  const linkStyle = {
    display: "inline-flex",
    alignItems: "center",
    fontFamily: "var(--font-sans)",
    fontSize: 14,
    lineHeight: 1.4,
    color: "rgba(255,255,255,0.62)",
    textDecoration: "none",
    transition: "color 300ms var(--ease-standard)",
    cursor: "pointer"
  };
  return /*#__PURE__*/React.createElement("footer", {
    "data-screen-label": "Footer",
    style: {
      position: "relative",
      width: "100%",
      maxWidth: 1152,
      margin: "72px auto 0",
      borderTop: "1px solid rgba(255,255,255,0.1)",
      borderTopLeftRadius: 28,
      borderTopRightRadius: 28,
      padding: "56px 40px 44px",
      overflow: "hidden",
      background: "radial-gradient(60% 140px at 50% 0%, rgba(255,255,255,0.06), transparent), #0a0a0a"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -1,
      insetInlineStart: "50%",
      transform: "translateX(-50%)",
      height: 2,
      width: "34%",
      borderRadius: 9999,
      background: "#ffffff",
      opacity: 0.28,
      filter: "blur(3px)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(220px, 1fr) 2fr",
      gap: 40,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement(AnimatedContainer, {
    delay: 0,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontWeight: 800,
      fontSize: 20,
      letterSpacing: "0.16em",
      color: "#ffffff"
    }
  }, "VIDORA"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      maxWidth: 260,
      fontFamily: "var(--font-sans)",
      fontSize: 13.5,
      lineHeight: 1.55,
      color: "rgba(255,255,255,0.6)"
    }
  }, d.footer.tagline), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "8px 0 0",
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      color: "rgba(255,255,255,0.45)"
    }
  }, rights)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 32
    }
  }, sections.map((section, i) => /*#__PURE__*/React.createElement(AnimatedContainer, {
    key: section.label,
    delay: 100 + i * 100,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("h3", {
    style: heading
  }, section.label), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: "none",
      margin: 0,
      padding: 0,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, section.links.map(title => /*#__PURE__*/React.createElement("li", {
    key: title
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    onClick: e => e.preventDefault(),
    style: linkStyle,
    onMouseEnter: e => e.currentTarget.style.color = "#ffffff",
    onMouseLeave: e => e.currentTarget.style.color = "rgba(255,255,255,0.62)"
  }, title)))))))));
}
window.EditorialFooter = EditorialFooter;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/EditorialFooter.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/EditorialHeader.jsx
try { (() => {
// Vidora editorial landing — header (floating scroll-aware pill + animated
// hamburger + mobile overlay). Persian-first i18n via useLang(); RTL-safe.
function MenuToggleIcon({
  open,
  size = 20,
  duration = 300
}) {
  return /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 32 32",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    style: {
      transition: `transform ${duration}ms ease-in-out`,
      transform: open ? "rotate(-45deg)" : "none",
      display: "block"
    }
  }, /*#__PURE__*/React.createElement("path", {
    style: {
      transition: `stroke-dasharray ${duration}ms ease-in-out, stroke-dashoffset ${duration}ms ease-in-out`,
      strokeDasharray: open ? "20 300" : "12 63",
      strokeDashoffset: open ? "-32.42px" : "0px"
    },
    d: "M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 16 27 16"
  }));
}
function EditorialHeader() {
  const {
    Button,
    IconButton,
    LanguageToggle
  } = window.VidoraDesignSystem_0f84f2;
  const {
    d
  } = window.useLang();
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [vw, setVw] = React.useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const isMobile = vw < 768;
  const floating = scrolled && !open && !isMobile;
  const links = [d.nav.product, d.nav.library, d.nav.pricing];
  const wordmark = /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontWeight: 800,
      fontSize: 17,
      letterSpacing: "0.16em",
      color: "var(--ed-ink)",
      userSelect: "none"
    }
  }, "VIDORA");
  return /*#__PURE__*/React.createElement("header", {
    "data-screen-label": "Header",
    style: {
      position: "sticky",
      top: floating ? 16 : 0,
      zIndex: 50,
      margin: "0 auto",
      width: "100%",
      maxWidth: floating ? 896 : 1024,
      borderRadius: floating ? "var(--radius-md)" : 0,
      border: floating ? "1px solid var(--border)" : "1px solid transparent",
      borderBottomColor: (scrolled || open) && !floating ? "var(--border)" : floating ? "var(--border)" : "transparent",
      background: open ? "rgba(255,255,255,0.92)" : floating ? "rgba(255,255,255,0.6)" : "transparent",
      backdropFilter: floating || open ? "blur(14px)" : "none",
      WebkitBackdropFilter: floating || open ? "blur(14px)" : "none",
      boxShadow: floating ? "var(--shadow-sm)" : "none",
      transition: "max-width 260ms var(--ease-standard), top 260ms var(--ease-standard), background 200ms var(--ease-standard), box-shadow 200ms var(--ease-standard), border-radius 260ms var(--ease-standard), border-color 200ms var(--ease-standard)"
    }
  }, /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      height: floating ? 48 : 56,
      width: "100%",
      alignItems: "center",
      justifyContent: "space-between",
      padding: floating ? "0 8px" : "0 16px",
      transition: "height 260ms var(--ease-standard), padding 260ms var(--ease-standard)"
    }
  }, wordmark, !isMobile ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 4
    }
  }, links.map((label, i) => /*#__PURE__*/React.createElement(Button, {
    key: i,
    variant: "ghost",
    onClick: e => e.preventDefault()
  }, label)), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 8
    }
  }), /*#__PURE__*/React.createElement(LanguageToggle, null), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 24,
      background: "var(--border)",
      margin: "0 4px"
    }
  }), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary"
  }, d.login), /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, d.startFree)) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(LanguageToggle, null), /*#__PURE__*/React.createElement(IconButton, {
    variant: "secondary",
    label: open ? "Close menu" : "Open menu",
    onClick: () => setOpen(v => !v),
    icon: /*#__PURE__*/React.createElement(MenuToggleIcon, {
      open: open,
      size: 20,
      duration: 300
    })
  }))), isMobile ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "fixed",
      insetInlineStart: 0,
      insetInlineEnd: 0,
      top: 56,
      bottom: 0,
      zIndex: 50,
      display: open ? "flex" : "none",
      flexDirection: "column",
      justifyContent: "space-between",
      gap: 8,
      padding: 16,
      background: "rgba(255,255,255,0.96)",
      backdropFilter: "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gap: 8
    }
  }, links.map((label, i) => /*#__PURE__*/React.createElement(Button, {
    key: i,
    variant: "ghost",
    fullWidth: true,
    style: {
      justifyContent: "flex-start"
    },
    onClick: () => setOpen(false)
  }, label))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    onClick: () => setOpen(false)
  }, d.login), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    fullWidth: true,
    onClick: () => setOpen(false)
  }, d.startFree))) : null);
}
window.EditorialHeader = EditorialHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/EditorialHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/EditorialHero.jsx
try { (() => {
// Vidora editorial landing — HERO (rebuilt to match the reference):
// LEFT text column (headline / paragraph / CTAs / chips), CENTER empty mockup
// placeholder, RIGHT category cards + CTA, and a full-width stats bar below.
// Layout stays LTR (not mirrored); Persian text blocks are right-aligned via
// per-block dir. Premium B&W, DS Button, tokens only.

function MockupPlaceholder() {
  const mockupSrc = `${import.meta.env.BASE_URL}images/vidora-macbook-mockup.png`;
  return /*#__PURE__*/React.createElement("div", {
    className: "vh-mockup",
    style: {
      width: "min(100%, 720px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      aspectRatio: "1635 / 962",
      padding: 0
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: mockupSrc,
    alt: "Vidora video learning interface with Persian subtitles, summary and key takeaways",
    width: 1635,
    height: 962,
    loading: "eager",
    fetchPriority: "high",
    decoding: "sync",
    style: {
      display: "block",
      width: "100%",
      maxWidth: 720,
      height: "auto",
      objectFit: "contain",
      filter: "none",
      boxShadow: "0 20px 42px -34px rgba(0,0,0,0.38)"
    }
  }));
}
function CategoryCard({
  item,
  rtl
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    dir: rtl ? "rtl" : "ltr",
    style: {
      display: "flex",
      gap: 14,
      alignItems: "flex-start",
      padding: "16px 18px",
      borderRadius: "var(--radius-xl)",
      border: "1px solid var(--ed-line)",
      background: "var(--ed-paper)",
      boxShadow: hover ? "var(--shadow-md)" : "var(--shadow-xs)",
      transition: "box-shadow var(--duration-base) var(--ease-standard), transform var(--duration-base) var(--ease-standard)",
      transform: hover ? "translateY(-2px)" : "none",
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      order: 2,
      width: 40,
      height: 40,
      borderRadius: "var(--radius-md)",
      background: "var(--muted)",
      border: "1px solid var(--ed-line)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--ed-ink)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: item.icon,
    size: 20,
    stroke: 1.6
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      order: 1,
      flex: 1,
      textAlign: rtl ? "right" : "left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 14.5,
      fontWeight: 700,
      lineHeight: 1.4,
      color: "var(--ed-ink)"
    }
  }, item.title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      lineHeight: 1.6,
      color: "var(--ed-text-muted)"
    }
  }, item.desc)));
}
function StatsBar({
  d,
  rtl
}) {
  const avatars = ["#d8d8d4", "#cfcfca", "#dededa", "#c8c8c3"];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 40,
      display: "flex",
      alignItems: "center",
      gap: 28,
      flexWrap: "wrap",
      justifyContent: "space-between",
      padding: "22px 28px",
      borderRadius: "var(--radius-2xl)",
      border: "1px solid var(--ed-line)",
      background: "var(--ed-paper)",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "row-reverse"
    }
  }, avatars.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-full)",
      background: c,
      border: "2px solid var(--ed-paper)",
      marginInlineStart: i === 0 ? 0 : -12
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 38,
      height: 38,
      borderRadius: "var(--radius-full)",
      background: "var(--ed-ink)",
      color: "#fff",
      border: "2px solid var(--ed-paper)",
      marginInlineStart: -12,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 10.5,
      fontWeight: 600
    }
  }, "+10K")), /*#__PURE__*/React.createElement("div", {
    dir: rtl ? "rtl" : "ltr",
    style: {
      textAlign: rtl ? "right" : "left"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 13.5,
      fontWeight: 600,
      color: "var(--ed-ink)"
    }
  }, d.joinTitle), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 3,
      display: "flex",
      alignItems: "center",
      gap: 6,
      flexDirection: rtl ? "row-reverse" : "row"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      color: "var(--ed-ink)"
    }
  }, [0, 1, 2, 3, 4].map(s => /*#__PURE__*/React.createElement(Icon, {
    key: s,
    name: "star",
    size: 12,
    fill: true
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 12,
      color: "var(--ed-text-muted)"
    }
  }, d.rating)))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 0,
      flexWrap: "wrap"
    }
  }, d.stats.map((st, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: "0 26px",
      borderInlineStart: i > 0 ? "1px solid var(--ed-line)" : "none",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 26,
      fontWeight: 700,
      letterSpacing: "-0.02em",
      color: "var(--ed-ink)"
    }
  }, st.num), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontFamily: "var(--font-sans)",
      fontSize: 12.5,
      color: "var(--ed-text-muted)"
    }
  }, st.label)))));
}
function EditorialHero() {
  const {
    Button
  } = window.VidoraDesignSystem_0f84f2;
  const {
    d,
    lang
  } = window.useLang();
  const rtl = lang === "fa";
  const align = rtl ? "right" : "left";
  const css = `
    .vh-wrap{ max-width:1440px; margin:0 auto; padding:52px 40px 40px; }
    .vh-grid{ display:grid; grid-template-columns:minmax(390px,.95fr) minmax(560px,1.3fr) 320px; gap:24px; align-items:center; }
    .vh-center{ display:flex; align-items:center; justify-content:center; min-height:430px; }
    .vh-right{ display:flex; flex-direction:column; gap:12px; align-self:center; }
    .vh-cardslot{ display:flex; }
    .vh-cardslot > div{ width:100%; min-height:102px; }
    .vh-catcta{ margin-top:2px; }
    .vh-cta{ display:flex; gap:12px; width:min(100%,520px); margin-top:28px; flex-wrap:wrap; align-items:center; }
    .vh-support{ width:min(100%,520px); margin-top:20px; color:#71717a; font-size:13px; line-height:1.9; }
    @media (max-width:1320px){
      .vh-grid{ grid-template-columns:1fr 1fr; }
      .vh-center{ order:2; grid-column:1 / -1; min-height:380px; }
      .vh-left{ order:1; } .vh-right{ order:3; grid-column:1 / -1; flex-direction:row; flex-wrap:wrap; }
      .vh-right .vh-cardslot{ flex:1 1 240px; } .vh-right .vh-catcta{ flex:1 1 100%; }
    }
    @media (max-width:760px){
      .vh-wrap{ padding:28px 20px; }
      .vh-grid{ grid-template-columns:1fr; gap:28px; }
      .vh-center{ min-height:260px; }
      .vh-right{ flex-direction:column; }
      .vh-cta,.vh-support{ width:100%; }
    }
  `;
  return /*#__PURE__*/React.createElement("section", {
    "data-screen-label": "Hero",
    style: {
      background: "var(--ed-paper)"
    }
  }, /*#__PURE__*/React.createElement("style", {
    dangerouslySetInnerHTML: {
      __html: css
    }
  }), /*#__PURE__*/React.createElement("div", {
    className: "vh-wrap"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vh-grid"
  }, /*#__PURE__*/React.createElement("div", {
    className: "vh-left",
    dir: rtl ? "rtl" : "ltr",
    style: {
      textAlign: align
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontFamily: "var(--font-sans)",
      fontWeight: 700,
      fontSize: "clamp(34px, 3.15vw, 46px)",
      lineHeight: 1.22,
      letterSpacing: "-0.01em",
      color: "var(--ed-ink)",
      maxWidth: 520,
      marginInlineEnd: "auto"
    }
  }, d.heroTitle.map((l, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 ? /*#__PURE__*/React.createElement("br", null) : null, l))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "20px 0 0",
      fontFamily: "var(--font-sans)",
      fontSize: 16.5,
      lineHeight: 1.9,
      color: "#52525b",
      maxWidth: 520,
      textAlign: rtl ? "right" : "left",
      marginInlineEnd: "auto",
      textWrap: "balance"
    }
  }, d.heroSubNew), /*#__PURE__*/React.createElement("div", {
    className: "vh-cta",
    style: {
      justifyContent: rtl ? "flex-end" : "flex-start",
      flexDirection: rtl ? "row-reverse" : "row",
      marginInlineEnd: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    style: {
      height: 44,
      padding: "0 24px",
      fontSize: 14.5,
      fontWeight: 600
    }
  }, d.ctaPrimary), /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    size: "md",
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "upload",
      size: 15,
      stroke: 1.7
    }),
    style: {
      height: 38,
      padding: "0 14px",
      fontSize: 13.5
    }
  }, d.ctaSecondary)), /*#__PURE__*/React.createElement("div", {
    className: "vh-chips",
    dir: rtl ? "rtl" : "ltr",
    style: {
      marginInlineEnd: "auto"
    }
  }, d.heroChips.map((c, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "vh-chip"
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 13,
    stroke: 2.4
  }), c)))), /*#__PURE__*/React.createElement("div", {
    className: "vh-center"
  }, /*#__PURE__*/React.createElement(MockupPlaceholder, null)), /*#__PURE__*/React.createElement("div", {
    className: "vh-right"
  }, d.categories.map((cat, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "vh-cardslot"
  }, /*#__PURE__*/React.createElement(CategoryCard, {
    item: cat,
    rtl: rtl
  }))), /*#__PURE__*/React.createElement("div", {
    className: "vh-catcta"
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "secondary",
    fullWidth: true,
    iconLeft: /*#__PURE__*/React.createElement(Icon, {
      name: "arrowRight",
      size: 15,
      stroke: 2
    })
  }, d.categoriesCta)))), /*#__PURE__*/React.createElement(StatsBar, {
    d: d,
    rtl: rtl
  })));
}
window.EditorialHero = EditorialHero;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/EditorialHero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/EditorialSections.jsx
try { (() => {
// Vidora editorial landing — pillars band, NEW KNOWLEDGE, features strip, curated cards
function EditorialPillars() {
  const {
    d
  } = window.useLang();
  const icons = ["cpu", "user", "globe"];
  const cols = d.pillars.map((p, i) => ({
    icon: icons[i],
    title: p.title,
    body: p.body
  }));
  return /*#__PURE__*/React.createElement("section", {
    "data-screen-label": "Pillars",
    style: {
      background: "#000",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1440,
      margin: "0 auto",
      padding: "72px 56px",
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)"
    }
  }, cols.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c.title,
    style: {
      padding: i === 0 ? "0 48px 0 0" : "0 48px",
      borderLeft: i > 0 ? "1px solid var(--ed-line-inverse)" : "none"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: c.icon,
    size: 36,
    stroke: 1.4
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: "26px 0 0",
      fontFamily: "var(--font-sans)",
      fontSize: 19,
      fontWeight: 600,
      letterSpacing: "0.04em",
      textTransform: "uppercase"
    }
  }, c.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "14px 0 0",
      fontFamily: "var(--font-sans)",
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--ed-text-muted-inverse)",
      maxWidth: 220
    }
  }, c.body)))));
}
function EditorialKnowledge() {
  const {
    Button
  } = window.VidoraDesignSystem_0f84f2;
  const {
    d
  } = window.useLang();
  return /*#__PURE__*/React.createElement("section", {
    "data-screen-label": "New knowledge",
    style: {
      position: "relative",
      background: "var(--ed-surface)",
      overflow: "hidden",
      minHeight: 460
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      width: "52%",
      minHeight: 420,
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("image-slot", {
    id: "learning-study",
    shape: "rect",
    fit: "cover",
    src: "data:image/jpeg;base64,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",
    placeholder: "Learning photo \u2014 person studying with laptop, watching a translated video or transcript. Calm, focused mood. Monochrome.",
    style: {
      width: "100%",
      height: "100%",
      background: "var(--ed-photo-fallback)",
      display: "block",
      filter: "var(--ed-photo-filter)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      maxWidth: 1440,
      margin: "0 auto",
      padding: "96px 56px",
      zIndex: 2
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "44%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: "var(--font-sans)",
      fontSize: 11.5,
      fontWeight: 600,
      letterSpacing: "var(--ed-caps-tracking-wide)",
      textTransform: "uppercase",
      color: "var(--ed-text-muted)"
    }
  }, d.learnMore), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: "20px 0 0",
      fontFamily: "var(--font-sans)",
      fontWeight: "var(--ed-display-weight)",
      fontSize: "clamp(44px, 4.6vw, 64px)",
      lineHeight: "var(--ed-display-leading)",
      letterSpacing: "var(--ed-display-tracking)",
      textTransform: "uppercase",
      color: "var(--ed-ink)"
    }
  }, d.knowledgeLines.map((l, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 ? /*#__PURE__*/React.createElement("br", null) : null, l))), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "28px 0 0",
      fontFamily: "var(--font-sans)",
      fontSize: 16,
      lineHeight: 1.6,
      color: "var(--ed-body)",
      maxWidth: 340
    }
  }, d.knowledgeBody), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    size: "lg",
    style: {
      marginTop: 34
    }
  }, d.exploreLibrary))));
}
function EditorialFeatures() {
  const {
    d
  } = window.useLang();
  const icons = ["globe", "subtitles", "fileText", "lock"];
  const feats = d.features.map((f, i) => ({
    icon: icons[i],
    title: f.title,
    body: f.body
  }));
  return /*#__PURE__*/React.createElement("section", {
    "data-screen-label": "Features",
    style: {
      background: "var(--ed-paper)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1440,
      margin: "0 auto",
      padding: "56px 56px",
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)"
    }
  }, feats.map((f, i) => /*#__PURE__*/React.createElement("div", {
    key: f.title,
    style: {
      display: "flex",
      gap: 16,
      alignItems: "flex-start",
      padding: i === 0 ? "0 36px 0 0" : "0 36px",
      borderLeft: i > 0 ? "1px solid var(--ed-line)" : "none"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: "none",
      color: "var(--ed-ink)",
      paddingTop: 2
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: f.icon,
    size: 27,
    stroke: 1.5
  })), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      fontFamily: "var(--font-sans)",
      fontSize: 11.5,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "var(--ed-ink)"
    }
  }, f.title), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "block",
      marginTop: 7,
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      lineHeight: 1.5,
      color: "var(--ed-text-muted)",
      maxWidth: 190
    }
  }, f.body))))));
}
function EditorialCurated() {
  const {
    d
  } = window.useLang();
  const base = [{
    slot: "curated-tech",
    author: "Dr. Mateo Alvarez",
    duration: "42:18",
    ph: "Thumbnail — speaker / interview visual. Monochrome, editorial."
  }, {
    slot: "curated-business",
    author: "Rina Patel",
    duration: "36:05",
    ph: "Thumbnail — business / founder on stage. Monochrome, editorial."
  }, {
    slot: "curated-world",
    author: "The Economist Intelligence",
    duration: "50:22",
    ph: "Thumbnail — global / news visual (earth, data). Monochrome, editorial."
  }];
  const cards = base.map((b, i) => ({
    ...b,
    eyebrow: d.cards[i].eyebrow,
    title: d.cards[i].title,
    meta: d.cards[i].meta
  }));
  return /*#__PURE__*/React.createElement("section", {
    "data-screen-label": "Curated for you",
    style: {
      background: "var(--ed-paper)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1440,
      margin: "0 auto",
      padding: "16px 56px 110px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "baseline",
      marginBottom: 26
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontFamily: "var(--font-sans)",
      fontSize: 20,
      fontWeight: 700,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      color: "var(--ed-ink)"
    }
  }, d.curatedTitle), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("a", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      whiteSpace: "nowrap",
      fontFamily: "var(--font-sans)",
      fontSize: 11.5,
      fontWeight: 600,
      letterSpacing: "var(--ed-caps-tracking)",
      textTransform: "uppercase",
      color: "var(--ed-ink)",
      textDecoration: "none",
      cursor: "pointer"
    }
  }, d.viewAll, " ", /*#__PURE__*/React.createElement(Icon, {
    name: "arrowRight",
    size: 15,
    stroke: 2
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 26
    }
  }, cards.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.slot,
    style: {
      cursor: "pointer"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16 / 9",
      borderRadius: "var(--ed-radius)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      filter: "var(--ed-photo-filter)"
    }
  }, /*#__PURE__*/React.createElement("image-slot", {
    id: c.slot,
    shape: "rect",
    fit: "cover",
    placeholder: c.ph,
    style: {
      width: "100%",
      height: "100%",
      background: "var(--ed-photo-fallback)",
      display: "block"
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      right: 10,
      bottom: 10,
      background: "rgba(0,0,0,0.85)",
      color: "#fff",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      fontWeight: 500,
      padding: "3px 7px",
      borderRadius: "var(--ed-radius)",
      pointerEvents: "none",
      zIndex: 2
    }
  }, c.duration)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      fontFamily: "var(--font-sans)",
      fontSize: 10.5,
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      color: "#8a8a86"
    }
  }, c.eyebrow), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 8,
      fontFamily: "var(--font-sans)",
      fontSize: 17.5,
      fontWeight: 600,
      lineHeight: 1.3,
      color: "var(--ed-ink)"
    }
  }, c.title), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 6,
      fontFamily: "var(--font-sans)",
      fontSize: 13,
      color: "var(--ed-text-muted)"
    }
  }, c.author), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 4,
      fontFamily: "var(--font-sans)",
      fontSize: 12,
      color: "#8a8a86"
    }
  }, c.meta))))));
}
window.EditorialPillars = EditorialPillars;
window.EditorialKnowledge = EditorialKnowledge;
window.EditorialFeatures = EditorialFeatures;
window.EditorialCurated = EditorialCurated;

const landingAsset = (name) => `${import.meta.env.BASE_URL}images/landing/${name}`;

function LandingSectionHeading({ children }) {
  return <div className="landing-centered-heading"><h2>{children}</h2><span aria-hidden="true" /></div>;
}

function ProcessStep({ title, body, icon: StepIcon }) {
  return <article className="landing-process-step"><span className="landing-process-icon"><StepIcon size={20} strokeWidth={1.7} /></span><h3>{title}</h3><p>{body}</p></article>;
}

function LandingAddVideoSection() {
  const { lang } = window.useLang();
  const rtl = lang === "fa";
  const steps = rtl ? [
    ["ویدیوی دلخواهتان را اضافه کنید", "فایل یا لینک ویدیو را وارد کنید تا پردازش آغاز شود.", Upload],
    ["محتوای آن را سریع‌تر درک کنید", "زیرنویس فارسی، خلاصه و نکات کلیدی خودکار آماده می‌شوند.", FileText],
    ["ویدیوهای خودتان را یکجا داشته باشید", "ویدیوها در کتابخانه شخصی‌تان ذخیره و همیشه در دسترس‌اند.", Library],
  ] : [
    ["Add your video", "Upload a file or add a video link to start processing immediately.", Upload],
    ["Receive the Persian version", "Persian subtitles, summaries, and key takeaways are prepared automatically.", FileText],
    ["Always within reach", "Every video stays searchable and available in your personal library.", Library],
  ];
  const goAdd = () => {
    const session = getCachedSession();
    trackEvent("add_video_attempted", { source: "landing", authenticated: Boolean(session), intent: "add-video" });
    window.location.hash = session ? "#/dashboard/new-translation" : buildAuthHash({ intent: "add-video", returnTo: ROUTES.addVideo });
  };
  return (
    <section className="landing-add" dir={rtl ? "rtl" : "ltr"}>
      <style>{`
        .landing-add{background:#050505;color:#fff}.landing-add-in{max-width:1280px;margin:auto;padding:46px 48px 32px}.landing-add-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.landing-process-step{position:relative;display:grid;min-width:0;grid-template-rows:40px auto auto;align-content:start;justify-items:start;padding:0 28px}.landing-process-step+.landing-process-step{border-inline-start:1px solid rgba(255,255,255,.15)}.landing-process-icon{display:grid;width:40px;height:40px;place-items:center;border:1px solid rgba(255,255,255,.14);border-radius:8px;background:#151515;color:#fff}.landing-process-step h3{margin:15px 0 0;font-size:16px;line-height:1.55}.landing-process-step p{width:100%;margin:7px 0 0;color:#a1a1aa;font-size:11.5px;line-height:1.85}.landing-add-action-wrap{display:flex;justify-content:center;margin-top:20px}@media(min-width:1200px){.landing-process-step p{white-space:nowrap}}@media(max-width:900px){.landing-process-step{padding-inline:22px}}@media(max-width:820px){.landing-add-in{padding:38px 32px 32px}.landing-add-grid{grid-template-columns:1fr}.landing-process-step{grid-template-rows:40px auto auto;padding:26px 0}.landing-process-step:first-child{padding-top:0}.landing-process-step+.landing-process-step{border-inline-start:0;border-top:1px solid rgba(255,255,255,.13)}.landing-process-step p{max-width:520px;font-size:12px;white-space:normal}.landing-add-action-wrap{margin-top:22px}.landing-add-action-wrap>button{width:100%;max-width:320px}}@media(max-width:600px){.landing-add-in{padding-inline:20px}}
        @media(max-width:767px){
          .landing-add{box-sizing:border-box;background:#fff;padding:0 16px;color:#fff}
          .landing-add-in{max-width:560px;padding:0}
          .landing-add-grid{overflow:hidden;grid-template-columns:1fr;border:1px solid #242426;border-radius:22px;background:#0b0b0c}
          .landing-process-step{direction:rtl;min-height:0;grid-template:"icon title" auto "icon body" auto / 52px minmax(0,1fr);column-gap:16px;row-gap:5px;align-items:start;justify-items:stretch;padding:24px 22px}
          .landing-process-step:first-child{padding-top:24px}
          .landing-process-step+.landing-process-step{border-top:1px solid #2e2e30;border-inline-start:0}
          .landing-process-icon{grid-area:icon;width:50px;height:50px;border-color:#343438;border-radius:13px;background:#111113}
          .landing-process-icon svg{width:24px;height:24px}
          .landing-process-step h3{grid-area:title;margin:0;color:#fff;font-size:16px;font-weight:800;line-height:1.75;text-align:right}
          .landing-process-step p{grid-area:body;max-width:none;margin:0;color:#a1a1aa;font-size:12.5px;line-height:1.9;text-align:right;white-space:normal}
          .landing-add-action-wrap{display:none}
        }
      `}</style>
      <div className="landing-add-in">
        <div className="landing-add-grid">{steps.map(([title, body, StepIcon]) => <ProcessStep key={title} title={title} body={body} icon={StepIcon} />)}</div>
        <div className="landing-add-action-wrap"><MotionButton rtl={rtl} onClick={goAdd} label={rtl ? "افزودن ویدیوی جدید" : "Add a new video"} /></div>
      </div>
    </section>
  );
}

function LandingCategoryCard({ item, rtl }) {
  const CategoryIcon = item.icon;
  return <a className="landing-category-card vidora-interactive-card" data-topic={item.topic} href={`#/library?topic=${item.topic}`}>
    <span className="landing-category-media vidora-interactive-media"><img src={landingAsset(item.image)} alt={item.alt} width="600" height="400" loading="lazy" style={{ objectPosition: item.position }} /></span>
    <span className="landing-category-badge"><CategoryIcon size={18} strokeWidth={1.7} /></span>
    <span className="landing-category-content"><strong>{item.title}</strong><span className="landing-category-desc">{item.desc}</span><span className="landing-category-link vidora-interactive-affordance">{rtl ? "مشاهده دسته‌بندی" : "View category"}</span></span>
  </a>;
}

function LandingCategories() {
  const { lang } = window.useLang();
  const rtl = lang === "fa";
  const items = rtl ? [
    { title: "هوش مصنوعی و ابزارهای جدید", desc: "کاربردهای عملی و ابزارهای جدید هوش مصنوعی", image: "category-ai.png", alt: "ربات انسان‌نما برای دسته‌بندی هوش مصنوعی", position: "38% 46%", icon: BrainCircuit, topic: "ai" },
    { title: "ساخت محصول و برنامه‌نویسی", desc: "از ایده تا محصول، طراحی، توسعه و رشد استارتاپ", image: "category-product.png", alt: "لپ‌تاپ و کد برای دسته‌بندی ساخت محصول", position: "45% 58%", icon: Code2, topic: "product" },
    { title: "یادگیری زبان با ویدیو", desc: "تقویت مکالمه، شنیداری و دایره لغات با ویدیوهای واقعی", image: "category-language.jpg", alt: "هدفون برای دسته‌بندی یادگیری زبان", position: "50% 52%", icon: Languages, topic: "language" },
    { title: "کسب‌وکار و رشد فردی", desc: "مهارت‌های مدیریتی، بهره‌وری و رشد فردی و شغلی", image: "category-business.jpg", alt: "گیاه مینیمال برای دسته‌بندی رشد فردی", position: "44% 56%", icon: TrendingUp, topic: "startups" },
  ] : [
    { title: "AI and new tools", desc: "Practical applications and the latest artificial intelligence tools.", image: "category-ai.png", alt: "Humanoid robot for the artificial intelligence category", position: "38% 46%", icon: BrainCircuit, topic: "ai" },
    { title: "Product and programming", desc: "From idea to product, design, development, and startup growth.", image: "category-product.png", alt: "Laptop and code for the product category", position: "45% 58%", icon: Code2, topic: "product" },
    { title: "Language learning with video", desc: "Build listening, speaking, and vocabulary with real videos.", image: "category-language.jpg", alt: "Headphones for the language learning category", position: "50% 52%", icon: Languages, topic: "language" },
    { title: "Business and personal growth", desc: "Management, productivity, and personal and career growth.", image: "category-business.jpg", alt: "Minimal plant for the personal growth category", position: "44% 56%", icon: TrendingUp, topic: "startups" },
  ];
  return (
    <section className="landing-categories" dir={rtl ? "rtl" : "ltr"}>
      <style>{`
        .landing-categories{background:#fff;color:#111}.landing-categories-in{max-width:1280px;margin:auto;padding:52px 48px 58px}.landing-centered-heading{text-align:center;margin-bottom:26px}.landing-centered-heading h2{margin:0;font-size:24px;font-weight:800;line-height:1.4}.landing-centered-heading>span{display:block;width:34px;height:1.5px;margin:10px auto 0;background:#18181b}.landing-category-heading{margin-bottom:28px;text-align:center}.landing-category-heading h2{margin:0;font-size:25px;font-weight:800;line-height:1.45}.landing-category-heading p{margin:5px 0 0;color:#71717a;font-size:12.5px;line-height:1.7}.landing-category-heading span{display:block;width:34px;height:1.5px;margin:11px auto 0;background:#18181b}.landing-category-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));grid-auto-rows:1fr;gap:18px}.landing-category-card{display:flex;height:100%;min-width:0;overflow:hidden;flex-direction:column;padding:0;border:1px solid #dedee2;border-radius:8px;background:#fff;color:#18181b;text-align:inherit;text-decoration:none;cursor:pointer}.landing-category-media{display:block;aspect-ratio:2/1;overflow:hidden;background:#e4e4e7}.landing-category-media img{display:block;width:100%;height:100%;object-fit:cover;filter:grayscale(1)}.landing-category-badge{position:relative;z-index:1;display:grid;width:36px;height:36px;flex:none;place-items:center;align-self:flex-start;margin-top:-18px;margin-inline-start:16px;border-radius:7px;background:#090909;color:#fff}.landing-category-content{display:flex;min-height:116px;flex:1;flex-direction:column;margin-top:-18px;padding:22px 18px 14px}.landing-category-content strong{min-height:22px;font-size:14px;line-height:1.55}.landing-category-desc{display:-webkit-box;min-height:40px;margin-top:5px;overflow:hidden;color:#52525b;font-size:11.5px;line-height:1.75;-webkit-line-clamp:2;-webkit-box-orient:vertical}.landing-category-link{margin-top:8px}@media(max-width:1100px){.landing-category-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.landing-category-media{aspect-ratio:2.15/1}}@media(max-width:600px){.landing-categories-in{padding:46px 20px 50px}.landing-category-grid{grid-template-columns:1fr}.landing-category-media{aspect-ratio:2.05/1}.landing-category-content{min-height:112px}}
        @media(max-width:767px){
          .landing-categories-in{max-width:560px;padding:48px 16px 54px}
          .landing-category-heading{margin-bottom:28px}
          .landing-category-heading h2{font-size:23px;line-height:1.65}
          .landing-category-heading p{margin-top:6px;font-size:12.5px}
          .landing-category-heading span{width:32px;height:2px;margin-top:13px}
          .landing-category-grid{grid-template-columns:1fr;gap:14px}
          .landing-category-card{border-color:#dedee2;border-radius:15px;box-shadow:none}
          .landing-category-card[data-topic="startups"]{order:1}
          .landing-category-card[data-topic="language"]{order:2}
          .landing-category-card[data-topic="product"]{order:3}
          .landing-category-card[data-topic="ai"]{order:4}
          .landing-category-media{aspect-ratio:1.65/1}
          .landing-category-badge{position:absolute;inset-inline-start:18px;top:calc(61% - 20px);width:40px;height:40px;margin:0;border-radius:10px}
          .landing-category-content{min-height:0;margin:0;padding:20px 18px 18px;direction:rtl;text-align:right}
          .landing-category-content strong{min-height:0;font-size:16px;line-height:1.7}
          .landing-category-desc{min-height:0;margin-top:4px;font-size:12.5px;line-height:1.8;-webkit-line-clamp:2}
          .landing-category-link{display:inline-flex;width:max-content;min-height:36px;box-sizing:border-box;align-items:center;justify-content:center;margin-top:14px;padding:0 16px;border:1px solid #d4d4d8;border-radius:999px;color:#3f3f46;font-size:11.5px;font-weight:700;white-space:nowrap}
        }
        @media(min-width:440px) and (max-width:767px){
          .landing-category-card{display:grid;grid-template-columns:40% minmax(0,1fr);min-height:132px;direction:ltr}
          .landing-category-media{grid-column:1;grid-row:1;aspect-ratio:auto;height:100%}
          .landing-category-badge{left:calc(40% - 20px);right:auto;top:calc(50% - 20px)}
          .landing-category-content{grid-column:2;grid-row:1;justify-content:center;padding:18px 22px 16px 28px}
          .landing-category-content strong{font-size:15.5px}
          .landing-category-desc{font-size:11.5px}
          .landing-category-link{min-height:34px;margin-top:10px;padding-inline:15px;font-size:11px}
        }
      `}</style>
      <div className="landing-categories-in">
        <div className="landing-category-heading"><h2>{rtl ? "از موضوع مورد علاقه‌تان شروع کنید" : "Start with a topic you love"}</h2><p>{rtl ? "دسته‌بندی‌های محبوب ویدورا" : "Popular Vidora categories"}</p><span aria-hidden="true" /></div>
        <div className="landing-category-grid">{items.map((item) => <LandingCategoryCard key={item.title} item={item} rtl={rtl} />)}</div>
      </div>
    </section>
  );
}

function FeaturedVideoCard({ video }) {
  return <a className="landing-video vidora-interactive-card" href={`#/watch/${video.slug}`}>
    <span className="landing-video-visual vidora-interactive-media"><img src={landingAsset(video.image)} alt={video.alt} width="800" height="450" loading="lazy" style={{ objectPosition: video.position }} /><span className="landing-video-duration" dir="ltr">{video.duration}</span></span>
    <span className="landing-video-content"><strong>{video.title}</strong><span className="landing-video-meta"><span dir="ltr">{video.speaker}</span><i aria-hidden="true">•</i><span>{video.meta}</span></span></span>
  </a>;
}

function LandingSelectedVideos() {
  const { lang } = window.useLang();
  const rtl = lang === "fa";
  const railRef = React.useRef(null);
  const videos = rtl ? [
    { title: "عادت‌های کوچک، تغییرات بزرگ", speaker: "Sam Altman", meta: "زیرنویس فارسی", duration: "28:31", image: "featured-video-3.jpg", alt: "پرتره سیاه و سفید سم آلتمن", position: "50% 36%", slug: "sam-altman-talk" },
    { title: "چطور در ۳۰ روز عادت جدید بسازیم", speaker: "Steve Jobs", meta: "زیرنویس فارسی", duration: "19:12", image: "featured-video-2.jpg", alt: "استیو جابز در حال سخنرانی", position: "54% 43%", slug: "product-builders" },
    { title: "آینده هوش مصنوعی و تأثیر آن بر انسان", speaker: "Elon Musk", meta: "زیرنویس فارسی", duration: "23:47", image: "featured-video-1.jpg", alt: "ایلان ماسک در یک گفت‌وگو", position: "50% 50%", slug: "future-of-ai" },
  ] : [
    { title: "Small habits, big changes", speaker: "Sam Altman", meta: "Persian subtitles", duration: "28:31", image: "featured-video-3.jpg", alt: "Black and white portrait of Sam Altman", position: "50% 36%", slug: "sam-altman-talk" },
    { title: "How to build a new habit in 30 days", speaker: "Steve Jobs", meta: "Persian subtitles", duration: "19:12", image: "featured-video-2.jpg", alt: "Steve Jobs speaking on stage", position: "54% 43%", slug: "product-builders" },
    { title: "Artificial intelligence and its impact on humanity", speaker: "Elon Musk", meta: "Persian subtitles", duration: "23:47", image: "featured-video-1.jpg", alt: "Elon Musk in conversation", position: "50% 50%", slug: "future-of-ai" },
  ];
  const scroll = (direction) => railRef.current?.scrollBy({ left: direction * Math.max(280, railRef.current.clientWidth * .72), behavior: "smooth" });
  return (
    <section className="landing-selected" dir={rtl ? "rtl" : "ltr"}>
      <style>{`
        .landing-selected{background:#fff;color:#111}.landing-selected-in{position:relative;max-width:1280px;margin:auto;padding:0 48px 70px}.landing-video-rail{display:flex;gap:18px;overflow-x:auto;scroll-behavior:smooth;scroll-snap-type:x mandatory;scrollbar-width:none}.landing-video-rail::-webkit-scrollbar{display:none}.landing-video{flex:0 0 calc((100% - 36px)/3);min-width:0;overflow:hidden;border:1px solid #dedee2;border-radius:8px;background:#fff;color:#18181b;text-decoration:none;scroll-snap-align:start}.landing-video:hover{border-color:#a1a1aa}.landing-video-visual{position:relative;display:block;aspect-ratio:16/8.8;overflow:hidden;background:#111}.landing-video-visual img{display:block;width:100%;height:100%;object-fit:cover;filter:grayscale(1)}.landing-video-duration{position:absolute;inset-inline-start:10px;bottom:9px;padding:3px 6px;border-radius:4px;background:rgba(0,0,0,.85);color:#fff;font-size:10.5px}.landing-video-content{display:block;padding:14px 16px 15px}.landing-video-content strong{display:-webkit-box;min-height:44px;overflow:hidden;font-size:14.5px;line-height:1.55;-webkit-line-clamp:2;-webkit-box-orient:vertical}.landing-video-meta{display:flex;align-items:center;gap:8px;margin-top:9px;color:#71717a;font-size:10.5px}.landing-video-meta i{font-style:normal;color:#a1a1aa}.landing-carousel-arrow{position:absolute;top:calc(50% - 8px);left:6px;z-index:2;display:grid;width:34px;height:34px;place-items:center;border:1px solid #dedee2;border-radius:999px;background:#fff;color:#18181b;cursor:pointer}.landing-carousel-arrow:disabled{cursor:default;opacity:.42}.landing-selected-action{display:flex;justify-content:center;margin-top:26px}@media(max-width:900px){.landing-video{flex-basis:calc((100% - 18px)/2)}}@media(max-width:767px){.landing-selected-in{overflow:hidden;padding:0 16px 54px}.landing-centered-heading{margin-bottom:22px}.landing-video-rail{gap:12px;overscroll-behavior-inline:contain;-webkit-overflow-scrolling:touch}.landing-video{flex:0 0 clamp(270px,82vw,360px);border-radius:7px}.landing-video-content{padding:10px 12px 11px}.landing-video-content strong{min-height:0;font-size:13px;line-height:1.6}.landing-video-meta{gap:6px;margin-top:6px;font-size:9.5px}.landing-video-duration{inset-inline-start:7px;bottom:7px;padding:2px 5px;font-size:9px}.landing-carousel-arrow{display:none}.landing-selected-action{margin-top:22px}.landing-selected-action>button{width:min(100%,286px);min-width:0}}@media(max-width:340px){.landing-selected-in{padding-inline:14px}.landing-video{flex-basis:clamp(264px,85vw,280px)}}
      `}</style>
      <div className="landing-selected-in">
        <LandingSectionHeading>{rtl ? "ویدیوهای منتخب" : "Featured videos"}</LandingSectionHeading>
        <button className="landing-carousel-arrow is-prev" aria-label={rtl ? "ویدیوهای قبلی" : "Previous videos"} onClick={() => scroll(-1)}><ArrowLeft size={17} /></button>
        <div className="landing-video-rail" ref={railRef} tabIndex="0" aria-label={rtl ? "ویدیوهای منتخب" : "Featured videos"} onKeyDown={(event) => { if (event.key === "ArrowLeft") scroll(-1); if (event.key === "ArrowRight") scroll(1); }}>{videos.map((video) => <FeaturedVideoCard key={video.slug} video={video} />)}</div>
        <div className="landing-selected-action"><MotionButton rtl={rtl} onClick={() => { window.location.hash = "#/library"; }} label={rtl ? "مشاهده همه ویدیوها" : "View all videos"} /></div>
      </div>
    </section>
  );
}

function LandingFooter() {
  const { lang } = window.useLang();
  return <VidoraFooter locale={lang === "fa" ? "fa" : "en"} />;
}
window.LandingAddVideoSection = LandingAddVideoSection;
window.LandingCategories = LandingCategories;
window.LandingSelectedVideos = LandingSelectedVideos;
window.LandingFooter = LandingFooter;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/EditorialSections.jsx", error: String((e && e.message) || e) }); }

const LandingAddVideoSection = window.LandingAddVideoSection;
const LandingCategories = window.LandingCategories;
const LandingSelectedVideos = window.LandingSelectedVideos;
const LandingFooter = window.LandingFooter;

// ui_kits/marketing/Footer.jsx
try { (() => {
// Vidora marketing — CTA band + footer
const {
  Button
} = window.VidoraDesignSystem_0f84f2;
function CTABand() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "#000",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 820,
      margin: "0 auto",
      padding: "96px 32px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/assets/logos/vidora-mark-white.png",
    alt: "",
    style: {
      height: 52,
      marginBottom: 24
    }
  }), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 46,
      fontWeight: 600,
      letterSpacing: "-0.035em",
      lineHeight: 1.08
    }
  }, "Unlock the world's knowledge"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "18px auto 32px",
      maxWidth: 500,
      fontSize: 18,
      color: "rgba(255,255,255,0.66)",
      lineHeight: 1.6
    }
  }, "Start watching anything in your language today. Free to try, no card required."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "brand",
    size: "lg"
  }, "Get started free"), /*#__PURE__*/React.createElement(Button, {
    size: "lg",
    style: {
      background: "rgba(255,255,255,0.1)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,0.2)"
    }
  }, "Watch a demo"))));
}
function Footer() {
  const cols = [{
    h: "Product",
    links: ["Discover", "Courses", "News", "For teams", "Pricing"]
  }, {
    h: "Company",
    links: ["About", "Careers", "Blog", "Press"]
  }, {
    h: "Resources",
    links: ["Help center", "Supported languages", "API", "Status"]
  }, {
    h: "Legal",
    links: ["Privacy", "Terms", "Cookies"]
  }];
  const link = {
    fontSize: 14,
    color: "var(--muted-foreground)",
    textDecoration: "none",
    cursor: "pointer",
    lineHeight: 2
  };
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      background: "var(--background)",
      borderTop: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-2xl)",
      margin: "0 auto",
      padding: "64px 32px 40px",
      display: "grid",
      gridTemplateColumns: "1.6fr repeat(4, 1fr)",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("img", {
    src: "/assets/logos/vidora-logo-black.png",
    alt: "Vidora",
    style: {
      height: 24
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14,
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.14em",
      color: "var(--muted-foreground)"
    }
  }, "WATCH. UNDERSTAND. GROW.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.h
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      marginBottom: 8
    }
  }, c.h), c.links.map(l => /*#__PURE__*/React.createElement("div", {
    key: l
  }, /*#__PURE__*/React.createElement("a", {
    style: link
  }, l)))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-2xl)",
      margin: "0 auto",
      padding: "20px 32px",
      borderTop: "1px solid var(--border)",
      display: "flex",
      justifyContent: "space-between",
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 Vidora, Inc."), /*#__PURE__*/React.createElement("span", null, "Made for learners everywhere")));
}
window.CTABand = CTABand;
window.Footer = Footer;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Footer.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Hero.jsx
try { (() => {
// Vidora marketing — hero with paste-a-link input
const {
  Button,
  Badge
} = window.VidoraDesignSystem_0f84f2;
function Hero() {
  const [url, setUrl] = React.useState("");
  return /*#__PURE__*/React.createElement("section", {
    style: {
      position: "relative",
      overflow: "hidden",
      background: "var(--gradient-brand-soft)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 940,
      margin: "0 auto",
      padding: "96px 32px 104px",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    dot: true
  }, "AI subtitles in 48 languages")), /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: "clamp(40px, 6vw, 68px)",
      fontWeight: 600,
      lineHeight: 1.05,
      letterSpacing: "-0.035em",
      color: "var(--foreground)"
    }
  }, "Understand any video.", /*#__PURE__*/React.createElement("br", null), "In your language."), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "24px auto 0",
      maxWidth: 620,
      fontSize: 19,
      lineHeight: 1.6,
      color: "var(--muted-foreground)"
    }
  }, "Paste a link or upload a video. Vidora generates accurate subtitles and a full transcript \u2014 so you can watch, understand, and learn without language barriers."), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "36px auto 0",
      maxWidth: 620,
      display: "flex",
      gap: 10,
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-full)",
      padding: 8,
      boxShadow: "var(--shadow-lg)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      flex: 1,
      padding: "0 8px 0 16px"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "link",
    size: 18,
    style: {
      color: "var(--muted-foreground)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("input", {
    value: url,
    onChange: e => setUrl(e.target.value),
    placeholder: "Paste a YouTube link\u2026",
    style: {
      flex: 1,
      minWidth: 0,
      border: "none",
      outline: "none",
      background: "transparent",
      fontFamily: "var(--font-sans)",
      fontSize: 16,
      color: "var(--foreground)"
    }
  })), /*#__PURE__*/React.createElement(Button, {
    variant: "brand",
    size: "lg",
    iconRight: /*#__PURE__*/React.createElement(Icon, {
      name: "arrowRight",
      size: 18
    }),
    style: {
      borderRadius: "var(--radius-full)"
    }
  }, "Translate")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "No credit card needed \xB7 First 3 videos free")));
}
window.Hero = Hero;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Hero.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/MarketingHeader.jsx
try { (() => {
// Vidora marketing — header / nav
const {
  Button,
  Badge
} = window.VidoraDesignSystem_0f84f2;
function MarketingHeader() {
  const link = {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--muted-foreground)",
    textDecoration: "none",
    padding: "6px 4px",
    cursor: "pointer"
  };
  return /*#__PURE__*/React.createElement("header", {
    style: {
      position: "sticky",
      top: 0,
      zIndex: 20,
      background: "color-mix(in oklch, var(--background) 82%, transparent)",
      backdropFilter: "blur(var(--blur-md))",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-2xl)",
      margin: "0 auto",
      height: 68,
      padding: "0 32px",
      display: "flex",
      alignItems: "center",
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/assets/logos/vidora-logo-black.png",
    alt: "Vidora",
    style: {
      height: 26
    }
  }), /*#__PURE__*/React.createElement("nav", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 24,
      marginLeft: 8
    }
  }, /*#__PURE__*/React.createElement("a", {
    style: link
  }, "Discover"), /*#__PURE__*/React.createElement("a", {
    style: link
  }, "Courses"), /*#__PURE__*/React.createElement("a", {
    style: link
  }, "For teams"), /*#__PURE__*/React.createElement("a", {
    style: link
  }, "Pricing")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    size: "md"
  }, "Sign in"), /*#__PURE__*/React.createElement(Button, {
    variant: "brand",
    size: "md"
  }, "Get started free"))));
}
window.MarketingHeader = MarketingHeader;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/MarketingHeader.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/Sections.jsx
try { (() => {
// Vidora marketing — how it works, content showcase, pricing
const {
  Button,
  Badge,
  VideoCard,
  PosterCard,
  CategoryChip,
  Card
} = window.VidoraDesignSystem_0f84f2;
const G = ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#243b2f,#14532d)", "linear-gradient(135deg,#3a2733,#5e2f3b)", "linear-gradient(135deg,#26313f,#1f2937)", "linear-gradient(135deg,#3a3320,#5e4a2f)"];
function HowItWorks() {
  const steps = [{
    icon: "link",
    title: "Paste a link or upload",
    body: "Drop in a YouTube URL or your own file. Any language, any length."
  }, {
    icon: "sparkles",
    title: "AI translates it",
    body: "Vidora generates accurate subtitles and a full transcript in seconds."
  }, {
    icon: "play",
    title: "Watch & learn",
    body: "Follow along with bilingual subtitles and a clickable transcript."
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: "var(--container-xl)",
      margin: "0 auto",
      padding: "96px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 56
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--brand)",
      marginBottom: 12
    }
  }, "How it works"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: "-0.03em"
    }
  }, "From link to understood in seconds")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 24
    }
  }, steps.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      padding: 28,
      background: "var(--card)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: "var(--shadow-sm)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 44,
      height: 44,
      borderRadius: "var(--radius-lg)",
      background: "var(--brand-subtle)",
      color: "var(--brand)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.icon,
    size: 22,
    fill: s.icon === "play"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontFamily: "var(--font-mono)",
      color: "var(--muted-foreground)",
      marginBottom: 6
    }
  }, "0", i + 1), /*#__PURE__*/React.createElement("h3", {
    style: {
      margin: "0 0 8px",
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "-0.01em"
    }
  }, s.title), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: 0,
      fontSize: 15,
      lineHeight: 1.6,
      color: "var(--muted-foreground)"
    }
  }, s.body)))));
}
function Showcase() {
  const [cat, setCat] = React.useState("All");
  const cats = ["All", "AI", "Business", "Founder stories", "Documentaries", "Languages"];
  const videos = [{
    title: "How Stripe was built from scratch",
    source: "Founder Stories",
    meta: "1.2M views",
    duration: "42:10",
    g: 0,
    tr: true
  }, {
    title: "The state of AI in 2026",
    source: "Vidora News",
    meta: "308K views",
    duration: "08:24",
    g: 3,
    tr: true
  }, {
    title: "Inside the mind of a founder",
    source: "Biographies",
    meta: "540K views",
    duration: "31:55",
    g: 1,
    tr: false
  }, {
    title: "Building companies that last",
    source: "Courses",
    meta: "92K views",
    duration: "18:02",
    g: 4,
    tr: true
  }];
  const posters = [{
    eyebrow: "Documentary",
    title: "The Rise of Silicon Valley",
    g: 2
  }, {
    eyebrow: "Course",
    title: "Foundations of Machine Learning",
    g: 0
  }, {
    eyebrow: "Biography",
    title: "The Woman Who Built Modern Computing",
    g: 3
  }, {
    eyebrow: "Series",
    title: "How Iconic Companies Were Built",
    g: 1
  }, {
    eyebrow: "Documentary",
    title: "A Brief History of the Internet",
    g: 4
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      background: "var(--muted)",
      borderTop: "1px solid var(--border)",
      borderBottom: "1px solid var(--border)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: "var(--container-2xl)",
      margin: "0 auto",
      padding: "88px 32px"
    }
  }, /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: "-0.03em",
      textAlign: "center"
    }
  }, "A world of knowledge, translated"), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "16px auto 36px",
      maxWidth: 560,
      textAlign: "center",
      fontSize: 17,
      color: "var(--muted-foreground)",
      lineHeight: 1.6
    }
  }, "Courses, documentaries, founder stories and world news \u2014 curated and understandable in your language."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      justifyContent: "center",
      flexWrap: "wrap",
      marginBottom: 36
    }
  }, cats.map(c => /*#__PURE__*/React.createElement(CategoryChip, {
    key: c,
    label: c,
    active: c === cat,
    onClick: () => setCat(c)
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 20,
      overflowX: "auto",
      paddingBottom: 8,
      marginBottom: 32
    }
  }, videos.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(VideoCard, {
    size: "md",
    title: v.title,
    source: v.source,
    meta: v.meta,
    duration: v.duration,
    translated: v.tr,
    thumbnail: G[v.g]
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 18,
      overflowX: "auto",
      paddingBottom: 8
    }
  }, posters.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(PosterCard, {
    size: "md",
    eyebrow: p.eyebrow,
    title: p.title,
    thumbnail: G[p.g]
  }))))));
}
function Pricing() {
  const tiers = [{
    name: "Free",
    price: "$0",
    per: "forever",
    desc: "For trying Vidora out.",
    feats: ["3 videos / month", "12 languages", "Auto subtitles"],
    cta: "Get started",
    variant: "outline"
  }, {
    name: "Pro",
    price: "$12",
    per: "per month",
    desc: "For serious learners.",
    feats: ["Unlimited videos", "48 languages", "Bilingual transcript", "Download subtitles", "Offline saves"],
    cta: "Start Pro",
    variant: "brand",
    featured: true
  }, {
    name: "Teams",
    price: "$29",
    per: "per seat / month",
    desc: "For classrooms & teams.",
    feats: ["Everything in Pro", "Shared libraries", "Admin & SSO", "Priority processing"],
    cta: "Contact sales",
    variant: "secondary"
  }];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      maxWidth: "var(--container-xl)",
      margin: "0 auto",
      padding: "96px 32px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: "center",
      marginBottom: 56
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      color: "var(--brand)",
      marginBottom: 12
    }
  }, "Pricing"), /*#__PURE__*/React.createElement("h2", {
    style: {
      margin: 0,
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: "-0.03em"
    }
  }, "Simple, transparent pricing")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3, 1fr)",
      gap: 20,
      alignItems: "start"
    }
  }, tiers.map(t => /*#__PURE__*/React.createElement("div", {
    key: t.name,
    style: {
      position: "relative",
      padding: 28,
      background: "var(--card)",
      border: t.featured ? "1.5px solid var(--brand)" : "1px solid var(--border)",
      borderRadius: "var(--radius-2xl)",
      boxShadow: t.featured ? "var(--glow-brand-lg)" : "var(--shadow-sm)"
    }
  }, t.featured ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      top: -12,
      left: "50%",
      transform: "translateX(-50%)"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "solid"
  }, "Most popular")) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, t.name), /*#__PURE__*/React.createElement("div", {
    style: {
      margin: "12px 0 4px",
      display: "flex",
      alignItems: "baseline",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 40,
      fontWeight: 600,
      letterSpacing: "-0.03em"
    }
  }, t.price), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 14,
      color: "var(--muted-foreground)"
    }
  }, t.per)), /*#__PURE__*/React.createElement("p", {
    style: {
      margin: "0 0 20px",
      fontSize: 14,
      color: "var(--muted-foreground)"
    }
  }, t.desc), /*#__PURE__*/React.createElement(Button, {
    variant: t.variant,
    fullWidth: true
  }, t.cta), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20,
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, t.feats.map(f => /*#__PURE__*/React.createElement("div", {
    key: f,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 14
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--brand)",
      flex: "none",
      display: "inline-flex"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "check",
    size: 16,
    stroke: 2.4
  })), f)))))));
}
window.HowItWorks = HowItWorks;
window.Showcase = Showcase;
window.Pricing = Pricing;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/Sections.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/i18n.js
try { (() => {
// Vidora landing — i18n runtime (Persian-default, RTL) + fa/en dictionary.
// Persian is the source/default language; English is the LTR secondary.
// Exposes: window.VIDORA_DICT, window.applyVidoraLang(lang), window.useLang().
// Direction, <html lang/dir>, the Persian webfont class, and localStorage are
// all driven from applyVidoraLang so any surface stays in sync.

window.VIDORA_DICT = {
  fa: {
    nav: {
      product: "محصولات",
      library: "کتابخانه",
      pricing: "قیمت‌گذاری"
    },
    login: "ورود",
    startFree: "شروع رایگان",
    startMembership: "شروع عضویت",
    exploreLibrary: "کاوش در کتابخانه",
    heroTitle: ["ویدیوهای روز دنیا را", "به زبان خودتان درک کنید"],
    heroSubNew: "ویدیوهای مرتبط با علایق و نیازتان را پیدا کنید، به فارسی تماشا کنید و با کمک خلاصه‌ها و نکات کلیدی هوشمند، سریع‌تر به محتوای اصلی برسید. همچنین می‌توانید ویدیوهای دلخواه خودتان را به Vidora اضافه کنید.",
    ctaPrimary: "شروع استفاده از ویدورا",
    heroSupport: "جست‌وجوی هوشمند · زیرنویس فارسی · خلاصه و نکات کلیدی · کتابخانه شخصی",
    ctaSecondary: "ترجمه ویدیوی خودم",
    heroChips: ["زیرنویس دقیق فارسی", "خلاصه و نکات کلیدی", "ابزارهای یادگیری هوشمند", "ترجمه ویدیوی خودت"],
    categories: [{
      title: "هوش مصنوعی و ابزارهای جدید",
      desc: "یادگیری AI، ابزارهای کاربردی، عملی در دنیای واقعی",
      icon: "sparkles"
    }, {
      title: "ساخت محصول و برنامه‌نویسی",
      desc: "از ایده تا محصول، کدنویسی، طراحی محصول و رشد استارتاپ",
      icon: "cpu"
    }, {
      title: "یادگیری زبان با ویدیو",
      desc: "تقویت مکالمه، شنیداری و دایره لغات با ویدیوهای واقعی",
      icon: "globe"
    }, {
      title: "بیزنس و رشد فردی",
      desc: "مهارت‌های شغلی، مدیریت زمان، بازاریابی و تصمیم‌گیری بهتر",
      icon: "trending"
    }],
    categoriesCta: "مشاهده همه دسته‌ها",
    joinTitle: "به جمع یادگیرندگان بپیوندید",
    rating: "۴.۹ از ۵",
    stats: [{
      num: "+۱۰K",
      label: "کاربر فعال"
    }, {
      num: "+۴۰K",
      label: "ویدیو ترجمه شده"
    }, {
      num: "+۱M",
      label: "دقیقه یادگیری"
    }, {
      num: "+۴۸",
      label: "زبان پشتیبانی شده"
    }],
    heroLines: ["هر ویدیو.", "هر زبان."],
    heroSub: "جهان را از طریق دانش بفهمید. زیرنویس، دوبله و رونوشت با هوش مصنوعی.",
    plusLangs: "+ ۴۸ زبان",
    learnMore: "بیشتر بیاموزید",
    knowledgeLines: ["دانش", "نو"],
    knowledgeBody: "از هوش مصنوعی تا هنر، از علم تا جامعه. درس‌های منتخب، ترجمه‌شده برای شما.",
    pillars: [{
      title: "فناوری و هوش مصنوعی",
      body: "ایده‌های پیشرو از برترین متخصصان جهان."
    }, {
      title: "داستان بنیان‌گذاران",
      body: "گفت‌وگوهای واقعی با سازندگان برجسته."
    }, {
      title: "نگاه جهانی",
      body: "اخبار، اقتصاد و مسائل جهانی در بستر واقعی."
    }],
    features: [{
      title: "+۴۸ زبان",
      body: "به زبان خودتان بیاموزید."
    }, {
      title: "زیرنویس هوش مصنوعی",
      body: "ترجمهٔ دقیق و بی‌درنگ زیرنویس."
    }, {
      title: "رونوشت دوزبانه",
      body: "حین یادگیری بخوانید، جست‌وجو و مرور کنید."
    }, {
      title: "دسترسی عضویت",
      body: "دسترسی نامحدود به محتوای ویژه."
    }],
    curatedTitle: "منتخب برای شما",
    viewAll: "مشاهدهٔ همه",
    cards: [{
      eyebrow: "فناوری و هوش مصنوعی",
      title: "عصر تازهٔ رایانش",
      meta: "EN · ۱۲ زبان"
    }, {
      eyebrow: "کسب‌وکار",
      title: "رهبری در دل تغییر",
      meta: "EN · ۱۰ زبان"
    }, {
      eyebrow: "نگاه جهانی",
      title: "چشم‌انداز جهانی ۲۰۲۴",
      meta: "EN · ۱۵ زبان"
    }],
    footer: {
      tagline: "تماشا کنید. بفهمید. رشد کنید. هر ویدیو، به زبان شما.",
      rights: "© {year} ویدورا. تمام حقوق محفوظ است.",
      sections: [{
        label: "محصول",
        links: ["ویژگی‌ها", "قیمت‌گذاری", "برای تیم‌ها", "یکپارچه‌سازی‌ها"]
      }, {
        label: "شرکت",
        links: ["دربارهٔ ما", "فرصت‌های شغلی", "حریم خصوصی", "شرایط استفاده"]
      }, {
        label: "منابع",
        links: ["وبلاگ", "مرکز راهنما", "زبان‌ها", "تغییرات"]
      }, {
        label: "ما را دنبال کنید",
        links: ["X / Twitter", "YouTube", "LinkedIn", "Instagram"]
      }]
    }
  },
  en: {
    nav: {
      product: "Products",
      library: "Library",
      pricing: "Pricing"
    },
    login: "Log in",
    startFree: "Start free",
    startMembership: "Start membership",
    exploreLibrary: "Explore library",
    heroTitle: ["Understand today's videos", "in your own language"],
    heroSubNew: "Find videos that match your interests, watch them in Persian, and reach the key ideas faster with smart summaries and takeaways. You can also add your own videos to Vidora.",
    ctaPrimary: "Start using Vidora",
    heroSupport: "Smart discovery · Persian subtitles · Summaries and takeaways · Personal library",
    ctaSecondary: "Translate my video",
    heroChips: ["Accurate Persian subtitles", "Summaries & key points", "Smart learning tools"],
    categories: [{
      title: "AI & new tools",
      desc: "Learn AI and practical tools, applied to the real world.",
      icon: "sparkles"
    }, {
      title: "Product & engineering",
      desc: "From idea to product — coding, product design, and startup growth.",
      icon: "cpu"
    }, {
      title: "Language learning by video",
      desc: "Build conversation, listening, and vocabulary with real videos.",
      icon: "globe"
    }, {
      title: "Business & personal growth",
      desc: "Career skills, time management, marketing, and better decisions.",
      icon: "trending"
    }],
    categoriesCta: "View all categories",
    joinTitle: "Join the learners",
    rating: "4.9 of 5",
    stats: [{
      num: "+10K",
      label: "Active users"
    }, {
      num: "+40K",
      label: "Videos translated"
    }, {
      num: "+1M",
      label: "Minutes learned"
    }, {
      num: "+48",
      label: "Languages supported"
    }],
    heroLines: ["Any", "video.", "Any", "language."],
    heroSub: "Understand the world through knowledge. AI subtitles, dubbing, and transcripts.",
    plusLangs: "+  48 languages",
    learnMore: "Learn more",
    knowledgeLines: ["New", "Knowledge"],
    knowledgeBody: "From AI to art, science to society. Curated lessons. Translated for you.",
    pillars: [{
      title: "Tech & AI",
      body: "Cutting-edge ideas from the world's top experts."
    }, {
      title: "Founder Stories",
      body: "Real conversations with remarkable builders."
    }, {
      title: "World Insights",
      body: "News, economics, and global affairs in context."
    }],
    features: [{
      title: "48+ Languages",
      body: "Learn in your own language."
    }, {
      title: "AI Subtitles",
      body: "Accurate, real-time subtitle translation."
    }, {
      title: "Bilingual Transcripts",
      body: "Read, search, and review while you learn."
    }, {
      title: "Membership Access",
      body: "Unlimited access to premium content."
    }],
    curatedTitle: "Curated for you",
    viewAll: "View all library",
    cards: [{
      eyebrow: "Tech & AI",
      title: "The Next Era of Computing",
      meta: "EN · 12 languages"
    }, {
      eyebrow: "Business",
      title: "Leading Through Change",
      meta: "EN · 10 languages"
    }, {
      eyebrow: "World Insights",
      title: "Global Outlook 2024",
      meta: "EN · 15 languages"
    }],
    footer: {
      tagline: "Watch. Understand. Grow. Any video, in your language.",
      rights: "© {year} Vidora. All rights reserved.",
      sections: [{
        label: "Product",
        links: ["Features", "Pricing", "For teams", "Integrations"]
      }, {
        label: "Company",
        links: ["About", "Careers", "Privacy Policy", "Terms of Service"]
      }, {
        label: "Resources",
        links: ["Blog", "Help center", "Languages", "Changelog"]
      }, {
        label: "Follow",
        links: ["X / Twitter", "YouTube", "LinkedIn", "Instagram"]
      }]
    }
  }
};
window.__vidoraLang = function () {
  try {
    return window.localStorage.getItem("vidora-lang") || "fa";
  } catch (e) {
    return "fa";
  }
}();
window.applyVidoraLang = function (lang) {
  if (lang !== "fa" && lang !== "en") lang = "fa";
  window.__vidoraLang = lang;
  var h = document.documentElement;
  // Layout stays LTR/stable — we only switch the content language + webfont.
  // (RTL is applied at the text level per element, not on the page wrapper.)
  h.setAttribute("dir", "ltr");
  h.setAttribute("lang", lang);
  h.classList.toggle("lang-fa", lang === "fa");
  try {
    window.localStorage.setItem("vidora-lang", lang);
  } catch (e) {/* ignore */}
  window.dispatchEvent(new CustomEvent("vidoralangchange", {
    detail: lang
  }));
};

// React hook — re-renders subscribers on language change.
window.useLang = function () {
  var st = React.useState(window.__vidoraLang);
  React.useEffect(function () {
    var on = function (e) {
      st[1](e && e.detail || window.__vidoraLang);
    };
    window.addEventListener("vidoralangchange", on);
    return function () {
      window.removeEventListener("vidoralangchange", on);
    };
  }, []);
  var lang = st[0];
  var d = window.VIDORA_DICT[lang] || window.VIDORA_DICT.en;
  var t = function (key) {
    return d[key] !== undefined ? d[key] : window.VIDORA_DICT.en[key] !== undefined ? window.VIDORA_DICT.en[key] : key;
  };
  return {
    lang: lang,
    dir: lang === "fa" ? "rtl" : "ltr",
    t: t,
    d: d,
    setLang: window.applyVidoraLang
  };
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/i18n.js", error: String((e && e.message) || e) }); }

// ui_kits/mobile/MobileScreens.jsx
try { (() => {
// Vidora mobile — Home, Watch, Search screens + tab bar
const {
  VideoCard,
  PosterCard,
  CategoryChip,
  Badge,
  TranscriptLine,
  LanguageBadge,
  IconButton,
  Tabs,
  Avatar
} = window.VidoraDesignSystem_0f84f2;
const MG = ["linear-gradient(135deg,#1e2a4a,#3b2f5e)", "linear-gradient(135deg,#243b2f,#14532d)", "linear-gradient(135deg,#3a2733,#5e2f3b)", "linear-gradient(135deg,#26313f,#1f2937)", "linear-gradient(135deg,#3a3320,#5e4a2f)"];
function TabBar({
  active
}) {
  const tabs = [{
    id: "home",
    icon: "home",
    label: "Home"
  }, {
    id: "search",
    icon: "search",
    label: "Search"
  }, {
    id: "library",
    icon: "library",
    label: "Library"
  }, {
    id: "profile",
    icon: "user",
    label: "You"
  }];
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      flex: "none",
      height: 76,
      borderTop: "1px solid var(--border)",
      background: "color-mix(in oklch, var(--background) 88%, transparent)",
      backdropFilter: "blur(var(--blur-md))",
      display: "flex",
      paddingBottom: 14
    }
  }, tabs.map(t => {
    const on = t.id === active;
    return /*#__PURE__*/React.createElement("div", {
      key: t.id,
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 4,
        color: on ? "var(--brand)" : "var(--muted-foreground)"
      }
    }, /*#__PURE__*/React.createElement(Icon, {
      name: t.icon,
      size: 23,
      fill: false,
      stroke: on ? 2.1 : 1.75
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 10.5,
        fontWeight: on ? 600 : 500
      }
    }, t.label));
  }));
}
function MobileHeader({
  title
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      display: "flex",
      alignItems: "center",
      padding: "4px 18px 12px"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "/assets/logos/vidora-mark-black.png",
    alt: "",
    style: {
      height: 26,
      marginRight: 8
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 22,
      fontWeight: 700,
      letterSpacing: "-0.02em"
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Avatar, {
    name: "Maya Chen",
    size: "sm"
  }));
}
function MobileHome() {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(MobileHeader, {
    title: "Vidora"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "0 18px 24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      overflowX: "auto",
      paddingBottom: 14
    }
  }, ["All", "AI", "Business", "News", "Docs"].map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c,
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(CategoryChip, {
    label: c,
    active: i === 0
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      borderRadius: "var(--radius-2xl)",
      overflow: "hidden",
      aspectRatio: "16/10",
      background: MG[2],
      display: "flex",
      alignItems: "flex-end",
      padding: 18,
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--gradient-scrim-bottom)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    dot: true
  }, "Translated")), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      lineHeight: 1.15
    }
  }, "The Rise of Silicon Valley"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "rgba(255,255,255,0.75)",
      marginTop: 4
    }
  }, "Documentary \xB7 58 min"))), /*#__PURE__*/React.createElement(MobileRow, {
    title: "Continue watching",
    items: [{
      title: "How Stripe was built",
      source: "Founder Stories",
      duration: "42:10",
      p: 35,
      g: 0
    }, {
      title: "The state of AI in 2026",
      source: "Vidora News",
      duration: "08:24",
      p: 72,
      g: 3
    }]
  }), /*#__PURE__*/React.createElement(MobileRow, {
    title: "Translated news",
    items: [{
      title: "AI regulations explained",
      source: "Reuters",
      duration: "06:12",
      g: 4
    }, {
      title: "Markets this week",
      source: "Bloomberg",
      duration: "04:45",
      g: 1
    }]
  })), /*#__PURE__*/React.createElement(TabBar, {
    active: "home"
  }));
}
function MobileRow({
  title,
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 22
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      letterSpacing: "-0.01em"
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "chevronRight",
    size: 18,
    style: {
      color: "var(--muted-foreground)"
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      overflowX: "auto"
    }
  }, items.map((v, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(VideoCard, {
    size: "sm",
    title: v.title,
    source: v.source,
    duration: v.duration,
    progress: v.p || null,
    translated: true,
    thumbnail: MG[v.g]
  })))));
}
function MobileWatch() {
  const [active, setActive] = React.useState(1);
  const lines = [{
    t: "01:09",
    o: "It didn't start with computers.",
    tr: "No empezó con computadoras."
  }, {
    t: "01:18",
    o: "We started with a very simple idea.",
    tr: "Empezamos con una idea muy simple."
  }, {
    t: "01:24",
    o: "Nobody thought it would work.",
    tr: "Nadie pensó que funcionaría."
  }, {
    t: "01:31",
    o: "So we just kept shipping.",
    tr: "Así que seguimos lanzando."
  }];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      aspectRatio: "16/9",
      background: "linear-gradient(135deg,#101828,#1e2a4a 60%,#3b2f5e)",
      flex: "none",
      display: "flex",
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("button", {
    "aria-label": "Play",
    style: {
      position: "absolute",
      inset: 0,
      margin: "auto",
      width: 58,
      height: 58,
      borderRadius: "50%",
      border: "none",
      background: "rgba(0,0,0,0.42)",
      backdropFilter: "blur(8px)",
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 26,
    fill: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      padding: "0 6px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 12px 12px",
      background: "var(--gradient-scrim-bottom)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 4,
      borderRadius: 4,
      background: "rgba(255,255,255,0.28)",
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: "100%",
      width: "30%",
      background: "var(--brand)",
      borderRadius: 4
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 14,
      color: "#fff"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "play",
    size: 20,
    fill: true
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12
    }
  }, "03:04 / 42:10"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "subtitles",
    size: 20
  }), /*#__PURE__*/React.createElement(Icon, {
    name: "maximize",
    size: 18
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "16px 18px 24px"
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      margin: 0,
      fontSize: 19,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      lineHeight: 1.25
    }
  }, "The Rise of Silicon Valley"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginTop: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Badge, {
    tone: "brand",
    dot: true
  }, "Espa\xF1ol"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--muted-foreground)"
    }
  }, "1.2M views \xB7 2w ago")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      margin: "14px 0 18px"
    }
  }, /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "heart",
      size: 19
    }),
    label: "Like",
    variant: "outline"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "bookmark",
      size: 19
    }),
    label: "Save",
    variant: "outline"
  }), /*#__PURE__*/React.createElement(IconButton, {
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "share",
      size: 19
    }),
    label: "Share",
    variant: "outline"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(LanguageBadge, {
    language: "Espa\xF1ol",
    translated: true
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      marginBottom: 6,
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "sparkles",
    size: 14,
    style: {
      color: "var(--brand)"
    }
  }), " Bilingual transcript"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, lines.map((l, i) => /*#__PURE__*/React.createElement(TranscriptLine, {
    key: i,
    time: l.t,
    text: l.o,
    translation: l.tr,
    active: active === i,
    onClick: () => setActive(i)
  })))), /*#__PURE__*/React.createElement(TabBar, {
    active: "home"
  }));
}
function MobileSearch() {
  const trending = ["AI in 2026", "Founder interviews", "Machine learning", "World news", "Documentaries", "Startup stories"];
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      padding: "4px 18px 12px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      height: 44,
      padding: "0 16px",
      background: "var(--muted)",
      borderRadius: "var(--radius-full)"
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: "search",
    size: 18,
    style: {
      color: "var(--muted-foreground)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      color: "var(--muted-foreground)"
    }
  }, "Search videos, courses, topics\u2026"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflowY: "auto",
      padding: "8px 18px 24px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      margin: "8px 0 12px"
    }
  }, "Trending"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      marginBottom: 24
    }
  }, trending.map(t => /*#__PURE__*/React.createElement(CategoryChip, {
    key: t,
    label: t,
    icon: /*#__PURE__*/React.createElement(Icon, {
      name: "trending",
      size: 14
    })
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "0.06em",
      textTransform: "uppercase",
      color: "var(--muted-foreground)",
      marginBottom: 12
    }
  }, "Browse by topic"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12
    }
  }, [["AI", 0], ["Business", 3], ["Documentaries", 2], ["Founder stories", 1]].map(([t, g]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      position: "relative",
      aspectRatio: "16/10",
      borderRadius: "var(--radius-lg)",
      overflow: "hidden",
      background: MG[g],
      display: "flex",
      alignItems: "flex-end",
      padding: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      inset: 0,
      background: "var(--gradient-scrim-bottom)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "relative",
      color: "#fff",
      fontSize: 15,
      fontWeight: 600
    }
  }, t))))), /*#__PURE__*/React.createElement(TabBar, {
    active: "search"
  }));
}
window.MobileHome = MobileHome;
window.MobileWatch = MobileWatch;
window.MobileSearch = MobileSearch;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mobile/MobileScreens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/mobile/PhoneFrame.jsx
try { (() => {
// Vidora mobile — phone bezel + status bar
function PhoneFrame({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 392,
      height: 812,
      background: "#000",
      borderRadius: 52,
      padding: 11,
      boxShadow: "0 40px 80px -30px rgba(0,0,0,0.5), 0 0 0 2px rgba(0,0,0,0.06)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      width: "100%",
      height: "100%",
      background: "var(--background)",
      borderRadius: 42,
      overflow: "hidden",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 50,
      flex: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 28px",
      fontFamily: "var(--font-sans)",
      fontSize: 14,
      fontWeight: 600,
      color: "var(--foreground)",
      position: "relative",
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, "9:41"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: "absolute",
      left: "50%",
      top: 8,
      transform: "translateX(-50%)",
      width: 108,
      height: 30,
      background: "#000",
      borderRadius: 20
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: 6,
      alignItems: "center"
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "17",
    height: "12",
    viewBox: "0 0 17 12",
    fill: "currentColor"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "0",
    y: "7",
    width: "3",
    height: "5",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "4.5",
    y: "4.5",
    width: "3",
    height: "7.5",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "9",
    y: "2",
    width: "3",
    height: "10",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "13.5",
    y: "0",
    width: "3",
    height: "12",
    rx: "1"
  })), /*#__PURE__*/React.createElement("svg", {
    width: "22",
    height: "12",
    viewBox: "0 0 24 12",
    fill: "none"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "1",
    y: "1",
    width: "20",
    height: "10",
    rx: "3",
    stroke: "currentColor",
    strokeOpacity: "0.5"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "2.5",
    y: "2.5",
    width: "15",
    height: "7",
    rx: "1.5",
    fill: "currentColor"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "22",
    y: "4",
    width: "1.5",
    height: "4",
    rx: "0.75",
    fill: "currentColor",
    fillOpacity: "0.5"
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column"
    }
  }, children))), label ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      fontWeight: 500,
      color: "var(--muted-foreground)",
      fontFamily: "var(--font-sans)"
    }
  }, label) : null);
}
window.PhoneFrame = PhoneFrame;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/mobile/PhoneFrame.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.LanguageToggle = __ds_scope.LanguageToggle;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Spinner = __ds_scope.Spinner;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.SearchBar = __ds_scope.SearchBar;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.CategoryChip = __ds_scope.CategoryChip;

__ds_ns.LanguageBadge = __ds_scope.LanguageBadge;

__ds_ns.PlayerControls = __ds_scope.PlayerControls;

__ds_ns.PosterCard = __ds_scope.PosterCard;

__ds_ns.TranscriptLine = __ds_scope.TranscriptLine;

__ds_ns.VideoCard = __ds_scope.VideoCard;

__ds_ns.Breadcrumb = __ds_scope.Breadcrumb;

__ds_ns.NavItem = __ds_scope.NavItem;

__ds_ns.Tabs = __ds_scope.Tabs;

})();


// work/vidora/ui_kits/_shared/icons.jsx
// Shared Vidora icon set — real Lucide 24×24 path data (lucide.dev, ISC),
// rendered inline as React so UI kits have no network dependency.
// Usage: <Icon name="home" size={20} />  (stroke 1.75, currentColor)
const VD_ICON_PATHS = {
  home: "m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z|M9 22V12h6v10",
  compass: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|m16.24 7.76-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12Z",
  library: "m16 6 4 14|M12 6v14|M8 8v12|M4 4v16",
  graduation: "M22 10 12 5 2 10l10 5 10-5Z|M6 12v5c0 1.7 2.7 3 6 3s6-1.3 6-3v-5",
  newspaper: "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2|M18 14h-8|M15 18h-5|M10 6h8v4h-8Z",
  film: "M3 3h18v18H3Z|M7 3v18|M17 3v18|M3 7.5h4|M17 7.5h4|M3 12h18|M3 16.5h4|M17 16.5h4",
  user: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2|M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2|M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z|M22 21v-2a4 4 0 0 0-3-3.87|M16 3.13a4 4 0 0 1 0 7.75",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z|m21 21-4.3-4.3",
  heart: "M19 14c1.5-1.5 3-3.3 3-5.5A3.5 3.5 0 0 0 12 5 3.5 3.5 0 0 0 2 8.5c0 2.2 1.5 4 3 5.5l7 7 7-7Z",
  bookmark: "M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z",
  plus: "M12 5v14|M5 12h14",
  settings: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  bell: "M10.27 21a2 2 0 0 0 3.46 0|M4 17h16l-1.6-2.1a2 2 0 0 1-.4-1.2V10a6 6 0 0 0-12 0v3.7c0 .43-.14.85-.4 1.2Z",
  chevronDown: "m6 9 6 6 6-6",
  chevronRight: "m9 18 6-6-6-6",
  chevronLeft: "m15 18-6-6 6-6",
  globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M2 12h20|M12 2a15.3 15.3 0 0 1 0 20|M12 2a15.3 15.3 0 0 0 0 20",
  languages: "m5 8 6 6|M4 14l6-6 2-3|M2 5h12|M7 2h1|m22 22-5-10-5 10|M14 18h6",
  sparkles: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z|M19 3v4|M21 5h-4",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M17 8l-5-5-5 5|M12 3v12",
  link: "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5|M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5",
  check: "M20 6 9 17l-5-5",
  x: "M18 6 6 18|M6 6l12 12",
  menu: "M4 6h16|M4 12h16|M4 18h16",
  more: "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z|M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z|M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z|M12 6v6l4 2",
  arrowRight: "M5 12h14|m12 5 7 7-7 7",
  star: "M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1Z",
  volume: "M11 5 6 9H2v6h4l5 4V5Z|M15.5 8.5a5 5 0 0 1 0 7|M18.5 5.5a9 9 0 0 1 0 13",
  maximize: "M8 3H5a2 2 0 0 0-2 2v3|M16 3h3a2 2 0 0 1 2 2v3|M8 21H5a2 2 0 0 1-2-2v-3|M16 21h3a2 2 0 0 0 2-2v-3",
  subtitles: "M2 7.5A2.5 2.5 0 0 1 4.5 5h15A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 16.5Z|M7 13h2|M7 16h5|M13 13h4|M15 16h2",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z|M12 1v2|M12 21v2|M4.2 4.2l1.4 1.4|M18.4 18.4l1.4 1.4|M1 12h2|M21 12h2|M4.2 19.8l1.4-1.4|M18.4 5.6l1.4-1.4",
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4|m16 17 5-5-5-5|M21 12H9",
  card: "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z|M2 10h20",
  share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8|M16 6l-4-4-4 4|M12 2v13",
  trending: "m22 7-8.5 8.5-5-5L2 17|M16 7h6v6",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z|M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4|M7 10l5 5 5-5|M12 15V3",
  list: "M8 6h13|M8 12h13|M8 18h13|M3 6h.01|M3 12h.01|M3 18h.01",
  cpu: "M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z|M9 9h6v6H9Z|M15 2v2|M15 20v2|M2 15h2|M2 9h2|M20 15h2|M20 9h2|M9 2v2|M9 20v2",
  lock: "M7 11V7a5 5 0 0 1 10 0v4|M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z",
  fileText: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z|M14 2v4a2 2 0 0 0 2 2h4|M16 13H8|M16 17H8|M10 9H8",
};

const VD_FILLED = { play: "M8 5.5v13l11-6.5-11-6.5Z", pause: "" };

function Icon({ name, size = 20, stroke = 1.75, fill = false, style = {}, ...rest }) {
  if (name === "play") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: "block", ...style }} {...rest}>
        <path d="M8 5.5v13l11-6.5-11-6.5Z" />
      </svg>
    );
  }
  if (name === "pause") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: "block", ...style }} {...rest}>
        <rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    );
  }
  const d = VD_ICON_PATHS[name] || "";
  const segs = d.split("|");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? "currentColor" : "none"} stroke={fill ? "none" : "currentColor"} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={{ display: "block", ...style }} {...rest}>
      {segs.map((p, i) => <path key={i} d={p} />)}
    </svg>
  );
}

window.Icon = Icon;


// work/vidora/ui_kits/marketing/i18n.js
// Vidora landing — i18n runtime (Persian-default, RTL) + fa/en dictionary.
// Persian is the source/default language; English is the LTR secondary.
// Exposes: window.VIDORA_DICT, window.applyVidoraLang(lang), window.useLang().
// Direction, <html lang/dir>, the Persian webfont class, and localStorage are
// all driven from applyVidoraLang so any surface stays in sync.

window.VIDORA_DICT = {
  fa: {
    nav: { product: "محصولات", library: "کتابخانه", pricing: "قیمت‌گذاری" },
    login: "ورود",
    startFree: "شروع رایگان",
    startMembership: "شروع عضویت",
    exploreLibrary: "کاوش در کتابخانه",
    heroTitle: ["ویدیوهای روز دنیا را", "به زبان خودتان درک کنید"],
    heroSubNew: "ویدیوهای مرتبط با علایق و نیازتان را پیدا کنید، به فارسی تماشا کنید و با کمک خلاصه‌ها و نکات کلیدی هوشمند، سریع‌تر به محتوای اصلی برسید. همچنین می‌توانید ویدیوهای دلخواه خودتان را به Vidora اضافه کنید.",
    ctaPrimary: "شروع استفاده از ویدورا",
    heroSupport: "جست‌وجوی هوشمند · زیرنویس فارسی · خلاصه و نکات کلیدی · کتابخانه شخصی",
    ctaSecondary: "ترجمه ویدیوی خودم",
    heroChips: ["زیرنویس دقیق فارسی", "خلاصه و نکات کلیدی", "ابزارهای یادگیری هوشمند", "ترجمه ویدیوی خودت"],
    categories: [
      { title: "هوش مصنوعی و ابزارهای جدید", desc: "یادگیری AI، ابزارهای کاربردی، عملی در دنیای واقعی", icon: "sparkles" },
      { title: "ساخت محصول و برنامه‌نویسی", desc: "از ایده تا محصول، کدنویسی، طراحی محصول و رشد استارتاپ", icon: "cpu" },
      { title: "یادگیری زبان با ویدیو", desc: "تقویت مکالمه، شنیداری و دایره لغات با ویدیوهای واقعی", icon: "globe" },
      { title: "بیزنس و رشد فردی", desc: "مهارت‌های شغلی، مدیریت زمان، بازاریابی و تصمیم‌گیری بهتر", icon: "trending" },
    ],
    categoriesCta: "مشاهده همه دسته‌ها",
    joinTitle: "به جمع یادگیرندگان بپیوندید",
    rating: "۴.۹ از ۵",
    stats: [
      { num: "+۱۰K", label: "کاربر فعال" },
      { num: "+۴۰K", label: "ویدیو ترجمه شده" },
      { num: "+۱M", label: "دقیقه یادگیری" },
      { num: "+۴۸", label: "زبان پشتیبانی شده" },
    ],
    heroLines: ["هر ویدیو.", "هر زبان."],
    heroSub: "جهان را از طریق دانش بفهمید. زیرنویس، دوبله و رونوشت با هوش مصنوعی.",
    plusLangs: "+ ۴۸ زبان",
    learnMore: "بیشتر بیاموزید",
    knowledgeLines: ["دانش", "نو"],
    knowledgeBody: "از هوش مصنوعی تا هنر، از علم تا جامعه. درس‌های منتخب، ترجمه‌شده برای شما.",
    pillars: [
      { title: "فناوری و هوش مصنوعی", body: "ایده‌های پیشرو از برترین متخصصان جهان." },
      { title: "داستان بنیان‌گذاران", body: "گفت‌وگوهای واقعی با سازندگان برجسته." },
      { title: "نگاه جهانی", body: "اخبار، اقتصاد و مسائل جهانی در بستر واقعی." },
    ],
    features: [
      { title: "+۴۸ زبان", body: "به زبان خودتان بیاموزید." },
      { title: "زیرنویس هوش مصنوعی", body: "ترجمهٔ دقیق و بی‌درنگ زیرنویس." },
      { title: "رونوشت دوزبانه", body: "حین یادگیری بخوانید، جست‌وجو و مرور کنید." },
      { title: "دسترسی عضویت", body: "دسترسی نامحدود به محتوای ویژه." },
    ],
    curatedTitle: "منتخب برای شما",
    viewAll: "مشاهدهٔ همه",
    cards: [
      { eyebrow: "فناوری و هوش مصنوعی", title: "عصر تازهٔ رایانش", meta: "EN · ۱۲ زبان" },
      { eyebrow: "کسب‌وکار", title: "رهبری در دل تغییر", meta: "EN · ۱۰ زبان" },
      { eyebrow: "نگاه جهانی", title: "چشم‌انداز جهانی ۲۰۲۴", meta: "EN · ۱۵ زبان" },
    ],
    footer: {
      tagline: "تماشا کنید. بفهمید. رشد کنید. هر ویدیو، به زبان شما.",
      rights: "© {year} ویدورا. تمام حقوق محفوظ است.",
      sections: [
        { label: "محصول", links: ["ویژگی‌ها", "قیمت‌گذاری", "برای تیم‌ها", "یکپارچه‌سازی‌ها"] },
        { label: "شرکت", links: ["دربارهٔ ما", "فرصت‌های شغلی", "حریم خصوصی", "شرایط استفاده"] },
        { label: "منابع", links: ["وبلاگ", "مرکز راهنما", "زبان‌ها", "تغییرات"] },
        { label: "ما را دنبال کنید", links: ["X / Twitter", "YouTube", "LinkedIn", "Instagram"] },
      ],
    },
  },
  en: {
    nav: { product: "Products", library: "Library", pricing: "Pricing" },
    login: "Log in",
    startFree: "Start free",
    startMembership: "Start membership",
    exploreLibrary: "Explore library",
    heroTitle: ["Understand today's videos", "in your own language"],
    heroSubNew: "Find videos that match your interests, watch them in Persian, and reach the key ideas faster with smart summaries and takeaways. You can also add your own videos to Vidora.",
    ctaPrimary: "Start using Vidora",
    heroSupport: "Smart discovery · Persian subtitles · Summaries and takeaways · Personal library",
    ctaSecondary: "Translate my video",
    heroChips: ["Accurate Persian subtitles", "Summaries & key points", "Smart learning tools"],
    categories: [
      { title: "AI & new tools", desc: "Learn AI and practical tools, applied to the real world.", icon: "sparkles" },
      { title: "Product & engineering", desc: "From idea to product — coding, product design, and startup growth.", icon: "cpu" },
      { title: "Language learning by video", desc: "Build conversation, listening, and vocabulary with real videos.", icon: "globe" },
      { title: "Business & personal growth", desc: "Career skills, time management, marketing, and better decisions.", icon: "trending" },
    ],
    categoriesCta: "View all categories",
    joinTitle: "Join the learners",
    rating: "4.9 of 5",
    stats: [
      { num: "+10K", label: "Active users" },
      { num: "+40K", label: "Videos translated" },
      { num: "+1M", label: "Minutes learned" },
      { num: "+48", label: "Languages supported" },
    ],
    heroLines: ["Any", "video.", "Any", "language."],
    heroSub: "Understand the world through knowledge. AI subtitles, dubbing, and transcripts.",
    plusLangs: "+  48 languages",
    learnMore: "Learn more",
    knowledgeLines: ["New", "Knowledge"],
    knowledgeBody: "From AI to art, science to society. Curated lessons. Translated for you.",
    pillars: [
      { title: "Tech & AI", body: "Cutting-edge ideas from the world's top experts." },
      { title: "Founder Stories", body: "Real conversations with remarkable builders." },
      { title: "World Insights", body: "News, economics, and global affairs in context." },
    ],
    features: [
      { title: "48+ Languages", body: "Learn in your own language." },
      { title: "AI Subtitles", body: "Accurate, real-time subtitle translation." },
      { title: "Bilingual Transcripts", body: "Read, search, and review while you learn." },
      { title: "Membership Access", body: "Unlimited access to premium content." },
    ],
    curatedTitle: "Curated for you",
    viewAll: "View all library",
    cards: [
      { eyebrow: "Tech & AI", title: "The Next Era of Computing", meta: "EN · 12 languages" },
      { eyebrow: "Business", title: "Leading Through Change", meta: "EN · 10 languages" },
      { eyebrow: "World Insights", title: "Global Outlook 2024", meta: "EN · 15 languages" },
    ],
    footer: {
      tagline: "Watch. Understand. Grow. Any video, in your language.",
      rights: "© {year} Vidora. All rights reserved.",
      sections: [
        { label: "Product", links: ["Features", "Pricing", "For teams", "Integrations"] },
        { label: "Company", links: ["About", "Careers", "Privacy Policy", "Terms of Service"] },
        { label: "Resources", links: ["Blog", "Help center", "Languages", "Changelog"] },
        { label: "Follow", links: ["X / Twitter", "YouTube", "LinkedIn", "Instagram"] },
      ],
    },
  },
};

window.__vidoraLang = (function () {
  try { return window.localStorage.getItem("vidora-lang") || "fa"; } catch (e) { return "fa"; }
})();

window.applyVidoraLang = function (lang) {
  if (lang !== "fa" && lang !== "en") lang = "fa";
  window.__vidoraLang = lang;
  var h = document.documentElement;
  // Layout stays LTR/stable — we only switch the content language + webfont.
  // (RTL is applied at the text level per element, not on the page wrapper.)
  h.setAttribute("dir", "ltr");
  h.setAttribute("lang", lang);
  h.classList.toggle("lang-fa", lang === "fa");
  try { window.localStorage.setItem("vidora-lang", lang); } catch (e) { /* ignore */ }
  window.dispatchEvent(new CustomEvent("vidoralangchange", { detail: lang }));
};

// React hook — re-renders subscribers on language change.
window.useLang = function () {
  var st = React.useState(window.__vidoraLang);
  React.useEffect(function () {
    var on = function (e) { st[1]((e && e.detail) || window.__vidoraLang); };
    window.addEventListener("vidoralangchange", on);
    return function () { window.removeEventListener("vidoralangchange", on); };
  }, []);
  var lang = st[0];
  var d = window.VIDORA_DICT[lang] || window.VIDORA_DICT.en;
  var t = function (key) {
    return d[key] !== undefined ? d[key] : (window.VIDORA_DICT.en[key] !== undefined ? window.VIDORA_DICT.en[key] : key);
  };
  return { lang: lang, dir: lang === "fa" ? "rtl" : "ltr", t: t, d: d, setLang: window.applyVidoraLang };
};


// work/vidora/ui_kits/marketing/EditorialHeader.jsx
// Vidora editorial landing — header (floating scroll-aware pill + animated
// hamburger + mobile overlay). Persian-first i18n via useLang(); RTL-safe.
function MenuToggleIcon({ open, size = 20, duration = 300 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: `transform ${duration}ms ease-in-out`, transform: open ? "rotate(-45deg)" : "none", display: "block" }}
    >
      <path
        style={{
          transition: `stroke-dasharray ${duration}ms ease-in-out, stroke-dashoffset ${duration}ms ease-in-out`,
          strokeDasharray: open ? "20 300" : "12 63",
          strokeDashoffset: open ? "-32.42px" : "0px",
        }}
        d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
      />
      <path d="M7 16 27 16" />
    </svg>
  );
}

function EditorialHeader({ mode = "landing", navItems = null, search = null, tone = "light", auth = null, layoutDirection = null, mobileFloating = false } = {}) {
  const { Button, IconButton } = window.VidoraDesignSystem_0f84f2;
  const { d, lang } = window.useLang();
  const [open, setOpen] = React.useState(false);
  const [scrolled, setScrolled] = React.useState(false);
  const [vw, setVw] = React.useState(typeof window !== "undefined" ? window.innerWidth : 1440);
  const [account, setAccount] = React.useState({ loading: true, session: getCachedSession(), subscription: null });
  const [profileOpen, setProfileOpen] = React.useState(false);
  const profileRef = React.useRef(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", onScroll);
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  React.useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  React.useEffect(() => {
    let alive = true;
    const load = async (session) => {
      if (!session) {
        if (alive) setAccount({ loading: false, session: null, subscription: null });
        return;
      }
      try {
        const subscription = await fetchActiveSubscription(session);
        if (alive) setAccount({ loading: false, session, subscription });
      } catch {
        if (alive) setAccount({ loading: false, session, subscription: null });
      }
    };
    restoreAuthSession().then(load).catch(() => load(null));
    const unsubscribe = subscribeAuthState(load);
    return () => { alive = false; unsubscribe(); };
  }, []);
  React.useEffect(() => {
    if (!profileOpen) return undefined;
    const onPointer = (event) => {
      if (!profileRef.current?.contains(event.target)) setProfileOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [profileOpen]);

  const isMobile = vw < 768;
  const floating = scrolled && !open && (!isMobile || mobileFloating);
  const dark = tone === "dark";
  const searchOpen = Boolean(search?.open);
  const defaultLinks = [
    { label: lang === "fa" ? "کتابخانه" : "Library", onClick: () => { trackEvent("library_opened", { source: mode }); window.location.hash = "#/library"; } },
    { label: lang === "fa" ? "خرید اشتراک" : "Buy subscription", onClick: () => { window.location.hash = "#/subscriptions"; } },
  ];
  const links = navItems || defaultLinks;
  const authAction = auth || { label: d.login, onClick: () => { window.location.hash = "#/login"; } };
  const headerBg = dark
    ? open || floating || scrolled ? "rgba(8,8,10,0.86)" : "rgba(8,8,10,0.78)"
    : open ? "rgba(255,255,255,0.96)" : floating ? "rgba(255,255,255,0.88)" : "#fff";
  const headerInk = dark ? "#fff" : "var(--ed-ink)";
  const headerMuted = dark ? "#d4d4d8" : "var(--ed-text-muted)";
  const borderColor = dark ? "rgba(255,255,255,.12)" : "var(--border)";

  const wordmark = (
    <a
      className="vidora-wordmark-link"
      href="#/"
      aria-label={lang === "fa" ? "بازگشت به صفحه اصلی Vidora" : "Back to the Vidora homepage"}
      onClick={() => setOpen(false)}
      style={{ fontFamily: "Geist, var(--font-sans)", fontWeight: 800, fontSize: 17, letterSpacing: "0.16em", color: headerInk, userSelect: "none" }}
    >
      VIDORA
    </a>
  );

  const profileMenu = account.session ? (
    <div ref={profileRef} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={profileOpen}
        onClick={() => { setProfileOpen((value) => !value); trackEvent("profile_menu_opened", { source: mode }); }}
        style={{ height: 38, maxWidth: 190, display: "inline-flex", alignItems: "center", gap: 8, padding: "0 10px", borderRadius: 999, border: `1px solid ${borderColor}`, background: dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.72)", color: headerInk, cursor: "pointer", fontFamily: "var(--font-sans)", fontWeight: 700 }}
      >
        <span style={{ width: 26, height: 26, borderRadius: 999, display: "grid", placeItems: "center", background: dark ? "#fff" : "#18181b", color: dark ? "#18181b" : "#fff", flex: "none" }}><User size={14} /></span>
        {vw >= 920 ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{getDisplayName(account.session)}</span> : null}
        <ChevronDown size={14} style={{ transform: profileOpen ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }} />
      </button>
      {profileOpen ? (
        <div role="menu" dir={lang === "fa" ? "rtl" : "ltr"} style={{ position: "absolute", top: 46, insetInlineEnd: 0, width: "min(300px,calc(100vw - 32px))", padding: 10, borderRadius: 16, border: `1px solid ${borderColor}`, background: dark ? "rgba(14,14,16,.98)" : "rgba(255,255,255,.98)", color: headerInk, boxShadow: "0 24px 60px rgba(0,0,0,.2)", zIndex: 80, display: "grid", gap: 3 }}>
          <div style={{ padding: "10px 11px 12px", borderBottom: `1px solid ${borderColor}`, marginBottom: 4 }}>
            <strong style={{ display: "block", fontSize: 13 }}>{getDisplayName(account.session)}</strong>
            <span dir="ltr" style={{ display: "block", marginTop: 4, fontSize: 11.5, color: headerMuted, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis" }}>{account.session.user.email}</span>
          </div>
          {!isSubscriptionActive(account.subscription) ? (
            <div style={{ margin: "4px 3px 7px", padding: 12, borderRadius: 12, border: `1px solid ${borderColor}`, background: dark ? "rgba(255,255,255,.05)" : "#f4f4f5" }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: 750 }}>{lang === "fa" ? "اشتراک فعالی ندارید" : "No active subscription"}</span>
              <button onClick={() => { setProfileOpen(false); window.location.hash = "#/subscriptions"; }} style={{ marginTop: 8, border: 0, background: "transparent", padding: 0, color: headerInk, font: "inherit", fontSize: 12, fontWeight: 800, textDecoration: "underline", cursor: "pointer" }}>{lang === "fa" ? "خرید اشتراک" : "Buy subscription"}</button>
            </div>
          ) : (
            <div style={{ padding: "8px 11px", color: headerMuted, fontSize: 12 }}>{lang === "fa" ? `اشتراک فعال: ${account.subscription?.plans?.name_fa || "ویدورا"}` : "Subscription active"}</div>
          )}
          {[
            [lang === "fa" ? "داشبورد" : "Dashboard", "#/dashboard"],
            [lang === "fa" ? "افزودن ویدیوی جدید" : "Add new video", "#/dashboard/new-translation"],
            [lang === "fa" ? "ویدیوهای من" : "My videos", "#/dashboard/videos"],
            [lang === "fa" ? "ذخیره‌شده‌ها" : "Saved", "#/dashboard/saved"],
            [lang === "fa" ? "وضعیت اشتراک" : "Subscription status", "#/dashboard/subscription"],
            [lang === "fa" ? "خرید یا تمدید اشتراک" : "Buy or renew subscription", "#/subscriptions"],
            [lang === "fa" ? "تنظیمات حساب" : "Account settings", "#/dashboard/settings"],
            [lang === "fa" ? "پشتیبانی" : "Support", "#/dashboard/support"],
          ].map(([label, href]) => (
            <button key={href} role="menuitem" onClick={() => { setProfileOpen(false); window.location.hash = href; }} style={{ height: 38, border: 0, borderRadius: 10, padding: "0 11px", background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5, fontWeight: 650, textAlign: lang === "fa" ? "right" : "left", cursor: "pointer" }}>{label}</button>
          ))}
          <button role="menuitem" onClick={async () => { setProfileOpen(false); await signOutUser(); window.location.hash = "#/"; }} style={{ height: 38, marginTop: 3, border: 0, borderTop: `1px solid ${borderColor}`, background: "transparent", color: "inherit", font: "inherit", fontSize: 12.5, fontWeight: 750, textAlign: lang === "fa" ? "right" : "left", cursor: "pointer" }}>{lang === "fa" ? "خروج از حساب" : "Log out"}</button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <header
      className="landing-header"
      data-screen-label="Header"
      data-floating={floating ? "true" : "false"}
      data-mobile-redesign={mobileFloating ? "true" : "false"}
      style={{
        position: "sticky",
        top: floating ? 16 : 0,
        zIndex: 50,
        margin: "0 auto",
        width: "100%",
        boxSizing: "border-box",
        maxWidth: floating ? 960 : 1280,
        borderRadius: floating ? "var(--radius-md)" : 0,
        border: floating ? `1px solid ${borderColor}` : "1px solid transparent",
        borderBottomColor: (scrolled || open || dark) && !floating ? borderColor : (floating ? borderColor : "transparent"),
        background: headerBg,
        backdropFilter: floating || open || dark ? "blur(14px)" : "none",
        WebkitBackdropFilter: floating || open || dark ? "blur(14px)" : "none",
        boxShadow: floating ? "var(--shadow-sm)" : "none",
        transition: "max-width 260ms var(--ease-standard), top 260ms var(--ease-standard), background 200ms var(--ease-standard), box-shadow 200ms var(--ease-standard), border-radius 260ms var(--ease-standard), border-color 200ms var(--ease-standard)",
      }}
    >
      <style>{`
        @media(max-width:767px){
          .landing-header[data-mobile-redesign="true"]{top:0!important;height:78px;max-width:none!important;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}
          .landing-header[data-mobile-redesign="true"] .landing-header-nav{height:78px!important;max-width:100%;margin:0 auto;padding:0 24px!important;border:1px solid transparent;border-radius:0;background:#fff;transition:width 260ms var(--ease-standard),max-width 260ms var(--ease-standard),height 260ms var(--ease-standard),margin 260ms var(--ease-standard),padding 260ms var(--ease-standard),background 200ms var(--ease-standard),box-shadow 200ms var(--ease-standard),border-radius 260ms var(--ease-standard),border-color 200ms var(--ease-standard)}
          .landing-header[data-mobile-redesign="true"] .vidora-wordmark-link{font-size:20px!important;letter-spacing:.19em!important}
          .landing-header[data-mobile-redesign="true"] .landing-header-menu{margin-inline-end:-8px}
          .landing-header[data-mobile-redesign="true"] .landing-header-menu button{width:48px!important;height:48px!important;border-color:transparent!important;background:transparent!important;box-shadow:none!important}
          .landing-header[data-mobile-redesign="true"] .landing-header-menu svg{width:26px!important;height:26px!important}
          .landing-header[data-mobile-redesign="true"] .landing-mobile-menu{top:78px!important;border-top:0!important;padding:20px 24px 24px!important}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-nav{width:calc(100% - 24px);height:56px!important;margin:max(10px,env(safe-area-inset-top)) auto 0;padding:0 12px!important;border-color:var(--border);border-radius:16px;background:rgba(255,255,255,.92);box-shadow:var(--shadow-sm);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .vidora-wordmark-link{font-size:17px!important;letter-spacing:.17em!important}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-menu{margin-inline-end:-4px}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-menu button{width:44px!important;height:44px!important}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-menu svg{width:23px!important;height:23px!important}
          @media(prefers-reduced-motion:reduce){
            .landing-header[data-mobile-redesign="true"],.landing-header[data-mobile-redesign="true"] .landing-header-nav,.landing-header[data-mobile-redesign="true"] .vidora-wordmark-link,.landing-header[data-mobile-redesign="true"] .landing-header-menu svg{transition:none!important}
          }
        }
        @media(max-width:359px){
          .landing-header[data-mobile-redesign="true"]{height:70px}
          .landing-header[data-mobile-redesign="true"] .landing-header-nav{height:70px!important;padding-inline:18px!important}
          .landing-header[data-mobile-redesign="true"] .vidora-wordmark-link{font-size:18px!important}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-nav{width:calc(100% - 20px);height:52px!important;margin-top:max(8px,env(safe-area-inset-top));padding-inline:10px!important;border-radius:15px}
          .landing-header[data-mobile-redesign="true"][data-floating="true"] .landing-header-menu button{width:42px!important;height:42px!important}
          .landing-header[data-mobile-redesign="true"] .landing-mobile-menu{top:70px!important}
        }
      `}</style>
      <nav
        className="landing-header-nav"
        dir={layoutDirection || undefined}
        style={{
          display: "flex",
          height: floating ? 48 : 56,
          width: "100%",
          boxSizing: "border-box",
          alignItems: "center",
          justifyContent: "space-between",
          padding: floating ? "0 12px" : isMobile ? "0 20px" : "0 48px",
          transition: "height 260ms var(--ease-standard), padding 260ms var(--ease-standard)",
        }}
      >
        {wordmark}

        {!isMobile && searchOpen ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, marginInlineStart: 28 }}>
            <label style={{ height: 42, borderRadius: "var(--radius-full)", border: `1px solid ${dark ? "rgba(255,255,255,.18)" : "var(--border)"}`, background: dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.82)", display: "flex", alignItems: "center", gap: 10, paddingInline: 15, minWidth: 0, flex: 1, color: headerMuted }}>
              <Search size={17} />
              <input
                ref={search.inputRef}
                value={search.query}
                onChange={search.onChange}
                onKeyDown={search.onKeyDown}
                placeholder={search.placeholder}
                style={{ height: "100%", minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: headerInk, font: "inherit", fontWeight: 650, textAlign: search.rtl ? "right" : "left" }}
                dir={search.rtl ? "rtl" : "ltr"}
              />
            </label>
            <Button variant={dark ? "secondary" : "ghost"} onClick={search.onClose} style={dark ? { color: headerInk, borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)" } : undefined}>
              {search.closeLabel}
            </Button>
          </div>
        ) : !isMobile ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {links.map((item, i) => (
              <Button
                key={i}
                variant="ghost"
                onClick={(e) => {
                  e.preventDefault();
                  item.onClick?.();
                }}
                style={{
                  ...(dark ? { color: headerMuted } : {}),
                  ...(item.active ? { color: headerInk, borderRadius: 0, boxShadow: `inset 0 -1px 0 ${headerInk}` } : {}),
                  ...(item.style || {}),
                }}
              >
                {item.label}
              </Button>
            ))}
            <div style={{ width: 8 }} />
            {mode === "library" && search ? (
              <IconButton
                variant="secondary"
                label={search.searchLabel}
                onClick={search.onOpen}
                icon={<Search size={17} />}
                style={dark ? { color: headerInk, borderColor: "rgba(255,255,255,.18)", background: "transparent" } : undefined}
              />
            ) : null}
            <div style={{ width: 1, height: 24, background: dark ? "rgba(255,255,255,.14)" : "var(--border)", margin: "0 4px" }} />
            {auth ? <Button variant="secondary" onClick={authAction.onClick}>{authAction.label}</Button> : account.loading ? <span aria-label={lang === "fa" ? "در حال بررسی حساب" : "Checking account"} style={{ width: 92, height: 36, borderRadius: 999, background: dark ? "rgba(255,255,255,.08)" : "#f4f4f5" }} /> : account.session ? profileMenu : (
              <Button variant="primary" onClick={() => { trackEvent("auth_opened", { source: mode, intent: "general-entry" }); window.location.hash = buildAuthHash({ intent: "general-entry", returnTo: ROUTES.dashboard }); }}>{lang === "fa" ? "ورود / عضویت" : "Login / Sign up"}</Button>
            )}
          </div>
        ) : (
          <div className="landing-header-menu" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {mode === "library" && search ? (
              <IconButton
                variant="secondary"
                label={search.searchLabel}
                onClick={search.onOpen}
                icon={<Search size={17} />}
                style={dark ? { color: headerInk, borderColor: "rgba(255,255,255,.18)", background: "transparent" } : undefined}
              />
            ) : null}
            <IconButton
              variant="secondary"
              label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
              icon={mobileFloating ? (open ? <X size={24} strokeWidth={1.8} /> : <Menu size={26} strokeWidth={1.8} />) : <MenuToggleIcon open={open} size={20} duration={300} />}
              style={dark ? { color: headerInk, borderColor: "rgba(255,255,255,.18)", background: "transparent" } : undefined}
            />
          </div>
        )}
      </nav>

      {isMobile && searchOpen ? (
        <div style={{ padding: "0 16px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ height: 42, borderRadius: "var(--radius-full)", border: `1px solid ${dark ? "rgba(255,255,255,.18)" : "var(--border)"}`, background: dark ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.82)", display: "flex", alignItems: "center", gap: 10, paddingInline: 15, minWidth: 0, flex: 1, color: headerMuted }}>
            <Search size={17} />
            <input
              ref={search.inputRef}
              value={search.query}
              onChange={search.onChange}
              onKeyDown={search.onKeyDown}
              placeholder={search.placeholder}
              style={{ height: "100%", minWidth: 0, flex: 1, border: 0, outline: 0, background: "transparent", color: headerInk, font: "inherit", fontWeight: 650, textAlign: search.rtl ? "right" : "left" }}
              dir={search.rtl ? "rtl" : "ltr"}
            />
          </label>
          <Button variant={dark ? "secondary" : "ghost"} onClick={search.onClose} style={dark ? { color: headerInk, borderColor: "rgba(255,255,255,.18)", background: "rgba(255,255,255,.08)" } : undefined}>
            {search.closeLabel}
          </Button>
        </div>
      ) : null}

      {searchOpen ? search.panel : null}

      {isMobile ? (
        <div
          className="landing-mobile-menu"
          style={{
            position: "fixed",
            insetInlineStart: 0,
            insetInlineEnd: 0,
            top: 56,
            bottom: 0,
            zIndex: 50,
            display: open ? "flex" : "none",
            flexDirection: "column",
            justifyContent: "space-between",
            gap: 8,
            padding: 16,
            background: dark ? "rgba(8,8,10,0.96)" : "rgba(255,255,255,0.96)",
            backdropFilter: "blur(14px)",
            WebkitBackdropFilter: "blur(14px)",
            borderTop: `1px solid ${borderColor}`,
          }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            {links.map((item, i) => (
              <Button key={i} variant="ghost" fullWidth style={{ justifyContent: "flex-start", ...(dark ? { color: headerInk } : {}) }} onClick={() => { setOpen(false); item.onClick?.(); }}>
                {item.label}
              </Button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {auth ? <Button variant="secondary" fullWidth onClick={() => { setOpen(false); authAction.onClick?.(); }}>{authAction.label}</Button> : account.session ? profileMenu : <Button variant="primary" fullWidth onClick={() => { setOpen(false); trackEvent("auth_opened", { source: mode, intent: "general-entry" }); window.location.hash = buildAuthHash({ intent: "general-entry", returnTo: ROUTES.dashboard }); }}>{lang === "fa" ? "ورود / عضویت" : "Login / Sign up"}</Button>}
          </div>
        </div>
      ) : null}
    </header>
  );
}

window.EditorialHeader = EditorialHeader;


// work/vidora/ui_kits/marketing/EditorialHero.jsx
// Vidora editorial landing — HERO (rebuilt to match the reference):
// LEFT text column (headline / paragraph / CTAs / chips), CENTER empty mockup
// placeholder, RIGHT category cards + CTA, and a full-width stats bar below.
// Layout stays LTR (not mirrored); Persian text blocks are right-aligned via
// per-block dir. Premium B&W, DS Button, tokens only.

function MockupPlaceholder() {
  const desktopMockupSrc = `${import.meta.env.BASE_URL}images/vidora-macbook-transparent-crisp.png`;
  const mobileMockupSrc = `${import.meta.env.BASE_URL}images/vidora-iphone-mobile-mockup-transparent-v2.png`;

  return (
    <div
      className="vh-mockup"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        aspectRatio: "1375 / 827",
        padding: 0,
      }}
    >
      <img
        className="vh-desktop-mockup"
        src={desktopMockupSrc}
        alt="Vidora video learning interface with Persian subtitles, summary and key takeaways"
        width={1375}
        height={827}
        loading="eager"
        decoding="sync"
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          objectFit: "contain",
          // transparent PNG — drop-shadow follows the laptop's silhouette
          // (box-shadow would draw a rectangle around the whole image box)
          filter: "drop-shadow(0 26px 38px rgba(0,0,0,0.30))",
        }}
      />
      <img
        className="vh-mobile-mockup"
        src={mobileMockupSrc}
        alt="رابط موبایل ویدورا با زیرنویس فارسی، خلاصه و نکات کلیدی"
        width={885}
        height={1777}
        loading="eager"
        decoding="sync"
      />
    </div>
  );
}

// Grayscale lucide-react icons for the hero category cards, keyed by the
// icon names already used in the i18n dictionary.
const CATEGORY_ICONS = {
  sparkles: BrainCircuit, // هوش مصنوعی و ابزارهای جدید
  cpu: Code2, // ساخت محصول و برنامه‌نویسی
  globe: Languages, // یادگیری زبان با ویدیو
  trending: TrendingUp, // بیزنس و رشد فردی
};

function CategoryCard({ item, rtl }) {
  const LucideIcon = CATEGORY_ICONS[item.icon] || BrainCircuit;
  return (
    <Card dir={rtl ? "rtl" : "ltr"} className="w-full">
      <div className="flex items-center gap-4">
        <Card.Header className="min-w-0 flex-1 gap-1">
          <Card.Title>{item.title}</Card.Title>
          <Card.Description>{item.desc}</Card.Description>
        </Card.Header>
        <span className="flex size-12 flex-none items-center justify-center rounded-[14px] bg-zinc-100 text-zinc-900">
          <LucideIcon size={22} strokeWidth={1.8} aria-hidden="true" />
        </span>
      </div>
    </Card>
  );
}

function StatsBar({ d, rtl }) {
  return (
    <div
      className="vh-card-row"
      dir={rtl ? "rtl" : "ltr"}
      style={{
        marginTop: 40,
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 14,
        padding: 0,
        borderRadius: "var(--radius-2xl)",
      }}
    >
      {d.categories.map((cat, i) => (
        <div key={i} className="vh-cardslot"><CategoryCard item={cat} rtl={rtl} /></div>
      ))}
    </div>
  );
}

function EditorialHero() {
  const { Button } = window.VidoraDesignSystem_0f84f2;
  const { d, lang } = window.useLang();
  const rtl = lang === "fa";
  const align = rtl ? "right" : "left";
  const valueItems = rtl
    ? ["زیرنویس فارسی", "خلاصه و نکات کلیدی", "پرسش از محتوای ویدیو"]
    : ["Persian subtitles", "Summary and key points", "Ask about the video"];

  const css = `
    .vh-wrap{max-width:1280px;margin:0 auto;padding:32px 48px 30px;}
    .vh-grid{display:grid;grid-template-columns:minmax(330px,.78fr) minmax(520px,1.35fr);gap:38px;align-items:center;min-height:420px;}
    .vh-left{min-width:0;}
    .vh-right{display:flex;align-items:center;justify-content:flex-end;min-width:0;}
    .vh-right .vh-mockup{width:min(100%,700px);max-width:none;transform:translateX(12px);}
    .vh-cta{display:flex;width:min(100%,430px);margin-top:23px;margin-inline-end:auto;align-items:center;justify-content:flex-start;}
    .vh-values{display:flex;width:min(100%,520px);margin-top:22px;align-items:center;justify-content:flex-start;gap:10px 0;flex-wrap:wrap;}
    .vh-value{display:inline-flex;min-width:0;align-items:center;gap:6px;color:#71717a;white-space:nowrap;}
    .vh-value+.vh-value{margin-inline-start:14px;padding-inline-start:14px;border-inline-start:1px solid #d4d4d8;}
    .vh-value svg{flex:none;color:#3f3f46;}
    .vh-value span{font-size:11px;font-weight:550;line-height:1.6;}
    .vh-mobile-mockup{display:none;}
    @media (max-width:1020px){
      .vh-wrap{padding-inline:32px;}
      .vh-grid{grid-template-columns:minmax(300px,.85fr) minmax(400px,1.15fr);gap:24px;min-height:430px;}
      .vh-right .vh-mockup{transform:none;}
    }
    @media (max-width:820px){
      .vh-wrap{padding:34px 20px 42px;}
      .vh-grid{grid-template-columns:1fr;gap:34px;min-height:0;}
      .vh-right{justify-content:center;}
      .vh-left{order:1;}
      .vh-right{order:2;}
      .vh-cta,.vh-values{width:100%;}
      .vh-values{display:flex;gap:10px 0;margin-top:22px;}
      .vh-value{white-space:normal;}
    }
    @media (max-width:540px){
      .vh-values{display:grid;grid-template-columns:1fr;gap:9px;}
      .vh-value+.vh-value{margin-inline-start:0;padding-inline-start:0;border-inline-start:0;}
    }
    @media (max-width:767px){
      .vh-wrap{max-width:560px;padding:20px 16px 34px;overflow:hidden;}
      .vh-grid{grid-template-columns:1fr;gap:0;min-height:0;}
      .vh-left{display:contents;}
      .vh-title{order:1;width:100%;max-width:none!important;box-sizing:border-box;margin:0!important;padding-inline:4px;text-align:right;font-size:clamp(26px,8vw,34px)!important;line-height:1.55!important;}
      .vh-copy{order:2;width:100%;max-width:none!important;box-sizing:border-box;margin:13px 0 0!important;padding-inline:4px;color:#52525b!important;font-size:13px!important;line-height:2!important;text-align:right!important;}
      .vh-right{order:3;width:100%;justify-content:center;margin-top:22px;}
      .vh-right .vh-mockup{width:min(82vw,350px);aspect-ratio:885/1777;transform:none;}
      .vh-desktop-mockup{display:none!important;}
      .vh-mobile-mockup{display:block;width:100%;height:auto;object-fit:contain;filter:drop-shadow(0 18px 24px rgba(0,0,0,.20));}
      .vh-values{order:4;display:grid;width:100%;grid-template-columns:1fr;gap:11px;margin-top:23px;padding-inline:4px;box-sizing:border-box;}
      .vh-value{direction:rtl;justify-content:flex-start;gap:8px;color:#27272a;white-space:normal;}
      .vh-value+.vh-value{margin-inline-start:0;padding-inline-start:0;border-inline-start:0;}
      .vh-value svg{width:18px;height:18px;color:#18181b;}
      .vh-value span{font-size:14px;font-weight:600;line-height:1.7;}
      .vh-cta{order:5;width:100%;margin:24px 0 0;justify-content:center;}
      .vh-main-cta{width:min(100%,340px);height:58px;box-shadow:0 10px 20px rgba(0,0,0,.10);}
      .vh-main-cta.is-rtl>span:last-child{font-size:0;}
      .vh-main-cta.is-rtl>span:last-child::after{content:"ورود به کتابخانه";font-size:14px;}
    }
    @media (min-width:440px) and (max-width:767px){
      .vh-wrap{max-width:none;padding:36px 24px 42px;}
      .vh-grid{grid-template-columns:minmax(0,1.05fr) minmax(205px,.95fr);gap:18px;align-items:center;}
      .vh-left{display:grid;grid-column:1;grid-row:1;}
      .vh-title{font-size:clamp(24px,4.8vw,34px)!important;line-height:1.55!important;padding:0;}
      .vh-copy{display:block;margin-top:18px!important;padding:0;font-size:12.5px!important;line-height:2!important;overflow:visible;}
      .vh-right{grid-column:2;grid-row:1;width:auto;margin:0;align-self:center;}
      .vh-right .vh-mockup{width:min(100%,330px);}
      .vh-values{display:grid;width:100%;grid-template-columns:1fr;gap:10px;margin-top:23px;padding:0;}
      .vh-value span{font-size:13.5px;}
      .vh-cta{width:100%;margin-top:23px;justify-content:flex-start;}
      .vh-main-cta{width:min(100%,330px);min-width:0;}
    }
    @media(max-width:359px){
      .vh-wrap{padding:16px 14px 30px;}
      .vh-title{font-size:25px!important;}
      .vh-copy{font-size:12.5px!important;}
      .vh-right .vh-mockup{width:min(80vw,286px);}
      .vh-value span{font-size:13px;}
    }
  `;

  return (
    <section className="landing-mobile-hero" data-screen-label="Hero" style={{ background: "var(--ed-paper)" }}>
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="vh-wrap">
        <div className="vh-grid">
          <div className="vh-left" dir={rtl ? "rtl" : "ltr"} style={{ textAlign: align }}>
            <h1 className="vh-title" style={{ margin: 0, fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: "clamp(32px,3.1vw,40px)", lineHeight: 1.38, letterSpacing: 0, color: "var(--ed-ink)", maxWidth: 430, marginInlineEnd: "auto" }}>
              {d.heroTitle.map((l, i) => (<React.Fragment key={i}>{i > 0 ? <br /> : null}{l}</React.Fragment>))}
            </h1>
            <p className="vh-copy" style={{ margin: "20px 0 0", fontFamily: "var(--font-sans)", fontSize: 14, lineHeight: 2, color: "#3f3f46", maxWidth: 430, textAlign: rtl ? "right" : "left", marginInlineEnd: "auto", textWrap: "pretty" }}>
              {d.heroSubNew}
            </p>
            <div className="vh-cta">
              <MotionButton rtl={rtl} onClick={() => {
                trackEvent("landing_primary_cta_clicked", { authenticated: Boolean(getCachedSession()), intent: "general-entry" });
                window.location.hash = getCachedSession() ? "#/dashboard" : buildAuthHash({ intent: "general-entry", returnTo: ROUTES.dashboard });
              }} className={`vh-main-cta ${rtl ? "is-rtl" : "is-ltr"}`} aria-label={rtl ? "ورود به کتابخانه" : "Start with Vidora"} label={rtl ? "شروع با Vidora" : "Start with Vidora"} />
            </div>
            <div className="vh-values">
              {valueItems.map((label) => <div className="vh-value" key={label}><CheckCircle2 size={13} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span></div>)}
            </div>
          </div>

          <div className="vh-right">
            <MockupPlaceholder />
          </div>
        </div>

      </div>
    </section>
  );
}

window.EditorialHero = EditorialHero;


// work/vidora/ui_kits/marketing/EditorialSections.jsx
// Vidora editorial landing — pillars band, NEW KNOWLEDGE, features strip, curated cards
function EditorialPillars() {
  const { d } = window.useLang();
  const icons = ["cpu", "user", "globe"];
  const cols = d.pillars.map((p, i) => ({ icon: icons[i], title: p.title, body: p.body }));
  return (
    <section data-screen-label="Pillars" style={{ background: "#000", color: "#fff" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "72px 56px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
        {cols.map((c, i) => (
          <div key={c.title} style={{ padding: i === 0 ? "0 48px 0 0" : "0 48px", borderLeft: i > 0 ? "1px solid var(--ed-line-inverse)" : "none" }}>
            <Icon name={c.icon} size={36} stroke={1.4} />
            <h3 style={{ margin: "26px 0 0", fontFamily: "var(--font-sans)", fontSize: 19, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>{c.title}</h3>
            <p style={{ margin: "14px 0 0", fontFamily: "var(--font-sans)", fontSize: 15, lineHeight: 1.6, color: "var(--ed-text-muted-inverse)", maxWidth: 220 }}>{c.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditorialKnowledge() {
  const { Button } = window.VidoraDesignSystem_0f84f2;
  const { d } = window.useLang();
  return (
    <section data-screen-label="New knowledge" style={{ position: "relative", background: "var(--ed-surface)", overflow: "hidden", minHeight: 460 }}>
      {/* Photo — right half, full-bleed, fills the section edge-to-edge */}
      <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "52%", minHeight: 420, overflow: "hidden" }}>
        <image-slot
          id="learning-study"
          shape="rect"
          fit="cover"
          src="data:image/jpeg;base64,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"
          placeholder="Learning photo — person studying with laptop, watching a translated video or transcript. Calm, focused mood. Monochrome."
          style={{ width: "100%", height: "100%", background: "var(--ed-photo-fallback)", display: "block", filter: "var(--ed-photo-filter)" }}
        ></image-slot>
      </div>
      <div style={{ position: "relative", maxWidth: 1440, margin: "0 auto", padding: "96px 56px", zIndex: 2 }}>
        <div style={{ maxWidth: "44%" }}>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "var(--ed-caps-tracking-wide)", textTransform: "uppercase", color: "var(--ed-text-muted)" }}>{d.learnMore}</div>
          <h2 style={{ margin: "20px 0 0", fontFamily: "var(--font-sans)", fontWeight: "var(--ed-display-weight)", fontSize: "clamp(44px, 4.6vw, 64px)", lineHeight: "var(--ed-display-leading)", letterSpacing: "var(--ed-display-tracking)", textTransform: "uppercase", color: "var(--ed-ink)" }}>
            {d.knowledgeLines.map((l, i) => (<React.Fragment key={i}>{i > 0 ? <br /> : null}{l}</React.Fragment>))}
          </h2>
          <p style={{ margin: "28px 0 0", fontFamily: "var(--font-sans)", fontSize: 16, lineHeight: 1.6, color: "var(--ed-body)", maxWidth: 340 }}>
            {d.knowledgeBody}
          </p>
          <Button variant="primary" size="lg" style={{ marginTop: 34 }}>
            {d.exploreLibrary}
          </Button>
        </div>
      </div>
    </section>
  );
}

function EditorialFeatures() {
  const { d } = window.useLang();
  const icons = ["globe", "subtitles", "fileText", "lock"];
  const feats = d.features.map((f, i) => ({ icon: icons[i], title: f.title, body: f.body }));
  return (
    <section data-screen-label="Features" style={{ background: "var(--ed-paper)" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "56px 56px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)" }}>
        {feats.map((f, i) => (
          <div key={f.title} style={{ display: "flex", gap: 16, alignItems: "flex-start", padding: i === 0 ? "0 36px 0 0" : "0 36px", borderLeft: i > 0 ? "1px solid var(--ed-line)" : "none" }}>
            <span style={{ flex: "none", color: "var(--ed-ink)", paddingTop: 2 }}><Icon name={f.icon} size={27} stroke={1.5} /></span>
            <span>
              <span style={{ display: "block", fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ed-ink)" }}>{f.title}</span>
              <span style={{ display: "block", marginTop: 7, fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.5, color: "var(--ed-text-muted)", maxWidth: 190 }}>{f.body}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function EditorialCurated() {
  const { d } = window.useLang();
  const base = [
    { slot: "curated-tech", author: "Dr. Mateo Alvarez", duration: "42:18", ph: "Thumbnail — speaker / interview visual. Monochrome, editorial." },
    { slot: "curated-business", author: "Rina Patel", duration: "36:05", ph: "Thumbnail — business / founder on stage. Monochrome, editorial." },
    { slot: "curated-world", author: "The Economist Intelligence", duration: "50:22", ph: "Thumbnail — global / news visual (earth, data). Monochrome, editorial." },
  ];
  const cards = base.map((b, i) => ({ ...b, eyebrow: d.cards[i].eyebrow, title: d.cards[i].title, meta: d.cards[i].meta }));
  return (
    <section data-screen-label="Curated for you" style={{ background: "var(--ed-paper)" }}>
      <div style={{ maxWidth: 1440, margin: "0 auto", padding: "16px 56px 110px" }}>
        <div style={{ display: "flex", alignItems: "baseline", marginBottom: 26 }}>
          <h2 style={{ margin: 0, fontFamily: "var(--font-sans)", fontSize: 20, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--ed-ink)" }}>{d.curatedTitle}</h2>
          <span style={{ flex: 1 }} />
          <a style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap", fontFamily: "var(--font-sans)", fontSize: 11.5, fontWeight: 600, letterSpacing: "var(--ed-caps-tracking)", textTransform: "uppercase", color: "var(--ed-ink)", textDecoration: "none", cursor: "pointer" }}>
            {d.viewAll} <Icon name="arrowRight" size={15} stroke={2} />
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 26 }}>
          {cards.map((c) => (
            <div key={c.slot} style={{ cursor: "pointer" }}>
              <div style={{ position: "relative", aspectRatio: "16 / 9", borderRadius: "var(--ed-radius)", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, filter: "var(--ed-photo-filter)" }}>
                  <image-slot id={c.slot} shape="rect" fit="cover" placeholder={c.ph} style={{ width: "100%", height: "100%", background: "var(--ed-photo-fallback)", display: "block" }}></image-slot>
                </div>
                <span style={{ position: "absolute", right: 10, bottom: 10, background: "rgba(0,0,0,0.85)", color: "#fff", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 500, padding: "3px 7px", borderRadius: "var(--ed-radius)", pointerEvents: "none", zIndex: 2 }}>{c.duration}</span>
              </div>
              <div style={{ marginTop: 16, fontFamily: "var(--font-sans)", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "#8a8a86" }}>{c.eyebrow}</div>
              <div style={{ marginTop: 8, fontFamily: "var(--font-sans)", fontSize: 17.5, fontWeight: 600, lineHeight: 1.3, color: "var(--ed-ink)" }}>{c.title}</div>
              <div style={{ marginTop: 6, fontFamily: "var(--font-sans)", fontSize: 13, color: "var(--ed-text-muted)" }}>{c.author}</div>
              <div style={{ marginTop: 4, fontFamily: "var(--font-sans)", fontSize: 12, color: "#8a8a86" }}>{c.meta}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

window.EditorialPillars = EditorialPillars;
window.EditorialKnowledge = EditorialKnowledge;
window.EditorialFeatures = EditorialFeatures;
window.EditorialCurated = EditorialCurated;


// work/vidora/ui_kits/marketing/EditorialFooter.jsx
// Vidora editorial landing — footer. Persian-first i18n via useLang(); RTL-safe.
function useReveal(delay) {
  const ref = React.useRef(null);
  const [shown, setShown] = React.useState(false);
  const reduce = React.useRef(typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  React.useEffect(() => {
    if (reduce.current) { setShown(true); return; }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } });
    }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const style = reduce.current ? {} : {
    filter: shown ? "blur(0px)" : "blur(4px)",
    transform: shown ? "translateY(0)" : "translateY(-8px)",
    opacity: shown ? 1 : 0,
    transition: `filter 800ms var(--ease-standard) ${delay}ms, transform 800ms var(--ease-standard) ${delay}ms, opacity 800ms var(--ease-standard) ${delay}ms`,
  };
  return [ref, style];
}

function AnimatedContainer({ delay = 100, style = {}, children }) {
  const [ref, revealStyle] = useReveal(delay);
  return <div ref={ref} style={{ ...revealStyle, ...style }}>{children}</div>;
}

function EditorialFooter() {
  const { d } = window.useLang();
  const sections = d.footer.sections;
  const rights = d.footer.rights.replace("{year}", new Date().getFullYear());

  const heading = { margin: 0, fontFamily: "var(--font-sans)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "var(--ed-caps-tracking)", color: "#f5f5f4" };
  const linkStyle = { display: "inline-flex", alignItems: "center", fontFamily: "var(--font-sans)", fontSize: 14, lineHeight: 1.4, color: "rgba(255,255,255,0.62)", textDecoration: "none", transition: "color 300ms var(--ease-standard)", cursor: "pointer" };

  return (
    <footer
      data-screen-label="Footer"
      style={{ position: "relative", width: "100%", maxWidth: 1152, margin: "72px auto 0", borderTop: "1px solid rgba(255,255,255,0.1)", borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: "56px 40px 44px", overflow: "hidden", background: "radial-gradient(60% 140px at 50% 0%, rgba(255,255,255,0.06), transparent), #0a0a0a" }}
    >
      <div style={{ position: "absolute", top: -1, insetInlineStart: "50%", transform: "translateX(-50%)", height: 2, width: "34%", borderRadius: 9999, background: "#ffffff", opacity: 0.28, filter: "blur(3px)" }}></div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) 2fr", gap: 40, alignItems: "start" }}>
        <AnimatedContainer delay={0} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 20, letterSpacing: "0.16em", color: "#ffffff" }}>VIDORA</span>
          <p style={{ margin: 0, maxWidth: 260, fontFamily: "var(--font-sans)", fontSize: 13.5, lineHeight: 1.55, color: "rgba(255,255,255,0.6)" }}>
            {d.footer.tagline}
          </p>
          <p style={{ margin: "8px 0 0", fontFamily: "var(--font-sans)", fontSize: 13, color: "rgba(255,255,255,0.45)" }}>
            {rights}
          </p>
        </AnimatedContainer>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 32 }}>
          {sections.map((section, i) => (
            <AnimatedContainer key={section.label} delay={100 + i * 100} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <h3 style={heading}>{section.label}</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                {section.links.map((title) => (
                  <li key={title}>
                    <span style={{ ...linkStyle, cursor: "default" }}>
                      {title}
                    </span>
                  </li>
                ))}
              </ul>
            </AnimatedContainer>
          ))}
        </div>
      </div>
    </footer>
  );
}

window.EditorialFooter = EditorialFooter;

const dashboardCopy = { en: dashboardEn, fa: dashboardFa };
const dashboardViews = new Set(["dashboard", "new-video", "library", "saved", "profile", "subscription", "support", "settings", "video-detail"]);
const dashboardViewAliases = {
  completed: "library",
  videos: "library",
  "new-translation": "new-video",
  watchlist: "saved",
  notes: "saved",
  usage: "subscription",
  billing: "subscription",
};
const dashboardRouteSegments = {
  "new-video": "new-translation",
  library: "videos",
};

const sidebarGroups = [
  {
    labelKey: "primary",
    items: [
      { icon: Home, labelKey: "dashboard", view: "dashboard" },
      { icon: CirclePlus, labelKey: "newTranslation", view: "new-video" },
      { icon: Video, labelKey: "myVideos", view: "library" },
      { icon: BookOpen, labelKey: "publicLibrary", externalHash: "#/library" },
    ],
  },
  {
    labelKey: "saved",
    items: [
      { icon: Bookmark, labelKey: "saved", view: "saved" },
      { icon: Crown, labelKey: "subscription", view: "subscription" },
    ],
  },
  {
    labelKey: "help",
    items: [
      { icon: Headphones, labelKey: "support", view: "support" },
    ],
  },
];

function VidoraDashboard({ session, previewData = null, previewMode = false }) {
  const { lang } = window.useLang();
  const t = dashboardCopy[lang] || dashboardCopy.fa;
  const isFa = lang === "fa";
  const profileName = getDisplayName(session);
  const profileEmail = getUserEmail(session);
  const profileInitial = (profileName || profileEmail || "V").trim().charAt(0).toUpperCase();
  const avatarInputRef = React.useRef(null);
  const getVideoDetailId = () => {
    const match = /^#\/(?:dashboard|panel)\/videos\/([0-9a-fA-F-]{8,})/.exec(window.location.hash);
    return match ? match[1] : "";
  };
  const getInitialView = () => {
    if (previewMode) return "dashboard";
    if (getVideoDetailId()) return "video-detail";
    const segment = window.location.hash.replace(/^#\/(?:dashboard|panel)\/?/, "") || "dashboard";
    const view = dashboardViewAliases[segment] || segment;
    return dashboardViews.has(view) ? view : "dashboard";
  };
  const [activeView, setActiveView] = React.useState(getInitialView);
  const [videoDetailId, setVideoDetailId] = React.useState(getVideoDetailId);
  const [deleteTarget, setDeleteTarget] = React.useState(null);
  const [videoFilter, setVideoFilter] = React.useState("All");
  const [noteQuery, setNoteQuery] = React.useState("");
  const [profileSaved, setProfileSaved] = React.useState(false);
  const [supportSent, setSupportSent] = React.useState(false);
  const [logoutConfirm, setLogoutConfirm] = React.useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [subscriptionPromptOpen, setSubscriptionPromptOpen] = React.useState(false);
  const subscriptionPromptRef = React.useRef(null);
  const [toast, setToast] = React.useState("");
  const [dashboardData, setDashboardData] = React.useState(() => previewData ? {
    loading: false,
    error: "",
    videos: previewData.videos,
    subscription: previewData.subscription,
  } : {
    loading: true,
    error: "",
    videos: [],
    subscription: null,
  });

  React.useEffect(() => {
    if (previewMode) return undefined;
    let alive = true;
    setDashboardData((state) => ({ ...state, loading: true, error: "" }));
    Promise.all([fetchUserVideos(session), fetchActiveSubscription(session)])
      .then(([videos, subscription]) => {
        if (alive) setDashboardData({ loading: false, error: "", videos, subscription });
      })
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "VidoraDashboard.loadUserData");
        if (alive) setDashboardData({ loading: false, error: appError.messageFa, videos: [], subscription: null });
      });
    return () => {
      alive = false;
    };
  }, [previewMode, session]);

  React.useEffect(() => {
    if (previewMode) return undefined;
    const onHashChange = () => {
      setActiveView(getInitialView());
      setVideoDetailId(getVideoDetailId());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [previewMode]);

  const selectView = (view) => {
    if (!dashboardViews.has(view)) return;
    if (previewMode && (view === "new-video" || view === "video-detail")) {
      showToast(isFa ? "این اقدام در پیش‌نمایش توسعه به سرور ارسال نمی‌شود." : "This action is disabled in the development preview.");
      return;
    }
    setActiveView(view);
    setLogoutConfirm(false);
    setProfileMenuOpen(false);
    setMobileNavOpen(false);
    if (previewMode) return;
    const segment = dashboardRouteSegments[view] || view;
    window.location.hash = view === "dashboard" ? "#/dashboard" : `#/dashboard/${segment}`;
  };

  const signOut = async () => {
    if (previewMode) {
      setLogoutConfirm(false);
      setProfileMenuOpen(false);
      showToast(isFa ? "خروج در پیش‌نمایش توسعه غیرفعال است." : "Sign out is disabled in the development preview.");
      return;
    }
    await signOutUser();
    setLogoutConfirm(false);
    setProfileMenuOpen(false);
    window.location.hash = "#/";
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const openVideoDetail = (videoId) => {
    if (previewMode) {
      showToast(isFa ? "جزئیات ویدیو در پیش‌نمایش به API متصل نمی‌شود." : "Video details do not call the API in preview mode.");
      return;
    }
    window.location.hash = `#/dashboard/videos/${videoId}`;
  };
  const userVideoRows = React.useMemo(() => (
    dashboardData.videos.map((video) => {
      const status = normalizeVideoStatus(video.status);
      const minutes = video.duration_seconds ? `${Math.max(1, Math.round(video.duration_seconds / 60))} ${isFa ? "دقیقه" : "min"}` : "";
      const sourceType = video.source_type === "upload" ? (isFa ? "آپلود" : "Upload") : video.source_type === "youtube" ? (isFa ? "یوتیوب" : "YouTube") : (isFa ? "لینک ویدیو" : "Video link");
      const totalSeconds = Math.max(0, Math.round(video.duration_seconds || 0));
      const durationLabel = totalSeconds
        ? `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`
        : "";
      const ageInDays = Math.round((new Date(video.created_at).getTime() - Date.now()) / 86400000);
      const relativeCreated = Math.abs(ageInDays) < 1
        ? (isFa ? "امروز" : "Today")
        : new Intl.RelativeTimeFormat(isFa ? "fa-IR" : "en-US", { numeric: "auto" }).format(ageInDays, "day");
      const preview = video.preview || null;
      return {
        id: video.id,
        raw: video,
        title: video.title || video.original_filename || video.source_url || (isFa ? "ویدیوی بدون عنوان" : "Untitled video"),
        status,
        stage: statusLabel(video.status, isFa),
        failure: video.failure_message_fa || "",
        created: new Date(video.created_at).toLocaleDateString(isFa ? "fa-IR" : "en-US"),
        minutes,
        durationLabel,
        relativeCreated,
        sourceType,
        action: preview?.action,
        displayStatus: preview ? (isFa ? preview.displayStatusFa : preview.displayStatusEn) : "",
        format: preview?.format || "",
        progressPercent: preview?.progressPercent,
        resolution: preview?.resolution || "",
      };
    })
  ), [dashboardData.videos, isFa]);
  const activeSubscription = isSubscriptionActive(dashboardData.subscription) ? dashboardData.subscription : null;
  const includedMinutes = Number(activeSubscription?.included_minutes || 0);
  const usedMinutes = Number(activeSubscription?.used_minutes || 0);
  const remainingMinutes = Math.max(0, includedMinutes - usedMinutes);
  const usagePercent = includedMinutes > 0 ? Math.min(100, Math.round((usedMinutes / includedMinutes) * 100)) : 0;
  const planName = activeSubscription?.plans?.name_fa || (isFa ? "بدون اشتراک فعال" : "No active subscription");
  const processedCount = previewData?.processedCount ?? dashboardData.videos.filter((video) => video.status === "completed").length;

  React.useEffect(() => {
    if (dashboardData.loading || activeSubscription || activeView !== "dashboard") return;
    const key = `vidora.subscription-prompt.dismissed.${session.user.id}`;
    if (window.sessionStorage.getItem(key) !== "1") {
      setSubscriptionPromptOpen(true);
      trackEvent("dashboard_subscription_popup_viewed", { source: "dashboard", intent: "general-entry", subscription_status: "inactive" });
    }
  }, [activeSubscription, activeView, dashboardData.loading, session.user.id]);

  React.useEffect(() => {
    if (!subscriptionPromptOpen) return undefined;
    const dialog = subscriptionPromptRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll("button,a[href]") || []);
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") dismissSubscriptionPrompt();
      if (event.key === "Tab") {
        const nodes = focusable();
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [subscriptionPromptOpen]);

  const dismissSubscriptionPrompt = () => {
    window.sessionStorage.setItem(`vidora.subscription-prompt.dismissed.${session.user.id}`, "1");
    setSubscriptionPromptOpen(false);
    trackEvent("dashboard_subscription_popup_closed", { source: "dashboard", subscription_status: "inactive" });
  };

  const renderHeader = () => {
    const detailTitles = isFa
      ? ["وضعیت پردازش ویدیو", "وضعیت هر مرحله از پردازش در همین صفحه به‌روزرسانی می‌شود."]
      : ["Video processing status", "Every stage updates on this page as processing advances."];
    const [title, subtitle] = activeView === "video-detail" ? detailTitles : (t.titles[activeView] || t.titles.dashboard);
    return (
      <header className="vd-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </header>
    );
  };

  const retryVideoRow = (video) => {
    if (previewMode) {
      showToast(isFa ? "تلاش مجدد در پیش‌نمایش به صف پردازش ارسال نمی‌شود." : "Retry does not enqueue work in preview mode.");
      return;
    }
    retryVideoProcessing(session, video.id)
      .then(() => {
        showToast(t.toast.retryQueued);
        openVideoDetail(video.id);
      })
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "VidoraDashboard.retryVideoRow");
        showToast(appError.messageFa);
      });
  };

  const renderVideoRow = (video) => (
    <article className="vd-video" key={video.id}>
      <div className="vd-thumb" />
      <div>
        <h3 dir="auto">{video.title}</h3>
        <p>{[video.sourceType, video.minutes, video.created].filter(Boolean).join(" · ")}</p>
        <p className="vd-video-meta">{video.status === "Failed" && video.failure ? video.failure : video.stage}</p>
      </div>
      <span className={`vd-status is-${video.status.toLowerCase()}`}>{t.status[video.status]}</span>
      {video.status === "Failed" ? (
        <button className="vd-open" onClick={() => retryVideoRow(video)}>{t.actions.retry}</button>
      ) : (
        <button className="vd-open" onClick={() => openVideoDetail(video.id)}>{video.status === "Ready" ? t.actions.open : t.actions.viewProgress}</button>
      )}
      <button className="vd-icon-action" aria-label={isFa ? "حذف ویدیو" : "Delete video"} onClick={() => setDeleteTarget(video.raw)}><Trash2 size={16} /></button>
    </article>
  );

  const reloadDashboardData = (silent = false) => {
    if (previewMode) {
      setDashboardData({ loading: false, error: "", videos: previewData.videos, subscription: previewData.subscription });
      if (!silent) showToast(isFa ? "داده‌های نمونه دوباره بارگذاری شد." : "Fixture data reloaded.");
      return;
    }
    if (!silent) setDashboardData((state) => ({ ...state, loading: true, error: "" }));
    Promise.all([fetchUserVideos(session), fetchActiveSubscription(session)])
      .then(([videos, subscription]) => setDashboardData({ loading: false, error: "", videos, subscription }))
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "VidoraDashboard.reloadUserData");
        setDashboardData({ loading: false, error: appError.messageFa, videos: [], subscription: null });
      });
  };

  React.useEffect(() => {
    if (previewMode) return undefined;
    const hasActive = dashboardData.videos.some((video) => isActiveVideoStatus(video.status));
    if (!hasActive) return undefined;
    const timer = window.setInterval(() => reloadDashboardData(true), 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardData.videos, previewMode]);

  const renderIntakePanel = () => activeSubscription ? (
    <TranslationIntakePanel
      session={session}
      isFa={isFa}
      copy={{ startTitle: t.dashboard.startTitle, startText: t.dashboard.startText }}
      onCreated={(videoId) => {
        reloadDashboardData(true);
        openVideoDetail(videoId);
      }}
    />
  ) : (
    <section className="vd-card vd-upload vd-locked-feature">
      <div className="vd-lock-mark"><Lock size={22} /></div>
      <h2>{isFa ? "افزودن و ترجمه ویدیو به اشتراک نیاز دارد" : "Adding and translating videos requires a subscription"}</h2>
      <p>{isFa ? "داشبورد و ویدیوهای قبلی شما در دسترس‌اند؛ برای شروع پردازش جدید، یکی از پلن‌های فعال را انتخاب کنید." : "Your dashboard and existing videos remain available. Choose an active plan to start new processing."}</p>
      <button className="vd-primary" onClick={() => { trackEvent("add_video_attempted", { source: "dashboard", authenticated: true, subscription_status: "inactive" }); window.location.hash = "#/subscriptions"; }}>{isFa ? "مشاهده اشتراک‌ها" : "View subscriptions"}</button>
    </section>
  );

  const confirmDeleteVideo = () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    if (previewMode) {
      showToast(isFa ? "حذف نمونه نمایشی به سرور ارسال نشد." : "The fixture was not deleted or sent to a server.");
      return;
    }
    deleteVideo(session, target)
      .then(() => {
        showToast(isFa ? "ویدیو حذف شد." : "Video deleted.");
        reloadDashboardData(true);
      })
      .catch((error) => {
        const appError = toAppError(error);
        logAppError(appError, "VidoraDashboard.deleteVideo");
        showToast(appError.messageFa);
      });
  };

  const renderVideoList = (rows) => {
    if (dashboardData.loading) {
      return <div className="vd-empty compact"><Search size={24} /><h2>{isFa ? "در حال دریافت داده‌ها..." : "Loading data..."}</h2></div>;
    }
    if (dashboardData.error) {
      return (
        <div className="vd-empty compact">
          <MessageCircle size={26} />
          <h2>{isFa ? "دریافت اطلاعات ممکن نشد" : "Could not load data"}</h2>
          <p>{dashboardData.error}</p>
          <button className="vd-secondary" onClick={reloadDashboardData}>{isFa ? "تلاش دوباره" : "Retry"}</button>
        </div>
      );
    }
    if (!rows.length) {
      return (
        <div className="vd-empty compact">
          <Upload size={28} />
          <h2>{isFa ? "هنوز ویدیویی ندارید" : "No videos yet"}</h2>
          <p>{isFa ? "اولین ویدیوی خود را آپلود کنید یا لینک یک ویدیوی پشتیبانی‌شده را وارد کنید." : "Upload your first video or submit a supported video URL."}</p>
          <button className="vd-primary" onClick={() => selectView("new-video")}>{t.actions.startTranslation}</button>
        </div>
      );
    }
    return <div className="vd-video-list">{rows.map(renderVideoRow)}</div>;
  };

  const renderDashboard = () => (
    <DashboardHome
      isFa={isFa}
      t={t}
      loading={dashboardData.loading}
      error={dashboardData.error}
      videos={userVideoRows}
      planName={planName}
      includedMinutes={includedMinutes}
      remainingMinutes={remainingMinutes}
      usagePercent={usagePercent}
      processedCount={processedCount}
      onOpenVideo={openVideoDetail}
      onRetryVideo={retryVideoRow}
      onSelectView={selectView}
      onReload={() => reloadDashboardData()}
    />
  );

  const renderNewTranslation = () => (
    <section className="vd-wide">
      {renderIntakePanel()}
    </section>
  );

  const renderLibrary = () => {
    const rows = videoFilter === "All" ? userVideoRows : userVideoRows.filter((video) => video.status === videoFilter);
    return (
      <section className="vd-card vd-recent">
        <div className="vd-controls"><label><Search size={17} /><input placeholder={t.library.search} /></label><div>{["All", "Processing", "Ready", "Failed"].map((filter) => <button className={videoFilter === filter ? "is-active" : ""} key={filter} onClick={() => setVideoFilter(filter)}>{t.filters[filter]}</button>)}</div></div>
        {renderVideoList(rows)}
      </section>
    );
  };

  const renderSaved = () => {
    return (
      <section className="vd-view-stack">
        <article className="vd-card vd-recent"><h2>{t.savedPage.liked}</h2><div className="vd-empty compact"><Heart size={28} /><h2>{t.savedPage.emptyTitle}</h2><p>{t.savedPage.emptyText}</p></div></article>
        <article className="vd-card vd-recent"><h2>{t.savedPage.watchlist}</h2><div className="vd-empty compact"><Library size={28} /><h2>{t.savedPage.emptyTitle}</h2><p>{isFa ? "پس از آماده شدن قابلیت ذخیره، ویدیوهای نشان‌شده اینجا نمایش داده می‌شوند." : "Saved videos will appear here after the save feature is connected."}</p></div></article>
        <article className="vd-card vd-recent"><h2>{t.savedPage.notes}</h2><div className="vd-controls single"><label><Search size={17} /><input value={noteQuery} onChange={(event) => setNoteQuery(event.target.value)} placeholder={t.savedPage.searchNotes} /></label></div><div className="vd-empty compact"><FileText size={28} /><h2>{t.savedPage.emptyTitle}</h2><p>{isFa ? "یادداشت‌های واقعی پس از تکمیل صفحه پخش و ابزار یادگیری اضافه می‌شوند." : "Real notes will appear after the watch workspace and learning tools are connected."}</p></div></article>
      </section>
    );
  };

  const renderProfile = () => (
    <section className="vd-card vd-profile">
      <div className="vd-profile-head"><div className="vd-avatar large">{profileInitial}</div><div><h2>{profileName}</h2><p className="vd-technical-text">{profileEmail}</p><button className="vd-secondary" onClick={() => avatarInputRef.current?.click()}>{t.actions.uploadPhoto}</button></div></div>
      <input ref={avatarInputRef} type="file" accept="image/*" hidden />
      <div className="vd-form-grid"><label>{t.profile.name}<input className="vd-input" defaultValue={profileName} /></label><label>{t.profile.email}<input className="vd-input vd-technical-text" defaultValue={profileEmail} readOnly /></label></div>
      <button className="vd-primary" onClick={() => { setProfileSaved(true); showToast(t.toast.profileSaved); }}>{t.actions.saveChanges}</button>
      {profileSaved ? <p className="vd-success"><CheckCircle2 size={16} /> {t.profile.saved}</p> : null}
    </section>
  );

  const renderSubscription = () => (
    <section className="vd-view-stack">
      <article className="vd-card vd-plan-card"><h2>{isFa ? "وضعیت اشتراک" : "Subscription status"}</h2><div className="vd-plan-line"><span>{isFa ? "پلن فعلی" : "Current plan"}</span><strong>{planName}</strong></div><p className="vd-muted">{activeSubscription ? (isFa ? "وضعیت اشتراک از اطلاعات معتبر حساب شما دریافت شده است." : "Subscription status comes from your trusted account record.") : (isFa ? "اشتراک فعالی برای این حساب ثبت نشده است." : "No active subscription is recorded for this account.")}</p><button className="vd-primary" onClick={() => { window.location.hash = "#/subscriptions"; }}>{isFa ? "مشاهده پلن‌های واقعی" : "View available plans"}</button></article>
      <article className="vd-card vd-recent"><h2>{t.subscription.usage}</h2>
      <div className="vd-stats two">
        <article className="vd-card vd-stat"><span>{t.subscription.minutesUsed}</span><strong>{usedMinutes.toLocaleString(isFa ? "fa-IR" : "en-US")}</strong></article>
        <article className="vd-card vd-stat"><span>{t.dashboard.minutesRemaining}</span><strong>{remainingMinutes.toLocaleString(isFa ? "fa-IR" : "en-US")}</strong></article>
      </div>
      <div className="vd-plan-line"><span>{t.subscription.used}</span><strong>{usedMinutes.toLocaleString(isFa ? "fa-IR" : "en-US")} / {includedMinutes.toLocaleString(isFa ? "fa-IR" : "en-US")} minutes</strong></div><div className="vd-meter"><span style={{ width: `${usagePercent}%` }} /></div></article>
      <article className="vd-card vd-plan-card"><h2>{t.subscription.paymentMethod}</h2><div className="vd-empty compact"><BadgeDollarSign size={28} /><h2>{isFa ? "پرداخت هنوز متصل نشده است" : "Payment is not connected yet"}</h2><p>{isFa ? "ساختار اشتراک آماده است؛ اتصال درگاه پرداخت در فاز بعد انجام می‌شود." : "The subscription foundation is ready; payment provider integration is planned for the next phase."}</p></div></article>
      <article className="vd-card vd-recent"><h2>{t.subscription.invoices}</h2><div className="vd-empty compact"><Download size={28} /><h2>{isFa ? "فاکتوری ثبت نشده است" : "No invoices yet"}</h2><p>{isFa ? "پس از اتصال پرداخت، فاکتورهای واقعی اینجا نمایش داده می‌شوند." : "Real invoices will appear here after payment is connected."}</p></div></article>
    </section>
  );

  const renderSupport = () => (
    <section className="vd-view-stack">
      <div className="vd-card-grid">{[t.support.contact, t.support.uploadIssue, t.support.billingQuestion, t.support.featureRequest].map((item) => <button className="vd-mini-card vd-support-card" key={item} onClick={() => showToast(item)}><MessageCircle size={20} /><span>{item}</span></button>)}</div>
      <article className="vd-card vd-profile"><div className="vd-form-grid"><label>{t.support.subject}<input className="vd-input" placeholder={t.support.subjectPlaceholder} /></label><label>{t.support.responseTime}<input className="vd-input" value={t.support.under24} readOnly /></label></div><label>{t.support.message}<textarea className="vd-input vd-textarea" placeholder={t.support.messagePlaceholder} /></label><button className="vd-primary" onClick={() => { setSupportSent(true); showToast(t.toast.supportSent); }}>{t.actions.send}</button><p className="vd-muted">support@vidora.ai</p>{supportSent ? <p className="vd-success"><CheckCircle2 size={16} /> {t.toast.supportSent}</p> : null}</article>
    </section>
  );

  const renderSettings = () => (
    <section className="vd-card vd-profile">
      <div className="vd-form-grid"><label>{t.settings.defaultOutput}<select className="vd-input" defaultValue="Persian"><option value="Persian">{t.upload.persian}</option><option value="English">{t.upload.english}</option></select></label></div>
      <div className="vd-toggle-grid">{[t.settings.autoSubtitles, t.settings.autoSummaries, t.settings.saveNotes].map((label) => <label className="vd-toggle is-on" key={label}><span />{label}</label>)}</div>
      <div className="vd-danger-zone"><button className="vd-secondary danger" onClick={() => showToast(t.toast.deleteRequested)}><Trash2 size={16} /> {t.actions.deleteAccount}</button></div>
    </section>
  );

  const renderActiveView = () => {
    if (activeView === "video-detail") {
      return (
        <VideoProcessingDetail
          session={session}
          videoId={videoDetailId}
          isFa={isFa}
          onBack={() => selectView("library")}
          onDeleted={() => {
            showToast(isFa ? "ویدیو حذف شد." : "Video deleted.");
            reloadDashboardData(true);
            selectView("library");
          }}
        />
      );
    }
    if (activeView === "dashboard") return renderDashboard();
    if (activeView === "new-video") return renderNewTranslation();
    if (activeView === "library") return renderLibrary();
    if (activeView === "saved") return renderSaved();
    if (activeView === "profile") return renderProfile();
    if (activeView === "subscription") return renderSubscription();
    if (activeView === "support") return renderSupport();
    if (activeView === "settings") return renderSettings();
    return renderDashboard();
  };

  const renderSidebarItem = (item) => {
    const ItemIcon = item.icon;
    const isActive = item.view === activeView;
    const onClick = () => {
      if (item.externalHash) {
        window.location.hash = item.externalHash;
        return;
      }
      selectView(item.view);
    };
    const count = item.labelKey === "myVideos" && !dashboardData.loading && !dashboardData.error ? String(userVideoRows.length) : item.count;
    return (
      <button className={`vd-nav-item ${isActive ? "is-active" : ""}`} key={item.labelKey} onClick={onClick}>
        <ItemIcon size={18} strokeWidth={1.8} />
        <span>{t.nav[item.labelKey]}</span>
        {count ? <span className="vd-count">{count}</span> : null}
      </button>
    );
  };

  const sidebarPanel = (
    <aside className={`vd-sidebar${mobileNavOpen ? " is-open" : ""}`} dir={isFa ? "rtl" : "ltr"} aria-label={isFa ? "ناوبری داشبورد" : "Dashboard navigation"}>
      <button className="vd-sidebar-close" aria-label={isFa ? "بستن منو" : "Close menu"} onClick={() => setMobileNavOpen(false)}><X size={18} /></button>
      <div className="vd-sidebar-brand" aria-label="Vidora">vidora</div>
      <div>
        {sidebarGroups.map((group) => <section className="vd-section" key={group.labelKey}><p className="vd-label">{t.sections[group.labelKey]}</p><div className="vd-nav-list">{group.items.map(renderSidebarItem)}</div></section>)}
      </div>
      <div className="vd-profile-menu-wrap">
        {profileMenuOpen ? (
          <div className="vd-profile-menu" role="menu">
            <button role="menuitem" onClick={() => selectView("profile")}>{t.profileMenu.account}</button>
            <button role="menuitem" onClick={() => selectView("settings")}>{t.profileMenu.settings}</button>
            <button role="menuitem" onClick={() => { setProfileMenuOpen(false); if (previewMode) window.location.assign("/"); else window.location.hash = "#/"; }}>{t.profileMenu.backToWebsite}</button>
            <button role="menuitem" className="is-danger" onClick={() => setLogoutConfirm(true)}>{t.profileMenu.logout}</button>
          </div>
        ) : null}
        <button className="vd-user vd-sidebar-profile" onClick={() => setProfileMenuOpen((value) => !value)} aria-expanded={profileMenuOpen}>
          <div className="vd-avatar">{profileInitial}</div>
          <div><h2>{profileName}</h2><p className="vd-technical-text">{profileEmail}</p></div>
          <MoreHorizontal size={17} />
        </button>
      </div>
    </aside>
  );

  const mainPanel = (
    <section className="vd-main" dir={isFa ? "rtl" : "ltr"}>
      <div className="vd-mobile-bar">
        <span className="vd-mobile-wordmark">vidora</span>
        <button className="vd-mobile-menu-button" aria-label={isFa ? "باز کردن منو" : "Open menu"} onClick={() => setMobileNavOpen(true)}><Menu size={19} /></button>
      </div>
      {renderHeader()}
      {renderActiveView()}
    </section>
  );

  return (
    <main className={`vd-page vd-dashboard-redesign ${isFa ? "is-fa" : ""}`} dir={isFa ? "rtl" : "ltr"}>
      <style dangerouslySetInnerHTML={{ __html: `
        .vd-page{min-height:100vh;background:radial-gradient(circle at 14% 8%,rgba(255,255,255,.7),transparent 32%),linear-gradient(135deg,#d8d8d5 0%,#c4c5c1 48%,#dededb 100%);display:flex;align-items:center;justify-content:center;padding:32px;font-family:var(--font-sans);color:#111;overflow:hidden}
        .vd-shell{width:min(1420px,100%);height:min(860px,calc(100vh - 64px));min-height:690px;display:grid;grid-template-columns:310px minmax(0,1fr);gap:14px;border-radius:36px;border:1px solid rgba(255,255,255,.48);background:rgba(238,239,236,.44);box-shadow:0 34px 105px rgba(36,37,34,.18),inset 0 1px 0 rgba(255,255,255,.58);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);padding:14px;overflow:hidden;direction:ltr}.is-fa .vd-shell{grid-template-columns:minmax(0,1fr) 310px}
        .vd-sidebar{grid-column:1;border-radius:28px;background:rgba(243,244,241,.55);border:1px solid rgba(255,255,255,.5);box-shadow:inset 0 1px 0 rgba(255,255,255,.48);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);padding:24px 20px;overflow:auto;display:flex;flex-direction:column}.is-fa .vd-sidebar{grid-column:2}.vd-user{width:100%;border:0;background:transparent;display:flex;align-items:center;gap:14px;margin-bottom:24px;text-align:left;cursor:pointer;color:#111}.vd-profile-menu-wrap{position:relative;margin-top:auto}.vd-sidebar-profile{margin-top:0;margin-bottom:0;border-top:1px solid rgba(30,30,28,.1);padding:18px 13px 0}.vd-sidebar-profile>div:nth-child(2){min-width:0;flex:1}.vd-sidebar-profile svg{color:#696b67;flex:0 0 auto}.vd-profile-menu{position:absolute;left:0;right:0;bottom:82px;border-radius:18px;border:1px solid rgba(255,255,255,.58);background:rgba(245,246,243,.9);box-shadow:0 22px 52px rgba(42,43,40,.18),inset 0 1px 0 rgba(255,255,255,.64);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);padding:8px;display:grid;gap:3px;z-index:5}.vd-profile-menu button{height:38px;border:0;border-radius:12px;background:transparent;color:#191a18;text-align:left;padding:0 11px;font:inherit;font-size:13px;font-weight:720;cursor:pointer}.vd-profile-menu button:hover{background:rgba(255,255,255,.48)}.vd-profile-menu button.is-danger{color:#3a1717}.is-fa .vd-profile-menu button{text-align:right}.is-fa .vd-user{text-align:right}.vd-avatar{width:54px;height:54px;border-radius:999px;background:linear-gradient(145deg,#fafafa,#d9dad6);border:1px solid rgba(255,255,255,.7);box-shadow:0 10px 18px rgba(0,0,0,.12);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:800;color:#202020;flex:0 0 auto}.vd-avatar.large{width:82px;height:82px;font-size:30px}.vd-user h2{margin:0;font-size:19px;line-height:1.1;font-weight:700;letter-spacing:0}.vd-user p{margin:5px 0 0;color:#6d6f6b;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.vd-technical-text{direction:ltr;text-align:left;unicode-bidi:plaintext}.vd-section{padding:14px 0}.vd-section+.vd-section{border-top:1px solid rgba(30,30,28,.1)}.vd-label{font-size:12px;color:#858782;margin:0 0 10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
        .vd-nav-list{display:grid;gap:5px}.vd-nav-item{height:44px;width:100%;border:0;border-radius:14px;background:transparent;color:#191a18;display:grid;grid-template-columns:24px 1fr auto;grid-template-areas:"icon label count";align-items:center;gap:12px;padding:0 13px;text-align:left;font-size:14px;font-weight:650;cursor:pointer;letter-spacing:0;transition:background .18s ease,box-shadow .18s ease}.vd-nav-item svg{grid-area:icon;color:#2d2e2c}.vd-nav-item>span:not(.vd-count){grid-area:label}.is-fa .vd-nav-item{grid-template-columns:auto 1fr 24px;grid-template-areas:"count label icon";text-align:right}.vd-nav-item:hover{background:rgba(255,255,255,.32)}.vd-nav-item.is-active{height:50px;border:1px solid rgba(255,255,255,.62);background:rgba(255,255,255,.42);box-shadow:0 14px 28px rgba(110,114,109,.18),inset 0 1px 0 rgba(255,255,255,.66)}.vd-count{grid-area:count;min-width:26px;height:24px;border-radius:999px;background:rgba(255,255,255,.45);display:inline-flex;align-items:center;justify-content:center;color:#777976;font-size:12px;font-weight:750}
        .vd-main{grid-column:2;border-radius:30px;background:rgba(241,242,239,.52);border:1px solid rgba(255,255,255,.52);box-shadow:inset 0 1px 0 rgba(255,255,255,.52);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);padding:38px;overflow:auto}.is-fa .vd-main{grid-column:1}.vd-head{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;margin-bottom:24px}.vd-head h1{margin:0;font-size:42px;line-height:1.05;font-weight:720;letter-spacing:0;color:#101010}.vd-head p{margin:10px 0 0;color:#727570;font-size:17px;line-height:1.45;max-width:720px}.is-fa .vd-head,.is-fa .vd-head p,.is-fa .vd-head h1{text-align:right}
        .vd-card{border-radius:22px;border:1px solid rgba(255,255,255,.56);background:rgba(255,255,255,.34);box-shadow:0 16px 42px rgba(65,66,62,.1),inset 0 1px 0 rgba(255,255,255,.48);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}.vd-top-grid{display:grid;grid-template-columns:minmax(220px,.34fr) minmax(320px,1fr);gap:18px;margin-bottom:20px}.vd-stats{display:grid;gap:16px}.vd-stats.single{grid-template-columns:1fr}.vd-stats.three{grid-template-columns:repeat(3,1fr)}.vd-stats.two{grid-template-columns:repeat(2,1fr)}.vd-stat{min-height:132px;padding:22px}.vd-stat span{display:block;color:#555854;font-size:13px;font-weight:750;letter-spacing:.01em}.vd-stat strong{display:block;font-size:50px;line-height:.95;font-weight:560;letter-spacing:-.03em;margin-top:22px;color:#222321}
        .vd-plan-card,.vd-upload,.vd-recent,.vd-profile{padding:24px}.vd-plan-card{display:grid;gap:15px}.vd-plan-card h2,.vd-upload h2,.vd-recent h2,.vd-profile h2{margin:0;color:#151515;font-size:22px;line-height:1.15}.vd-plan-line{display:flex;justify-content:space-between;gap:16px;color:#6f716d;font-size:14px}.vd-plan-line strong{color:#171817}.vd-meter{height:8px;border-radius:999px;background:rgba(0,0,0,.1);overflow:hidden}.vd-meter span{display:block;width:64%;height:100%;background:#202020;border-radius:inherit}
        .vd-upload{margin-bottom:22px}.vd-wide{margin-bottom:0}.vd-upload-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}.vd-upload p,.vd-muted{margin:8px 0 0;color:#6d706c;font-size:15px;line-height:1.65;max-width:680px}.vd-helper{margin:0 0 18px!important;color:#5f625e!important}.vd-drop{min-height:184px;border:1.5px dashed rgba(35,35,33,.24);border-radius:22px;background:rgba(255,255,255,.22);display:grid;place-items:center;text-align:center;padding:28px}.vd-drop.is-large{min-height:260px}.vd-drop-icon{width:58px;height:58px;border-radius:18px;background:rgba(255,255,255,.42);border:1px solid rgba(255,255,255,.58);display:inline-flex;align-items:center;justify-content:center;margin-bottom:14px;color:#1f1f1f}.vd-drop h3{margin:0;font-size:18px}.vd-drop p{margin:6px auto 0;color:#777a76;font-size:13px}.vd-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px;justify-content:center}.vd-selected-file{font-weight:720;color:#232421!important}.vd-youtube-section{margin-top:14px;border-radius:18px;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.24);padding:16px;display:grid;grid-template-columns:minmax(220px,.46fr) minmax(0,1fr);gap:14px;align-items:center}.vd-youtube-copy{display:flex;align-items:center;gap:12px}.vd-inline-icon{width:38px;height:38px;border-radius:12px;background:rgba(255,255,255,.42);border:1px solid rgba(35,35,35,.1);display:inline-flex;align-items:center;justify-content:center;color:#202020;flex:0 0 auto}.vd-youtube-copy h3{margin:0;font-size:16px}.vd-youtube-copy p{margin:4px 0 0;font-size:13px;color:#777a76}.vd-primary,.vd-secondary,.vd-open{border-radius:13px;border:1px solid transparent;font-weight:720;font-size:14px;display:inline-flex;align-items:center;justify-content:center;gap:9px;cursor:pointer}.vd-primary,.vd-secondary{height:42px;padding:0 15px}.vd-primary{background:#1f1f1f;color:#fff;box-shadow:0 12px 22px rgba(0,0,0,.13)}.vd-primary:disabled{opacity:.42;cursor:not-allowed;box-shadow:none}.vd-secondary,.vd-open{background:rgba(255,255,255,.42);border-color:rgba(35,35,35,.14);color:#151515}.vd-open{height:34px;padding:0 13px}.vd-secondary.danger{color:#3a1717}.vd-link-input{margin-top:16px;display:flex;gap:10px}.vd-input,.vd-link-input input,.vd-controls input{height:42px;flex:1;min-width:0;border-radius:13px;border:1px solid rgba(35,35,35,.14);background:rgba(255,255,255,.42);padding:0 14px;font:inherit;outline:none;color:#151515}.is-fa .vd-input,.is-fa .vd-link-input input,.is-fa .vd-controls input{text-align:right}.vd-url-input,.is-fa .vd-url-input{direction:ltr;text-align:left;unicode-bidi:plaintext}.vd-textarea{height:124px;padding:12px 14px;resize:vertical}.vd-start{margin-top:18px}.vd-start-full{width:100%;height:46px}.vd-success{display:flex;align-items:center;gap:8px;margin:14px 0 0;color:#2f4035;font-weight:700;font-size:14px}
        .vd-video-list{display:grid;gap:10px;margin-top:16px}.vd-video{min-height:74px;border-radius:18px;border:1px solid rgba(255,255,255,.5);background:rgba(255,255,255,.28);display:grid;grid-template-columns:62px minmax(0,1fr) auto auto auto;align-items:center;gap:12px;padding:12px}.vd-thumb{width:62px;height:46px;border-radius:12px;background:linear-gradient(135deg,#2c2d2d,#777872);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1)}.vd-thumb.wide{width:100%;height:120px}.vd-video h3,.vd-mini-card h3{margin:0;font-size:16px;line-height:1.2}.vd-video p,.vd-mini-card p{margin:5px 0 0;color:#747672;font-size:13px}.vd-video-meta{font-size:12px!important;color:#8a8c88!important}.vd-status{height:28px;border-radius:999px;padding:0 10px;background:rgba(255,255,255,.42);display:flex;align-items:center;font-size:12px;font-weight:750;color:#555754}.vd-status.is-ready{color:#263529}.vd-status.is-processing{color:#4d4c43}.vd-status.is-failed{color:#553333}.vd-icon-action{width:34px;height:34px;border-radius:10px;border:1px solid rgba(30,30,28,.14);background:rgba(255,255,255,.28);display:grid;place-items:center;cursor:pointer;color:#191919}
        .vd-controls{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.vd-controls label{height:42px;min-width:250px;display:flex;align-items:center;gap:9px;border-radius:13px;border:1px solid rgba(35,35,35,.14);background:rgba(255,255,255,.34);padding:0 12px}.vd-controls input{border:0;background:transparent;padding:0}.vd-controls div{display:flex;gap:8px}.vd-controls button{height:36px;border-radius:999px;border:1px solid rgba(35,35,35,.14);background:rgba(255,255,255,.28);padding:0 13px;font-weight:700;cursor:pointer}.vd-controls button.is-active{background:#202020;color:#fff}.vd-form-grid,.vd-toggle-grid,.vd-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:18px}.vd-form-grid label{display:grid;gap:8px;color:#555854;font-weight:700;font-size:13px}.vd-toggle{height:44px;border-radius:999px;border:1px solid rgba(35,35,35,.14);background:rgba(255,255,255,.32);display:flex;align-items:center;gap:10px;padding:0 14px;font-weight:720;color:#202020}.vd-toggle span{width:24px;height:24px;border-radius:999px;background:#202020;box-shadow:inset 0 0 0 7px #fff}.vd-mini-card,.vd-plan-option{padding:18px;border-radius:18px;border:1px solid rgba(255,255,255,.55);background:rgba(255,255,255,.3);box-shadow:inset 0 1px 0 rgba(255,255,255,.48)}.vd-tags{display:flex;gap:7px;flex-wrap:wrap;margin:14px 0}.vd-tags span{height:26px;border-radius:999px;background:rgba(255,255,255,.45);padding:0 9px;display:inline-flex;align-items:center;font-size:12px;font-weight:700;color:#555854}.vd-empty{min-height:360px;display:grid;place-items:center;text-align:center;padding:44px}.vd-empty h2{margin:12px 0 0}.vd-empty p{margin:6px 0 0;color:#70736f}.vd-note-date{font-size:12px;color:#777a76}.vd-mini-card blockquote{margin:14px 0;color:#31322f;line-height:1.6}.vd-profile{display:grid;gap:18px}.vd-profile-head{display:flex;align-items:center;gap:18px}.vd-plan-option{display:grid;gap:12px}.vd-plan-option strong{font-size:38px;font-weight:560}.vd-plan-option.is-current{box-shadow:0 18px 38px rgba(65,66,62,.12),inset 0 0 0 1px rgba(0,0,0,.08)}.vd-view-stack{display:grid;gap:18px}.vd-table{display:grid;gap:8px;margin-top:16px}.vd-table>div{display:grid;grid-template-columns:1fr 1fr 1fr 1fr auto;gap:12px;align-items:center;border-radius:14px;background:rgba(255,255,255,.28);padding:10px 12px;color:#555854;font-size:14px}.vd-support-card{width:100%;min-height:90px;border:1px solid rgba(255,255,255,.55);cursor:pointer;display:flex;align-items:center;gap:12px;color:#171817;font-weight:750}.vd-danger-zone{display:flex;gap:10px;flex-wrap:wrap;border-top:1px solid rgba(35,35,35,.1);padding-top:18px}
        .vd-modal{position:fixed;inset:0;background:rgba(30,31,29,.28);display:grid;place-items:center;z-index:50}.vd-modal-card{width:min(420px,calc(100% - 32px));border-radius:24px;border:1px solid rgba(255,255,255,.58);background:rgba(242,243,240,.94);box-shadow:0 28px 80px rgba(0,0,0,.2);padding:24px;backdrop-filter:blur(18px)}.vd-modal-card h2{margin:0;font-size:24px}.vd-modal-card p{color:#666965;line-height:1.75}.vd-modal-actions{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap}.vd-modal-close{width:36px;height:36px;display:grid;place-items:center;margin-inline-start:auto;margin-bottom:14px;border:1px solid rgba(35,35,35,.14);border-radius:11px;background:rgba(255,255,255,.45);cursor:pointer}.vd-locked-feature{display:grid;justify-items:start;gap:12px}.vd-lock-mark{width:48px;height:48px;border-radius:14px;display:grid;place-items:center;background:rgba(255,255,255,.45);border:1px solid rgba(35,35,35,.12)}.vd-locked-feature .vd-primary{margin-top:4px}.vd-toast{position:fixed;right:34px;bottom:34px;border-radius:15px;background:#202020;color:#fff;padding:12px 16px;font-weight:720;box-shadow:0 18px 40px rgba(0,0,0,.18);z-index:60}
        .vd-drop.is-over{border-color:rgba(31,31,31,.55);background:rgba(255,255,255,.4)}
        .vd-upload-file{margin-top:14px;display:flex;align-items:center;gap:12px;border:1px solid rgba(35,35,35,.12);border-radius:15px;background:rgba(255,255,255,.36);padding:12px 14px;color:#1f1f1f}.vd-upload-file-info{flex:1;min-width:0;display:grid;gap:2px}.vd-upload-file-info strong{font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;unicode-bidi:plaintext}.vd-upload-file-info span{font-size:12.5px;color:#777a76}
        .vd-upload-progress{margin-top:14px;display:grid;gap:10px;border:1px solid rgba(255,255,255,.5);border-radius:15px;background:rgba(255,255,255,.28);padding:14px}.vd-upload-progress .vd-secondary{justify-self:start}
        .vd-error{margin:12px 0 0;color:#5a2b24;font-weight:640;font-size:13.5px;line-height:1.7}
        .vd-linklike{border:0;background:none;padding:0;font:inherit;font-weight:740;color:#1f1f1f;text-decoration:underline;cursor:pointer}
        .vd-spin{animation:vdspin .9s linear infinite}@keyframes vdspin{to{transform:rotate(360deg)}}
        .vd-confirm-line{margin-top:12px;display:flex;align-items:flex-start;gap:10px;font-size:13.5px;color:#4c4f4b;line-height:1.7;cursor:pointer}.vd-confirm-line input{width:16px;height:16px;margin-top:3px;accent-color:#1f1f1f;flex:0 0 auto}
        .vd-queued-note{margin:16px 0 0;border:1px solid rgba(255,255,255,.55);border-radius:16px;background:rgba(255,255,255,.3);padding:14px 16px}.vd-queued-note p{margin:0;color:#4c4f4b;font-size:14px;line-height:1.9}.vd-queued-note p+p{margin-top:4px}
        .vd-stagelist{list-style:none;margin:18px 0 0;padding:0;display:grid;gap:4px}.vd-stagelist li{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:13px;color:#83867f;font-size:14.5px}.vd-stagelist li svg{flex:0 0 auto}.vd-stagelist li.is-done{color:#2f4035}.vd-stagelist li.is-current{color:#151515;font-weight:720;background:rgba(255,255,255,.4);border:1px solid rgba(255,255,255,.6)}.vd-stagelist li em{font-style:normal;font-size:12.5px;font-weight:640;color:#5f625e;background:rgba(255,255,255,.55);border-radius:999px;padding:3px 10px}
        .vd-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}.vd-detail-head h2{margin:0;font-size:22px;line-height:1.45;overflow-wrap:anywhere}.vd-detail-actions{display:flex;gap:10px;flex-wrap:wrap;flex:0 0 auto}
        .vd-detail-meta{margin-top:18px;padding-top:14px;border-top:1px solid rgba(35,35,35,.1);display:flex;align-items:center;gap:16px;flex-wrap:wrap;color:#777a76;font-size:12.5px}.vd-detail-meta span{display:inline-flex;align-items:center;gap:6px;min-width:0}.vd-detail-url{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        @media(max-width:1180px){.vd-page{padding:18px;overflow:auto}.vd-shell{height:auto;min-height:0;grid-template-columns:minmax(250px,300px) minmax(0,1fr);overflow:visible}.is-fa .vd-shell{grid-template-columns:minmax(0,1fr) minmax(250px,300px)}.vd-top-grid{grid-template-columns:1fr}.vd-stats.three{grid-template-columns:repeat(3,1fr)}}
        @media(max-width:760px){.vd-page{align-items:flex-start;padding:10px}.vd-shell,.is-fa .vd-shell{grid-template-columns:1fr;padding:10px;border-radius:26px}.vd-sidebar,.is-fa .vd-sidebar,.vd-main,.is-fa .vd-main{grid-column:1}.vd-sidebar{border-radius:22px;padding:18px;min-height:440px}.vd-main{border-radius:22px;padding:22px}.vd-head{display:block}.vd-head h1{font-size:34px}.vd-head p{font-size:16px}.vd-stats,.vd-stats.three,.vd-stats.two,.vd-form-grid,.vd-toggle-grid,.vd-card-grid,.vd-youtube-section{grid-template-columns:1fr}.vd-upload-head{display:block}.vd-video{grid-template-columns:54px minmax(0,1fr);align-items:start}.vd-status,.vd-open,.vd-icon-action{justify-self:start}.vd-link-input,.vd-controls{display:grid}.vd-table>div{grid-template-columns:1fr}.vd-profile-head{align-items:flex-start}.vd-controls label{min-width:0}}
      ` }} />
      <section className="vd-shell" dir={isFa ? "rtl" : "ltr"} aria-label="Vidora dashboard">
        {isFa ? <>{mainPanel}{sidebarPanel}</> : <>{sidebarPanel}{mainPanel}</>}
      </section>
      {mobileNavOpen ? <button className="vd-mobile-backdrop" aria-label={isFa ? "بستن منو" : "Close menu"} onClick={() => setMobileNavOpen(false)} /> : null}
      {subscriptionPromptOpen ? <div className="vd-modal" role="presentation"><div ref={subscriptionPromptRef} className="vd-modal-card" role="dialog" aria-modal="true" aria-labelledby="subscription-prompt-title" dir={isFa ? "rtl" : "ltr"}><button className="vd-modal-close" onClick={dismissSubscriptionPrompt} aria-label={isFa ? "بستن" : "Close"}><X size={17} /></button><h2 id="subscription-prompt-title">{isFa ? "برای استفاده کامل از Vidora اشتراک تهیه کنید" : "Subscribe for the complete Vidora experience"}</h2><p>{isFa ? "با فعال‌کردن اشتراک، می‌توانید ویدیوهای کتابخانه را تماشا کنید، ویدیوهای دلخواهتان را اضافه کنید و به زیرنویس فارسی، خلاصه و نکات کلیدی هوشمند دسترسی داشته باشید." : "An active subscription unlocks Library playback, adding your own videos, Persian subtitles, summaries, and smart takeaways."}</p><div className="vd-modal-actions"><button className="vd-secondary" onClick={dismissSubscriptionPrompt}>{isFa ? "فعلاً بعداً" : "Maybe later"}</button><button className="vd-primary" onClick={() => { dismissSubscriptionPrompt(); window.location.hash = "#/subscriptions"; }}>{isFa ? "مشاهده اشتراک‌ها" : "View subscriptions"}</button></div></div></div> : null}
      {logoutConfirm ? <div className="vd-modal" role="dialog" aria-modal="true"><div className="vd-modal-card" dir={isFa ? "rtl" : "ltr"}><h2>{t.modal.logoutTitle}</h2><p>{t.modal.logoutText}</p><div className="vd-modal-actions"><button className="vd-secondary" onClick={() => setLogoutConfirm(false)}>{t.actions.cancel}</button><button className="vd-primary" onClick={signOut}>{t.actions.logout}</button></div></div></div> : null}
      {deleteTarget ? (
        <div className="vd-modal" role="dialog" aria-modal="true">
          <div className="vd-modal-card">
            <h2>{isFa ? "ویدیو حذف شود؟" : "Delete this video?"}</h2>
            <p>{isFa ? "فایل و همه اطلاعات پردازش این ویدیو برای همیشه حذف می‌شود." : "The file and all processing data will be permanently removed."}</p>
            <div className="vd-modal-actions">
              <button className="vd-secondary" onClick={() => setDeleteTarget(null)}>{t.actions.cancel}</button>
              <button className="vd-primary" onClick={confirmDeleteVideo}>{isFa ? "حذف قطعی" : "Delete"}</button>
            </div>
          </div>
        </div>
      ) : null}
      {toast ? <div className="vd-toast">{toast}</div> : null}
    </main>
  );
}


// Auth pages — full-screen SignInPage / SignUpPage (components/ui) in the
// dark B&W theme (`dark` class flips the semantic tokens). Reached via the
// header buttons through #/login and #/signup hash routes (GitHub Pages
// friendly). Copy follows the site language: Persian (RTL form) by default,
// English when the visitor switched the site to EN.
const AUTH_STRINGS = {
  fa: {
    signInTitle: "خوش آمدید",
    signInDescription: "وارد حساب کاربری خود شوید و یادگیری را ادامه دهید",
    signUpTitle: "ساخت حساب",
    signUpDescription: "به ویدورا بپیوندید و از بهترین ویدیوهای آموزشی دنیا یاد بگیرید",
    signIn: {
      emailLabel: "ایمیل",
      emailPlaceholder: "ایمیل خود را وارد کنید",
      passwordLabel: "رمز عبور",
      passwordPlaceholder: "رمز عبور خود را وارد کنید",
      keepSignedIn: "مرا وارد نگه دار",
      resetPassword: "بازیابی رمز عبور",
      signIn: "ورود",
      orContinueWith: "یا ادامه با",
      continueWithGoogle: "ادامه با گوگل",
      newToPlatform: "کاربر جدید هستید؟",
      createAccount: "ساخت حساب",
    },
    signUp: {
      nameLabel: "نام و نام خانوادگی",
      namePlaceholder: "نام خود را وارد کنید",
      emailLabel: "ایمیل",
      emailPlaceholder: "ایمیل خود را وارد کنید",
      passwordLabel: "رمز عبور",
      passwordPlaceholder: "یک رمز عبور بسازید",
      confirmPasswordLabel: "تکرار رمز عبور",
      confirmPasswordPlaceholder: "رمز عبور را دوباره وارد کنید",
      agreeToTerms: "با شرایط استفاده و حریم خصوصی موافقم",
      createAccount: "ساخت حساب",
      orContinueWith: "یا ادامه با",
      continueWithGoogle: "ادامه با گوگل",
      alreadyHaveAccount: "قبلاً حساب دارید؟",
      signIn: "ورود",
    },
    testimonials: [
      {
        avatarSrc: "https://randomuser.me/api/portraits/women/57.jpg",
        name: "سارا محمدی",
        handle: "@sara_learns",
        text: "با ویدورا بالاخره می‌تونم سخنرانی‌های انگلیسی رو کامل بفهمم. زیرنویس‌ها فوق‌العاده دقیق هستن.",
      },
      {
        avatarSrc: "https://randomuser.me/api/portraits/men/64.jpg",
        name: "امیر رضایی",
        handle: "@amir_dev",
        text: "خلاصه‌ها و نکات کلیدی وقتم رو نصف کرده. بهترین ابزار یادگیری که استفاده کردم.",
      },
      {
        avatarSrc: "https://randomuser.me/api/portraits/men/32.jpg",
        name: "حسین کریمی",
        handle: "@hossein_pm",
        text: "هر روز باهاش ویدیوهای آموزشی می‌بینم. ترجمه‌ها روان و طبیعی هستن.",
      },
    ],
  },
  en: {
    signInTitle: "Welcome",
    signInDescription: "Access your account and continue your journey with us",
    signUpTitle: "Create Account",
    signUpDescription: "Join Vidora and learn from the world's best educational videos",
    signIn: undefined, // component's English defaults
    signUp: undefined,
    testimonials: [
      {
        avatarSrc: "https://randomuser.me/api/portraits/women/57.jpg",
        name: "Sarah Chen",
        handle: "@sarahdigital",
        text: "Amazing platform! The user experience is seamless and the features are exactly what I needed.",
      },
      {
        avatarSrc: "https://randomuser.me/api/portraits/men/64.jpg",
        name: "Marcus Johnson",
        handle: "@marcustech",
        text: "This service has transformed how I work. Clean design, powerful features, and excellent support.",
      },
      {
        avatarSrc: "https://randomuser.me/api/portraits/men/32.jpg",
        name: "David Martinez",
        handle: "@davidcreates",
        text: "I've tried many platforms, but this one stands out. Intuitive, reliable, and genuinely helpful for productivity.",
      },
    ],
  },
};

function useAuthLang() {
  const { lang } = window.useLang();
  const t = AUTH_STRINGS[lang] || AUTH_STRINGS.fa;
  return { t, rtl: lang === "fa" };
}

// Auth backdrop — the user's own photo, committed to the repo.
const AUTH_HERO_IMAGE = () => `${import.meta.env.BASE_URL}uploads/IMG_0766.JPG`;

const OAUTH_DISABLED_FA = "ورود با گوگل پس از تنظیم Provider در Supabase فعال می‌شود. فعلاً با ایمیل و رمز عبور وارد شوید.";
const OAUTH_DISABLED_EN = "Google sign-in will be available after the Supabase provider is configured. Use email and password for now.";

function signInFieldErrors(error) {
  if (!(error instanceof AppError)) return {};
  if (error.code === "INVALID_EMAIL") return { email: error.messageFa };
  if (error.code === "INVALID_PASSWORD") return { password: error.messageFa };
  return {};
}

function signUpFieldErrors(error) {
  if (!(error instanceof AppError)) return {};
  if (error.code === "INVALID_EMAIL" || error.code === "DUPLICATE_ACCOUNT") return { email: error.messageFa };
  if (error.code === "INVALID_PASSWORD" || error.code === "WEAK_PASSWORD") return { password: error.messageFa };
  if (error.code === "PASSWORD_MISMATCH") return { confirmPassword: error.messageFa };
  if (error.code === "TERMS_REQUIRED") return { agreeTerms: error.messageFa };
  return {};
}

async function completeAuthNavigation(session, authIntent) {
  try {
    await fetchActiveSubscription(session);
  } catch (error) {
    logAppError(toAppError(error), "completeAuthNavigation.subscription");
  }
  trackEvent("auth_completed", { intent: authIntent.intent, selected_plan: authIntent.planSlug || null });
  const isPlanCheckout = authIntent.intent === "buy-subscription" && authIntent.planSlug;
  if (isPlanCheckout) persistAuthIntent(authIntent);
  else consumeAuthIntent();
  const destination = isPlanCheckout
    ? `${ROUTES.checkout}?plan=${encodeURIComponent(authIntent.planSlug)}`
    : authIntent.intent === "general-entry" ? ROUTES.dashboard : sanitizeReturnTo(authIntent.returnTo, ROUTES.dashboard);
  window.location.hash = toHash(destination);
}

function LoginPage() {
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { t, rtl } = useAuthLang();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [formNotice, setFormNotice] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
  const authIntent = React.useMemo(() => persistAuthIntent(readAuthIntentFromHash()), []);

  const handleSignIn = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setIsSubmitting(true);
    setFormError("");
    setFormNotice("");
    setFieldErrors({});
    try {
      const session = await signInWithPassword(String(data.email || ""), String(data.password || ""));
      await completeAuthNavigation(session, authIntent);
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "LoginPage.handleSignIn");
      setFieldErrors(signInFieldErrors(appError));
      setFormError(appError.messageFa);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="vd-signin dark bg-background text-foreground">
      <SignInPage
        title={<span className="font-light text-foreground tracking-tighter">{t.signInTitle}</span>}
        description={t.signInDescription}
        dir={rtl ? "rtl" : "ltr"}
        labels={t.signIn}
        isSubmitting={isSubmitting}
        formError={formError}
        fieldErrors={fieldErrors}
        heroImageSrc={AUTH_HERO_IMAGE()}
        testimonials={[]}
        onSignIn={handleSignIn}
        onGoogleSignIn={() => setFormError(rtl ? OAUTH_DISABLED_FA : OAUTH_DISABLED_EN)}
        onResetPassword={() => setFormError(rtl ? "بازیابی رمز عبور در مرحله بعد به Supabase Email Templates وصل می‌شود." : "Password reset will be connected to Supabase email templates in the next phase.")}
        onCreateAccount={() => { window.location.hash = buildAuthHash({ mode: "signup", intent: authIntent.intent, returnTo: authIntent.returnTo, planSlug: authIntent.planSlug }); }}
      />
    </div>
  );
}

function SignupPage() {
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);
  const { t, rtl } = useAuthLang();
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState("");
  const [formNotice, setFormNotice] = React.useState("");
  const [fieldErrors, setFieldErrors] = React.useState({});
  const authIntent = React.useMemo(() => persistAuthIntent(readAuthIntentFromHash()), []);

  const handleSignUp = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    setIsSubmitting(true);
    setFormError("");
    setFormNotice("");
    setFieldErrors({});
    try {
      const password = String(data.password || "");
      const confirmPassword = String(data.confirmPassword || "");
      if (!String(data.name || "").trim()) {
        throw new AppError({
          code: "UNKNOWN_SERVER_ERROR",
          httpStatus: 400,
          messageFa: "نام خود را وارد کنید.",
          retryable: false,
          logMessage: "Missing signup display name",
        });
      }
      if (password !== confirmPassword) {
        throw new AppError({
          code: "PASSWORD_MISMATCH",
          httpStatus: 400,
          messageFa: "رمز عبور و تکرار آن یکسان نیستند.",
          retryable: false,
          logMessage: "Signup password mismatch",
        });
      }
      if (!data.agreeTerms) {
        throw new AppError({
          code: "TERMS_REQUIRED",
          httpStatus: 400,
          messageFa: "برای ساخت حساب باید قوانین و حریم خصوصی را بپذیرید.",
          retryable: false,
          logMessage: "Signup terms not accepted",
        });
      }
      const result = await signUpWithPassword({
        email: String(data.email || ""),
        password,
        displayName: String(data.name || ""),
      });
      if (result.emailConfirmationRequired) {
        setFormNotice(rtl ? "حساب شما ساخته شد. برای ورود، ایمیل خود را تأیید کنید و سپس وارد شوید." : "Your account was created. Confirm your email, then sign in.");
        return;
      }
      if (result.session) await completeAuthNavigation(result.session, authIntent);
    } catch (error) {
      const appError = toAppError(error);
      logAppError(appError, "SignupPage.handleSignUp");
      const nextFieldErrors = signUpFieldErrors(appError);
      if (appError.messageFa === "نام خود را وارد کنید.") nextFieldErrors.name = appError.messageFa;
      setFieldErrors(nextFieldErrors);
      setFormError(appError.messageFa);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="vd-signin dark bg-background text-foreground">
      <SignUpPage
        title={<span className="font-light text-foreground tracking-tighter">{t.signUpTitle}</span>}
        description={t.signUpDescription}
        dir={rtl ? "rtl" : "ltr"}
        labels={t.signUp}
        isSubmitting={isSubmitting}
        formError={formError}
        formNotice={formNotice}
        fieldErrors={fieldErrors}
        heroImageSrc={AUTH_HERO_IMAGE()}
        testimonials={[]}
        onSignUp={handleSignUp}
        onGoogleSignUp={() => setFormError(rtl ? OAUTH_DISABLED_FA : OAUTH_DISABLED_EN)}
        onSignIn={() => { window.location.hash = buildAuthHash({ intent: authIntent.intent, returnTo: authIntent.returnTo, planSlug: authIntent.planSlug }); }}
      />
    </div>
  );
}

function usePublicPlansPageState() {
  const [state, setState] = React.useState({ loading: true, plans: [], error: "", session: getCachedSession() });
  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    Promise.all([fetchPublicPlans(controller.signal), restoreAuthSession()])
      .then(([plans, session]) => { if (alive) setState({ loading: false, plans, error: "", session }); })
      .catch((error) => { if (alive && error?.name !== "AbortError") setState((current) => ({ ...current, loading: false, error: "دریافت اطلاعات اشتراک با خطا مواجه شد." })); });
    const unsubscribe = subscribeAuthState((session) => setState((current) => ({ ...current, session })));
    return () => { alive = false; controller.abort(); unsubscribe(); };
  }, []);
  return state;
}

function SubscriptionPlansPage() {
  const { lang } = window.useLang();
  const isFa = lang === "fa";
  const state = usePublicPlansPageState();
  React.useEffect(() => { window.scrollTo(0, 0); trackEvent("subscription_plans_viewed", { source: "public" }); }, []);
  const selectPlan = (plan) => {
    const priorIntent = readAuthIntent();
    const returnTo = priorIntent?.intent === "buy-subscription" ? priorIntent.returnTo : ROUTES.dashboard;
    const purchaseIntent = createAuthIntent({ intent: "buy-subscription", returnTo, planSlug: plan.slug });
    trackEvent("plan_selected", { selected_plan: plan.slug, authenticated: Boolean(state.session) });
    if (state.session) {
      persistAuthIntent(purchaseIntent);
      window.location.hash = `#/checkout?plan=${encodeURIComponent(plan.slug)}`;
    } else {
      window.location.hash = buildAuthHash({ intent: "buy-subscription", returnTo, planSlug: plan.slug });
    }
  };
  return <main className="plans-page" dir={isFa ? "rtl" : "ltr"}><EditorialHeader /><style>{`.plans-page{min-height:100vh;background:#f7f7f7;color:#18181b;font-family:var(--font-sans)}.plans-in{max-width:1120px;margin:auto;padding:86px 32px 110px}.plans-head{max-width:680px}.plans-head h1{margin:0;font-size:clamp(34px,4vw,52px);line-height:1.25}.plans-head p{margin:18px 0 0;color:#71717a;line-height:1.9}.plans-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:42px}.plan-card{display:flex;flex-direction:column;min-height:390px;padding:26px;border:1px solid #dedee2;border-radius:14px;background:#fff}.plan-card h2{margin:0;font-size:22px}.plan-card-desc{min-height:52px;margin:10px 0 0;color:#71717a;font-size:13.5px;line-height:1.75}.plan-price{margin-top:28px;font-size:34px;font-weight:750}.plan-period{margin-top:6px;color:#71717a;font-size:12px}.plan-facts{display:grid;gap:12px;margin:28px 0;color:#3f3f46;font-size:13px}.plan-card button{height:44px;margin-top:auto;border:0;border-radius:10px;background:#18181b;color:#fff;font:inherit;font-weight:750;cursor:pointer}.plans-message{margin-top:32px;padding:18px;border:1px solid #dedee2;border-radius:12px;background:#fff;color:#52525b;line-height:1.8}.plans-error{color:#542c2c}@media(max-width:850px){.plans-grid{grid-template-columns:1fr}.plan-card{min-height:0}.plans-in{padding:58px 20px 80px}}`}</style><div className="plans-in"><div className="plans-head"><h1>{isFa ? "اشتراک ویدورا" : "Vidora subscription"}</h1><p>{isFa ? "پلن‌ها از اطلاعات واقعی سرویس ویدورا دریافت می‌شوند. پرداخت فقط پس از اتصال و تأیید درگاه انجام خواهد شد." : "Plans are loaded from Vidora's real service. Payment will only proceed after a verified provider is connected."}</p></div>{state.loading ? <div className="plans-message">{isFa ? "در حال دریافت پلن‌ها..." : "Loading plans..."}</div> : state.error ? <div className="plans-message plans-error">{state.error}</div> : state.plans.length === 0 ? <div className="plans-message">{isFa ? "در حال حاضر پلن فعالی برای خرید وجود ندارد." : "There are no active plans available right now."}</div> : <div className="plans-grid">{state.plans.map((plan) => <article className="plan-card" key={plan.id}><h2>{plan.name_fa}</h2><p className="plan-card-desc">{plan.description_fa}</p><strong className="plan-price" dir="ltr">{formatPlanPrice(plan, isFa ? "fa-IR" : "en-US")}</strong><span className="plan-period">{isFa ? `${plan.billing_period_days.toLocaleString("fa-IR")} روز` : `${plan.billing_period_days} days`}</span><div className="plan-facts"><span>{isFa ? `${plan.included_minutes.toLocaleString("fa-IR")} دقیقه استفاده` : `${plan.included_minutes.toLocaleString()} included minutes`}</span><span>{isFa ? `حداکثر زمان هر ویدیو: ${Math.round(plan.max_video_duration_seconds / 60).toLocaleString("fa-IR")} دقیقه` : `Maximum video duration: ${Math.round(plan.max_video_duration_seconds / 60)} minutes`}</span></div><button onClick={() => selectPlan(plan)}>{isFa ? "انتخاب پلن" : "Select plan"}</button></article>)}</div>}</div></main>;
}

function CheckoutEntryPage() {
  const { lang } = window.useLang();
  const isFa = lang === "fa";
  const state = usePublicPlansPageState();
  const planSlug = new URLSearchParams(window.location.hash.split("?")[1] || "").get("plan") || "";
  const selected = state.plans.find((plan) => plan.slug === planSlug);
  const purchaseIntent = readAuthIntent();
  const purchaseReturnTo = purchaseIntent?.intent === "buy-subscription" ? purchaseIntent.returnTo : ROUTES.dashboard;
  const [notice, setNotice] = React.useState("");
  React.useEffect(() => {
    if (!state.loading && !state.session) window.location.hash = buildAuthHash({ intent: "buy-subscription", returnTo: purchaseReturnTo, planSlug });
  }, [state.loading, state.session, planSlug, purchaseReturnTo]);
  if (state.loading || !state.session) return <AuthLoadingScreen />;
  return <main className="plans-page" dir={isFa ? "rtl" : "ltr"}><EditorialHeader /><style>{`.plans-page{min-height:100vh;background:#f7f7f7;color:#18181b;font-family:var(--font-sans)}.plans-in{max-width:760px;margin:auto;padding:86px 32px 110px}.plans-head h1{margin:0;font-size:clamp(34px,4vw,52px);line-height:1.25}.plans-head p{margin:18px 0 0;color:#71717a;line-height:1.9}.plans-message{margin-top:32px;padding:26px;border:1px solid #dedee2;border-radius:12px;background:#fff;color:#52525b;line-height:1.8}.plans-error{color:#542c2c}@media(max-width:850px){.plans-in{padding:58px 20px 80px}}`}</style><div className="plans-in"><div className="plans-head"><h1>{isFa ? "ادامه خرید اشتراک" : "Continue subscription purchase"}</h1><p>{selected ? `${selected.name_fa} · ${formatPlanPrice(selected, isFa ? "fa-IR" : "en-US")}` : (isFa ? "پلن انتخاب‌شده معتبر یا فعال نیست." : "The selected plan is not valid or active.")}</p></div><div className="plans-message"><h2 style={{ marginTop: 0 }}>{isFa ? "درگاه پرداخت هنوز متصل نشده است" : "Payment is not connected yet"}</h2><p>{isFa ? "هیچ پرداخت یا اشتراک فعالی به‌صورت آزمایشی ساخته نمی‌شود. پس از اتصال درگاه معتبر، همین مرحله خرید را ادامه خواهد داد." : "No fake payment or active subscription will be created. This boundary is ready for a verified payment provider."}</p>{notice ? <p className="plans-error">{notice}</p> : null}<button disabled={!selected} onClick={async () => { if (!selected) return; trackEvent("checkout_started", { selected_plan: selected.slug }); try { await paymentAdapter.startCheckout({ planSlug: selected.slug, returnTo: purchaseReturnTo }); } catch (error) { setNotice(error instanceof PaymentNotConfiguredError ? error.messageFa : "در شروع پرداخت خطایی رخ داد."); } }} style={{ height: 44, border: 0, borderRadius: 10, paddingInline: 18, background: "#18181b", color: "#fff", font: "inherit", fontWeight: 750, cursor: selected ? "pointer" : "not-allowed", opacity: selected ? 1 : .5 }}>{isFa ? "ادامه به پرداخت" : "Continue to payment"}</button></div></div></main>;
}

function AuthLoadingScreen({ message = "در حال بررسی حساب..." }) {
  return (
    <main className="min-h-screen bg-zinc-950 text-white flex items-center justify-center p-6" dir="rtl">
      <div className="rounded-3xl border border-white/10 bg-white/[0.04] px-6 py-5 text-center shadow-2xl">
        <p className="text-sm font-bold text-zinc-200">{message}</p>
      </div>
    </main>
  );
}

function ProtectedDashboard({ returnTo }) {
  const safeReturnTo = sanitizeReturnTo(returnTo || getCurrentInternalPath());
  const [authState, setAuthState] = React.useState({ loading: true, session: null });

  React.useEffect(() => {
    let alive = true;
    restoreAuthSession()
      .then((session) => {
        if (alive) setAuthState({ loading: false, session });
      })
      .catch((error) => {
        logAppError(toAppError(error), "ProtectedDashboard.restoreAuthSession");
        if (alive) setAuthState({ loading: false, session: null });
      });
    const unsubscribe = subscribeAuthState((session) => setAuthState({ loading: false, session }));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (!authState.loading && !authState.session) {
      window.location.hash = buildAuthHash({ intent: safeReturnTo === ROUTES.addVideo ? "add-video" : "general-entry", returnTo: safeReturnTo });
    }
  }, [authState.loading, authState.session, safeReturnTo]);

  if (authState.loading) return <AuthLoadingScreen />;
  if (!authState.session) return <AuthLoadingScreen message="برای ورود به داشبورد باید وارد حساب شوید..." />;
  return <VidoraDashboard session={authState.session} />;
}

const DashboardPreview = __VIDORA_DASHBOARD_PREVIEW_ENABLED__ ? React.lazy(async () => {
  const { dashboardPreviewFixture } = await import("./components/dashboard/dashboard-preview-fixtures");
  return {
    default: function DashboardPreviewRoute() {
      return (
        <VidoraDashboard
          session={dashboardPreviewFixture.session}
          previewData={dashboardPreviewFixture}
          previewMode
        />
      );
    },
  };
}) : null;

function useHashRoute() {
  const [hash, setHash] = React.useState(() => window.location.hash);
  React.useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return hash;
}

function Page() {
  const hash = useHashRoute();
  const path = window.location.pathname;
  if (import.meta.env.DEV && (hash.startsWith("#/dev/auth-diagnostics") || path === "/dev/auth-diagnostics")) return <AuthDiagnostics />;
  if (hash.startsWith("#/library")) return <LibraryPage />;
  if (hash.startsWith("#/watch/")) return <WatchPage />;
  if (hash.startsWith("#/search")) return <SearchPage />;
  if (__VIDORA_DASHBOARD_PREVIEW_ENABLED__ && path === "/dev/dashboard-preview" && DashboardPreview) {
    return <React.Suspense fallback={<AuthLoadingScreen />}><DashboardPreview /></React.Suspense>;
  }
  if (hash.startsWith("#/subscriptions")) return <SubscriptionPlansPage />;
  if (hash.startsWith("#/checkout")) return <CheckoutEntryPage />;
  if (hash.startsWith("#/dashboard") || hash.startsWith("#/panel")) return <ProtectedDashboard returnTo={getCurrentInternalPath()} />;
  if (hash.startsWith("#/login")) return <LoginPage />;
  if (hash.startsWith("#/signup")) return <SignupPage />;
  if (path === "/dashboard" || path === "/panel" || path.endsWith("/dashboard")) {
    return <ProtectedDashboard returnTo="/dashboard" />;
  }
  return (
    <React.Fragment>
      <EditorialHeader mobileFloating />
      <EditorialHero />
      <LandingAddVideoSection />
      <LandingCategories />
      <LandingSelectedVideos />
      <LandingFooter />
    </React.Fragment>
  );
}

window.applyVidoraLang(window.__vidoraLang || "fa");
createRoot(document.getElementById("root")).render(<Page />);
