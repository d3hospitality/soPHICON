#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// translate_ui — generate public/i18n/<lang>.json from src/locales/en.ts
//
//   node scripts/translate_ui.mjs            # all target languages
//   node scripts/translate_ui.mjs es ja      # just these
//
// English is the source of truth. This regenerates every other language
// from it. Only strings whose ENGLISH text changed since the last run
// are re-translated (cached by hash in public/i18n/.cache.json), so
// adding one key costs one string, not the whole dictionary.
//
// Three things this refuses to ship:
//   1. A translation that dropped a {placeholder}.
//   2. A `g.*` glass string too wide for the 576px HUD — measured with
//      @evenrealities/pretext, not guessed.
//   3. A batch whose length doesn't match what was sent.
// Any of those fails the key and leaves it English rather than shipping
// something broken to a display nobody can debug in the field.
// ═══════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'i18n');
const CACHE = path.join(OUT_DIR, '.cache.json');

const LANGS = {
  es: 'Spanish (Latin American, neutral)',
  pt: 'Portuguese (Brazilian)',
  de: 'German',
  ru: 'Russian',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
};

const MODEL = 'gpt-4o';
// Glass row budget. NOT the declared container width: the support list
// is declared 528px, but the firmware's selection border box plus list
// padding eat ~120px of it. Measured on the simulator 2026-08-02 by
// bisecting real rendered rows — a 380px row fits, a 419px row is
// ellipsised. 504px (the naive 528-24) silently shipped clipped text.
const GLASS_MAX_PX = 380;
// The support body container: 528px wide, 240px tall, 27px line height.
const GLASS_BODY_W = 528;
const GLASS_BODY_LINES = Math.floor(240 / 27);   // 8

const hash12 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

// ─── Load the English dictionary ─────────────────────────────────────
// en.ts imports from letter.ts, so it needs bundling rather than a
// regex. esbuild is already present as a vite dependency.
function loadEN() {
  const tmp = path.join(ROOT, 'node_modules', '.cache-en-dict.mjs');
  fs.mkdirSync(path.dirname(tmp), { recursive: true });
  execFileSync('npx', ['esbuild', path.join(ROOT, 'src/locales/en.ts'),
    '--bundle', '--format=esm', '--platform=neutral', `--outfile=${tmp}`, '--log-level=error'],
    { cwd: ROOT, stdio: 'inherit' });
  return tmp;
}

const enModulePath = loadEN();
const { EN } = await import(pathToFileURL(enModulePath).href);
const keys = Object.keys(EN);
console.log(`dictionary: ${keys.length} keys`);

// ─── Optional pixel measurement for glass strings ────────────────────
let getTextWidth = null, measureTextWrap = null;
try { ({ getTextWidth, measureTextWrap } = await import('@evenrealities/pretext')); }
catch { console.log('note: @evenrealities/pretext not installed — skipping glass width checks'); }

function systemPrompt(langName, kind) {
  const base = [
    `You are localising the interface of enkiRIDION, a philosophy practice app, into ${langName}.`,
    '',
    'Rules that apply to every string:',
    '- Translate for a NATIVE user. Idiomatic, not literal. It must read like software written in that language.',
    '- Preserve any {placeholder} tokens EXACTLY as written, including the braces. Never translate what is inside them.',
    '- Preserve leading/trailing symbols and arrows (→ ‹ ← + ·) exactly.',
    '- Keep the register: plain, direct, a little literary. Never corporate.',
    '- NEVER translate or transliterate the product name "enkiRIDION", the tier name "Sage", or "Enki". They are brand marks and stay in Latin script exactly as written, even in Cyrillic/CJK/Arabic text.',
    '- Do NOT use em dashes (—). Use commas, colons, periods or parentheses instead. The ONLY exception is where the target language grammatically requires one (for example the Russian copula dash in "Я — Ромарио"); never use one as a stylistic aside.',
    '- Return ONLY the translations, no commentary.',
  ];
  if (kind === 'glass') {
    base.push(
      '',
      'THESE ARE SMART-GLASSES STRINGS. They render on a 576x288 monochrome HUD about ten words wide.',
      'Be RUTHLESSLY short — shorter than the English if you can. Abbreviate rather than wrap. Never exceed the source length by more than 15%.',
    );
  }
  if (kind === 'letter') {
    base.push(
      '',
      'THESE ARE PARAGRAPHS FROM A PERSONAL LETTER by the solo developer, asking for optional tips.',
      'This is the most voice-sensitive text in the product. Translate it as a HUMAN would write it in that language: first person, self-deprecating, plain-spoken, occasionally wry. Keep the rhythm and the short punchy closing sentences.',
      'Do NOT flatten it into neutral marketing prose. Do NOT add politeness formulas the English does not have.',
      'Factual claims (prices, counts, "this is not the membership") must survive exactly — they are the point of the letter.',
    );
  }
  base.push('', 'You receive a JSON array of strings. Return a JSON object {"out": [...]} with EXACTLY the same length and order.');
  return base.join('\n');
}

async function callOpenAI(items, langName, kind, key) {
  const body = {
    model: MODEL,
    temperature: kind === 'letter' ? 0.6 : 0.2,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: systemPrompt(langName, kind) },
      { role: 'user', content: JSON.stringify(items) },
    ],
  };
  let lastErr = 'unknown';
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (resp.status === 429 || resp.status >= 500) {
        lastErr = `HTTP ${resp.status}`;
        await new Promise(r => setTimeout(r, 2 ** attempt * 2000));
        continue;
      }
      if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const out = JSON.parse((await resp.json()).choices[0].message.content).out;
      // A short or malformed array is a MODEL slip, not a fatal error —
      // long prose batches occasionally come back merged or truncated.
      // Retrying costs one request; throwing costs the whole run, which
      // is how a 7-language pass died on batch 6 of Japanese.
      if (!Array.isArray(out) || out.length !== items.length) {
        lastErr = `length mismatch (sent ${items.length}, got ${Array.isArray(out) ? out.length : typeof out})`;
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      return out;
    } catch (e) {
      lastErr = String(e && e.message ? e.message : e);
      await new Promise(r => setTimeout(r, 2 ** attempt * 1000));
    }
  }
  throw new Error(`exhausted retries — last: ${lastErr}`);
}

