import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const mainSource = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const motionButtonSource = readFileSync(new URL('../src/components/ui/motion-button.tsx', import.meta.url), 'utf8');
const footerSource = readFileSync(new URL('../src/components/ui/footer-section.tsx', import.meta.url), 'utf8');

test('motion button is a reusable RTL-aware design-system control', () => {
  assert.match(motionButtonSource, /export interface MotionButtonProps/);
  assert.match(motionButtonSource, /rtl \? ArrowLeft : ArrowRight/);
  assert.match(motionButtonSource, /absolute inset-0/);
  assert.match(motionButtonSource, /scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100/);
  assert.match(motionButtonSource, /origin-right/);
  assert.match(motionButtonSource, /start-1 top-1\/2 z-10 grid size-12/);
  assert.doesNotMatch(motionButtonSource, /aspect-square/);
  assert.doesNotMatch(motionButtonSource, /active:scale/);
  assert.match(motionButtonSource, /motion-reduce:transition-none/);
});

test('landing page CTAs use the shared motion button', () => {
  assert.match(mainSource, /label=\{rtl \? "شروع با Vidora" : "Start with Vidora"\}/);
  assert.match(mainSource, /label=\{rtl \? "افزودن ویدیوی جدید" : "Add a new video"\}/);
  assert.match(mainSource, /label=\{rtl \? "مشاهده همه ویدیوها" : "View all videos"\}/);
});

test('landing footer uses the shared animated monochrome footer', () => {
  assert.match(mainSource, /<VidoraFooter locale=/);
  assert.match(footerSource, /useReducedMotion/);
  assert.match(footerSource, /bg-zinc-950/);
  assert.match(footerSource, /\['قوانین و مقررات', 'درباره ما', 'تماس با ما'\]/);
  assert.doesNotMatch(footerSource, /href=/);
  assert.doesNotMatch(footerSource, />VIDORA</);
  assert.doesNotMatch(footerSource, /rights:/);
  assert.doesNotMatch(footerSource, /label: 'محصول'/);
  assert.doesNotMatch(footerSource, /radial-gradient/);
  assert.doesNotMatch(mainSource, /function PublicInfoPlaceholder/);
});

test('landing hero preserves the existing four value items', () => {
  assert.match(mainSource, /\["زیرنویس فارسی", "خلاصه و نکات کلیدی", "پرسش از محتوای ویدیو", "کتابخانه شخصی"\]/);
  assert.match(mainSource, /"Personal library"\]/);
});
