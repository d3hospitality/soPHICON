// ═══════════════════════════════════════════════════════════════════
// i18n — one language choice, three canvases.
//
// English is the SOURCE OF TRUTH and lives in src/locales/en.ts. Every
// other language is generated from it by scripts/translate_ui.mjs into
// public/i18n/<lang>.json and lazy-loaded at runtime. Adding a string
// means adding it to en.ts and re-running that script — never hand-
// editing eight files.
//
// Quotes follow the same shape: public/quotes/<lang>.json, keyed by a
// hash of the English source (see scripts/translate_quotes.mjs).
// Everything ships inside the .ehpk, so switching language never needs
// the network — "offline is sacred" per docs/TRANSLATION-SYSTEM.md.
//
// ── ARABIC WAS REMOVED (2026-08-02) ─────────────────────────────────
// Arabic shipped briefly and did not work. The G2 firmware font has NO
// Arabic glyphs: measured with @evenrealities/pretext, every Arabic
// codepoint returns advance width 0, and LVGL here does no RTL
// contextual shaping either, so glass text rendered as nothing. The
// phone side worked, but a language that is silently English on one of
// the two surfaces is not a supported language. The RTL plumbing
// (dir/bidi handling) is intentionally left in place for whenever an
// RTL language can be done properly.
// ═══════════════════════════════════════════════════════════════════

import type { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { EN, type Dict, type DictKey } from './locales/en';

export type LangCode = 'en' | 'es' | 'pt' | 'de' | 'ru' | 'zh' | 'ja';

export interface LangDef {
  code: LangCode;
  /** Endonym — what speakers call it. Always shown in the picker. */
  native: string;
  /** English name, for the secondary line. */
  english: string;
  rtl: boolean;
  /** False ⇒ the glasses fall back to English for this language. */
  onGlass: boolean;
}

export const LANGS: LangDef[] = [
  { code: 'en', native: 'English',    english: 'English',    rtl: false, onGlass: true  },
  { code: 'es', native: 'Español',    english: 'Spanish',    rtl: false, onGlass: true  },
  { code: 'pt', native: 'Português',  english: 'Portuguese', rtl: false, onGlass: true  },
  { code: 'de', native: 'Deutsch',    english: 'German',     rtl: false, onGlass: true  },
  { code: 'ru', native: 'Русский',    english: 'Russian',    rtl: false, onGlass: true  },
  { code: 'zh', native: '中文',        english: 'Chinese',    rtl: false, onGlass: true  },
  { code: 'ja', native: '日本語',      english: 'Japanese',   rtl: false, onGlass: true  },
];

export const LANG_KEY = 'enki_lang';

let current: LangCode = 'en';
let table: Partial<Dict> = {};                       // active non-English strings
let quoteTable: Record<string, string> = {};         // hash12 → translated quote
const listeners: Array<() => void> = [];

export function lang(): LangCode { return current; }

export function langDef(code: LangCode = current): LangDef {
  return LANGS.find(l => l.code === code) ?? LANGS[0];
}

/** The language the GLASSES should render. Identical to lang() except
 *  for Arabic, which has no firmware glyphs and falls back to English. */
export function glassLang(): LangCode {
  return langDef().onGlass ? current : 'en';
}

/** True when the current choice is phone-only — the picker uses this to
 *  explain the fallback instead of leaving it to be discovered. */
export function isPhoneOnly(): boolean { return !langDef().onGlass; }

/** Subscribe to language changes. Returns an unsubscribe fn. */
export function onLangChange(cb: () => void): () => void {
  listeners.push(cb);
  return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
}

/**
 * Translate. Falls back to English for any key the active language is
 * missing, so a half-translated dictionary degrades to English strings
 * rather than to blank UI or raw key names.
 *
 * Supports {name} placeholders: t('habit.streak', { n: 4 }).
 */
export function t(key: DictKey, vars?: Record<string, string | number>): string {
  const raw = (current === 'en' ? EN[key] : (table[key] ?? EN[key])) ?? String(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Translate for the GLASS specifically — honours the Arabic fallback. */
export function tGlass(key: DictKey, vars?: Record<string, string | number>): string {
  if (glassLang() === current) return t(key, vars);
  const raw = EN[key] ?? String(key);
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translate one quote. Keyed by a hash of the ENGLISH source, so the
 * corpus can be regenerated without invalidating translations. Any quote
 * the batch hasn't reached yet renders in English — never blank.
 *
 * Glasses honour the Arabic fallback: on-glass Arabic would be invisible.
 */
export function tQuote(englishText: string, forGlass = false): string {
  if (forGlass && glassLang() === 'en') return englishText;
  if (current === 'en') return englishText;
  return quoteTable[hash12(englishText)] ?? englishText;
}

/**
 * Translate a METADATA LABEL: an emotion, rarity tier, tag, archetype,
 * tradition, or a philosopher's name. Same hash-keyed corpus and same
 * English fallback as tQuote, but semantically distinct at the call
 * site: these are the strings rendered ALONGSIDE a quote, and leaving
 * them English is what made a translated page read half and half
 * (Chinese quote text over "Conviction / Fierce Clarity / Virtue").
 *
 * Input must be the DISPLAY form (capitalize / formatTag already
 * applied) because that is the form scripts/translate_quotes.mjs hashes.
 */
export function tMeta(display: string, forGlass = false): string {
  return tQuote(display, forGlass);
}

/** FNV-free, dependency-free SHA-256 is unavailable synchronously in the
 *  webview, so the corpus is keyed by the same 12-hex digest the build
 *  script emits — computed here with a tiny synchronous SHA-256. */
function hash12(s: string): string { return sha256hex(s).slice(0, 12); }

// ─── Minimal synchronous SHA-256 ─────────────────────────────────────
// crypto.subtle is async and this is called inside render loops, so a
// small synchronous implementation is the pragmatic choice. Must stay
// byte-compatible with Node's createHash('sha256') in the build script.
const K = new Uint32Array([
  0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
  0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
  0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
  0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
  0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
  0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
  0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
  0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
]);
function sha256hex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  withPad.set(bytes);
  withPad[len] = 0x80;
  new DataView(withPad.buffer).setUint32(withPad.length - 4, len << 3, false);

  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  const view = new DataView(withPad.buffer);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0]+a)>>>0; H[1] = (H[1]+b)>>>0; H[2] = (H[2]+c)>>>0; H[3] = (H[3]+d)>>>0;
    H[4] = (H[4]+e)>>>0; H[5] = (H[5]+f)>>>0; H[6] = (H[6]+g)>>>0; H[7] = (H[7]+h)>>>0;
  }
  let out = '';
  for (const v of H) out += v.toString(16).padStart(8, '0');
  return out;
}