const PLACEHOLDER = /\{(\w+)\}/g;
function placeholdersOf(s) { return (s.match(PLACEHOLDER) || []).sort().join(','); }

function validate(key, src, out, code) {
  if (typeof out !== 'string' || !out.trim()) return 'empty';
  if (placeholdersOf(src) !== placeholdersOf(out)) return `placeholder drift (${placeholdersOf(src)} → ${placeholdersOf(out)})`;
  // The support body is PROSE in one wrapping container, so its budget
  // is wrapped LINE COUNT, not single-line width like every other g.* key.
  if (key === 'g.supportBody' && measureTextWrap && code !== 'ar') {
    const m = measureTextWrap(out, GLASS_BODY_W);
    if (m.lineCount > GLASS_BODY_LINES) return `wraps to ${m.lineCount} lines, budget is ${GLASS_BODY_LINES}`;
    return null;
  }
  if (key.startsWith('g.') && getTextWidth && code !== 'ar') {
    const w = getTextWidth(out);
    if (w > GLASS_MAX_PX) return `${w}px exceeds ${GLASS_MAX_PX}px glass width`;
  }
  return null;
}

// ─── Run ─────────────────────────────────────────────────────────────
const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('OPENAI_API_KEY not set.'); process.exit(2); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const picked = process.argv.slice(2).filter(a => !a.startsWith('--'));
const targets = picked.length ? picked : Object.keys(LANGS);

// Group keys by the prompt they need — the letter gets its own care.
const groups = {
  glass:  keys.filter(k => k.startsWith('g.')),
  letter: keys.filter(k => /^story\./.test(k)),
};
groups.ui = keys.filter(k => !groups.glass.includes(k) && !groups.letter.includes(k));

for (const code of targets) {
  if (!LANGS[code]) { console.error(`unknown language ${code}`); continue; }
  const outPath = path.join(OUT_DIR, `${code}.json`);
  const existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  cache[code] = cache[code] || {};

  let translated = 0, skipped = 0, failed = 0;
  for (const [kind, groupKeys] of Object.entries(groups)) {
    // Only re-translate keys whose ENGLISH changed since last run.
    const todo = groupKeys.filter(k => cache[code][k] !== hash12(EN[k]));
    if (todo.length === 0) { skipped += groupKeys.length; continue; }

    for (let i = 0; i < todo.length; i += 20) {
      const chunk = todo.slice(i, i + 20);
      const out = await callOpenAI(chunk.map(k => EN[k]), LANGS[code], kind, KEY);
      const retry = [];
      chunk.forEach((k, j) => {
        const why = validate(k, EN[k], out[j], code);
        if (why) { retry.push({ k, why, attempt: out[j] }); return; }
        existing[k] = out[j];
        cache[code][k] = hash12(EN[k]);
        translated++;
      });

      // A too-wide glass row is a solvable problem, not a dead end —
      // some languages (Russian especially) just need to be told the
      // budget in pixels and pushed to abbreviate. Escalate up to three
      // times before giving up and leaving the key English, so a
      // half-Russian half-English list is genuinely the last resort.
      for (let round = 0; round < 3 && retry.length; round++) {
        const asks = retry.map(r =>
          `${EN[r.k]}\n[your previous attempt "${r.attempt}" was REJECTED: ${r.why}. Make it SHORTER — drop adjectives, use shorter synonyms, split nothing. Keep the meaning.]`);
        let redo;
        try { redo = await callOpenAI(asks, LANGS[code], kind, KEY); }
        catch { break; }
        const still = [];
        retry.forEach((r, j) => {
          const why = validate(r.k, EN[r.k], redo[j], code);
          if (why) { still.push({ ...r, why, attempt: redo[j] }); return; }
          existing[r.k] = redo[j];
          cache[code][r.k] = hash12(EN[r.k]);
          translated++;
        });
        retry.length = 0;
        retry.push(...still);
      }
      for (const r of retry) {
        // Delete rather than skip. Skipping would leave a PREVIOUS run's
        // value in the file — which is how a stale, too-wide Russian row
        // survived a tightened budget and shipped truncated to the HUD
        // (caught in the simulator 2026-08-02). Removing the key makes
        // t() fall back to English, which is what 'rejected' must mean.
        delete existing[r.k];
        delete cache[code][r.k];
        console.log(`  [${code}] REJECT ${r.k}: ${r.why} — falling back to English`);
        failed++;
      }
    }
  }
  // Drop anything the English dictionary no longer defines. Without this
  // every renamed or deleted key stays in the generated file forever and
  // ships inside the .ehpk — 490 dead strings had accumulated across
  // seven languages before this was added.
  let orphans = 0;
  for (const k of Object.keys(existing)) {
    if (!(k in EN)) { delete existing[k]; delete cache[code][k]; orphans++; }
  }
  if (orphans) console.log(`  [${code}] purged ${orphans} orphaned keys`);

  fs.writeFileSync(outPath, JSON.stringify(existing, null, 2));
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  console.log(`[${code}] ${translated} translated · ${skipped} cached · ${failed} rejected → ${Object.keys(existing).length} keys`);
}
console.log('\nUI dictionaries written to public/i18n/');
