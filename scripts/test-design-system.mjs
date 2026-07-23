import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const librarySource = readFileSync(new URL('../src/library.jsx', import.meta.url), 'utf8');
const motionButtonSource = readFileSync(new URL('../src/components/ui/motion-button.tsx', import.meta.url), 'utf8');
const interactionSource = readFileSync(new URL('../src/components/ui/interactive-card.css', import.meta.url), 'utf8');
const footerSource = readFileSync(new URL('../src/components/ui/footer-section.tsx', import.meta.url), 'utf8');

test('motion button is a reusable RTL-aware design-system control', () => {
  assert.match(motionButtonSource, /export interface MotionButtonProps/);
  assert.match(motionButtonSource, /rtl \? ArrowLeft : ArrowRight/);
  assert.match(motionButtonSource, /absolute inset-0/);
  assert.match(motionButtonSource, /scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100/);
  assert.match(motionButtonSource, /origin-right/);
  assert.match(motionButtonSource, /h-12 min-w-\[11\.25rem\]/);
  assert.match(motionButtonSource, /start-1 top-1\/2 z-10 grid size-10/);
  assert.doesNotMatch(motionButtonSource, /aspect-square/);
  assert.doesNotMatch(motionButtonSource, /active:scale/);
  assert.match(motionButtonSource, /motion-reduce:transition-none/);
});

test('all landing arrow CTAs use the original shared pill at reduced dimensions', () => {
  assert.doesNotMatch(mainSource, /SecondaryButton/);
  assert.equal((mainSource.match(/<MotionButton rtl=\{rtl\}/g) || []).length, 3);
  assert.match(mainSource, /label=\{rtl \? "شروع با Vidora" : "Start with Vidora"\}/);
  assert.match(mainSource, /label=\{rtl \? "افزودن ویدیوی جدید" : "Add a new video"\}/);
  assert.match(mainSource, /label=\{rtl \? "مشاهده همه ویدیوها" : "View all videos"\}/);
  assert.match(motionButtonSource, /rounded-full border p-1/);
  assert.match(motionButtonSource, /bg-zinc-950 text-white/);
});

test('landing process removes decorative numbers without removing step content', () => {
  assert.doesNotMatch(mainSource, /landing-process-num/);
  assert.match(mainSource, /landing-process-icon/);
  assert.match(mainSource, /landing-process-step\+\.landing-process-step/);
});

test('landing, library, search, and watch use the shared canonical monochrome footer', () => {
  assert.match(mainSource, /<VidoraFooter locale=/);
  assert.match(librarySource, /return <VidoraFooter locale=/);
  assert.match(librarySource, /<PublicFooter \/>/);
  assert.match(footerSource, /vidora-public-footer/);
  assert.match(footerSource, /vidora-public-footer__benefits/);
  assert.match(footerSource, /Headphones/);
  assert.match(footerSource, /ShieldCheck/);
  assert.match(footerSource, /Globe2/);
  assert.match(footerSource, />\s*VIDORA\s*</);
  assert.match(footerSource, /\['درباره ما', '#\/'\]/);
  assert.match(footerSource, /\['تماس با ما', '#\/dashboard\/support'\]/);
  assert.match(footerSource, /rights:/);
  assert.doesNotMatch(footerSource, /radial-gradient/);
  assert.doesNotMatch(mainSource, /function PublicInfoPlaceholder/);
});

test('landing hero keeps only the three requested value items', () => {
  assert.match(mainSource, /\["زیرنویس فارسی", "خلاصه و نکات کلیدی", "پرسش از محتوای ویدیو"\]/);
  assert.doesNotMatch(mainSource, /"کتابخانه شخصی"\]\s*:/);
  assert.doesNotMatch(mainSource, /"Personal library"\]/);
});

test('public headers use the landing header and link the wordmark home', () => {
  assert.match(mainSource, /className="vidora-wordmark-link"/);
  assert.match(mainSource, /aria-label=\{lang === "fa" \? "بازگشت به صفحه اصلی Vidora"/);
  assert.match(librarySource, /const Header = window\.EditorialHeader/);
  assert.match(librarySource, /return Header \? <Header \/> : null/);
  assert.doesNotMatch(librarySource, /search=\{/);
  assert.doesNotMatch(librarySource, /<header className="lib-head">/);
});

test('library hero and search retain their pre-change dimensions', () => {
  assert.match(librarySource, /\.lib-root\{[^}]*min-height:100vh;background:/s);
  assert.doesNotMatch(librarySource, /display:flex;min-height:100vh;flex-direction:column/);
  assert.match(librarySource, /\.is-library \.lib-hero\{height:430px;border:0;border-radius:14px/);
  assert.match(librarySource, /\.is-library \.lib-search-row\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;gap:12px/);
  assert.match(librarySource, /\.is-library \.lib-page-search\{height:46px/);
  assert.match(librarySource, /\.is-library \.lib-filter-btn\{height:46px;min-width:112px/);
});

test('clickable cards share semantic links and the reusable interaction pattern', () => {
  assert.match(mainSource, /<a className="landing-category-card vidora-interactive-card"/);
  assert.match(librarySource, /className="lib-cat-card vidora-interactive-card"/);
  assert.match(interactionSource, /translateY\(var\(--vidora-card-lift\)\)/);
  assert.match(interactionSource, /scale\(1\.025\)/);
  assert.match(interactionSource, /prefers-reduced-motion: reduce/);
  assert.match(interactionSource, /focus-visible/);
});