// ─── Loading ─────────────────────────────────────────────────────────

function assetUrl(p: string): string {
  const base = (import.meta as any).env?.BASE_URL || '/';
  return `${base}${p.replace(/^\/+/, '')}`;
}

/** Fetch a language's UI + quote tables. Both are bundled into the pack,
 *  so this is a local read, not a network call. Missing files are not an
 *  error — they mean "that language hasn't been generated yet", and the
 *  app stays in English until it is. */
async function loadTables(code: LangCode): Promise<void> {
  if (code === 'en') { table = {}; quoteTable = {}; return; }
  const [ui, quotes] = await Promise.all([
    fetch(assetUrl(`i18n/${code}.json`)).then(r => r.ok ? r.json() : {}).catch(() => ({})),
    fetch(assetUrl(`quotes/${code}.json`)).then(r => r.ok ? r.json() : {}).catch(() => ({})),
  ]);
  table = ui || {};
  quoteTable = quotes || {};
}

/** Apply direction + lang attributes so the browser does the RTL work
 *  (mirroring, bidi runs, caret behaviour) rather than us faking it. */
/** Text-bearing elements that must resolve their own direction. */
const BIDI_SELECTOR = [
  'p', 'li', 'h1', 'h2', 'h3', 'button', 'label', 'a',
  '.card-header', '.card-body', '.muted', '.badge',
  '.support-intro p', '.story-panel-inner p', '.story-title',
  '.onboard-card', '.onboard-step', '.onboard-fine',
].join(', ');

/**
 * Apply direction, then make every text block resolve its OWN direction.
 *
 * dir="rtl" on <html> gives mirrored layout, which is what Arabic wants.
 * But it also makes RTL the base direction for text that is still
 * ENGLISH — and this app will ship part-translated for a while, so that
 * is the normal case, not an edge case. The symptom is terminal
 * punctuation flung to the wrong end: ".web & Android", ":browser".
 * Caught in the simulator on 2026-08-02.
 *
 * dir="auto" per element is the fix: each block takes its direction from
 * its own first strong character, so Arabic blocks read RTL and English
 * blocks read LTR on the same page. The attribute form is used rather
 * than `unicode-bidi: plaintext` because a stylesheet rule loses to more
 * specific existing selectors — the attribute always wins.
 */
export function applyBidiHints(): void {
  const rtl = langDef().rtl;
  document.querySelectorAll<HTMLElement>(BIDI_SELECTOR).forEach(el => {
    if (rtl) el.setAttribute('dir', 'auto');
    else el.removeAttribute('dir');
  });
}

function applyDirection(): void {
  const d = langDef();
  document.documentElement.lang = d.code;
  document.documentElement.dir = d.rtl ? 'rtl' : 'ltr';
  applyBidiHints();
}

/** Set the language, persist it, and notify every surface to repaint. */
export async function setLang(code: LangCode, bridge?: EvenAppBridge | null): Promise<void> {
  if (!LANGS.some(l => l.code === code)) return;
  current = code;
  await loadTables(code);
  applyDirection();
  if (bridge) {
    try { await bridge.setLocalStorage(LANG_KEY, code); } catch { /* non-fatal */ }
  }
  for (const cb of listeners) { try { cb(); } catch { /* one bad listener must not stop the rest */ } }
}

/** Boot: restore the saved choice, else fall back to the device locale
 *  if we support it, else English. */
export async function initLang(bridge?: EvenAppBridge | null): Promise<LangCode> {
  // ?lang=ja overrides everything, for QA and for scripted per-language
  // screenshots. It is NOT persisted — reload without it and the user's
  // real choice is still there.
  const forced = new URLSearchParams(location.search).get('lang');
  if (forced && LANGS.some(l => l.code === forced)) {
    current = forced as LangCode;
    await loadTables(current);
    applyDirection();
    return current;
  }

  let saved = '';
  if (bridge) { try { saved = (await bridge.getLocalStorage(LANG_KEY)) || ''; } catch { /* ignore */ } }
  let pick = LANGS.find(l => l.code === saved)?.code;
  if (!pick) {
    const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
    pick = LANGS.find(l => l.code === nav)?.code ?? 'en';
  }
  current = pick;
  await loadTables(pick);
  applyDirection();
  return pick;
}
