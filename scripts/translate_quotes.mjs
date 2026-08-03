#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// translate_quotes — build the per-language quote corpora.
//
//   node scripts/translate_quotes.mjs                 # all target langs
//   node scripts/translate_quotes.mjs es pt           # just these
//   node scripts/translate_quotes.mjs --dry           # cost estimate only
//
// Reads the English corpus out of src/constants.ts and writes
//   public/quotes/<lang>.json   { "<hash12>": "translated text", … }
//
// Keyed by a hash of the ENGLISH source string, not by array index, so
// regenerating constants.ts from new authoring JSON does not invalidate
// existing translations — unchanged quotes keep their hash and are
// skipped on the next run. Identical quotes across philosophers collapse
// to one translation.
//
// RESUMABLE. Every batch is checkpointed to disk as it lands, so a
// crash, a rate limit, or a Ctrl-C costs one batch, not the run. Re-run
// the same command to pick up exactly where it stopped.
//
// Needs OPENAI_API_KEY in the environment. It is never logged.
// ═══════════════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'quotes');

// Arabic is included here on purpose: the phone webapp renders it fully.
// The GLASSES fall back to English for Arabic (the G2 firmware font has
// no Arabic glyphs — every letter measures 0 advance), which is handled
// in src/i18n.ts, not here.
const LANGS = {
  es: 'Spanish (Latin American, neutral)',
  pt: 'Portuguese (Brazilian)',
  de: 'German',
  ru: 'Russian',
  zh: 'Simplified Chinese',
  ja: 'Japanese',
};

const MODEL = 'gpt-4o';
const BATCH = 25;        // quotes per request
const CONCURRENCY = 4;   // parallel requests

const hash12 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);

// ─── Extract the English corpus ──────────────────────────────────────
// Each quote is emitted by generate_constants.py as a single line of the
// form `{ text: "…", source: "…", emotion: … }`, so a line-anchored
// regex is exact here — no TS parse needed.
function readCorpus() {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'constants.ts'), 'utf8');
  const re = /\{ text: "((?:[^"\\]|\\.)*)", source: "((?:[^"\\]|\\.)*)"/g;
  const texts = new Set();
  const sources = new Set();
  let m;
  while ((m = re.exec(src)) !== null) {
    texts.add(JSON.parse(`"${m[1]}"`));
    sources.add(JSON.parse(`"${m[2]}"`));
  }

  // ── Metadata ───────────────────────────────────────────────────────
  // Everything the quote pages render ALONGSIDE the quote: the emotion,
  // the rarity tier, the tags, the archetype, the blend, the tradition,
  // and the philosopher's name. These were English-only for a while,
  // which made a "translated" Chinese quote page read half in Chinese
  // and half in English ("Conviction · Fierce Clarity · Virtue").
  //
  // They are collected in their DISPLAY form (capitalize / formatTag in
  // constants.ts), not raw snake_case, because the display form is what
  // gets hashed and looked up at render time.
  const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
  const fmt = t => t.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const meta = new Set();
  const collect = (regex, fn, group = 1) => {
    let mm; const r = new RegExp(regex.source, regex.flags);
    while ((mm = r.exec(src)) !== null) meta.add(fn(mm[group]));
  };
  collect(/emotion: "([^"]+)"/g, cap);
  collect(/blend: "([^"]+)"/g, fmt);
  collect(/archetype: "([^"]+)"/g, fmt);
  collect(/rarity: "([^"]+)"/g, cap);
  collect(/^    name: "([^"]+)"/gm, x => x);            // philosopher names
  const tre = /tags: \[([^\]]*)\]/g;
  while ((m = tre.exec(src)) !== null) {
    m[1].split(',').map(t => t.trim().replace(/"/g, '')).filter(Boolean).forEach(t => meta.add(fmt(t)));
  }
  const trads = (src.match(/export const TRADITIONS = \[([^\]]*)\]/) || [])[1];
  if (trads) trads.split(',').map(x => x.trim().replace(/"/g, '')).filter(Boolean).forEach(t => meta.add(t));

  return { texts: [...texts], sources: [...sources], meta: [...meta] };
}

// ─── Prompt ──────────────────────────────────────────────────────────
// The register matters more than literalness: these are aphorisms that
// have to land on a 576×288 HUD, so length discipline is part of the
// brief, not an afterthought.
function systemPrompt(langName) {
  return [
    `You are a literary translator rendering philosophical aphorisms into ${langName}.`,
    '',
    'Rules:',
    `1. Translate the MEANING and the RHETORICAL REGISTER, not the words. These are aphorisms by Marcus Aurelius, Laozi, the Buddha, Nietzsche and their peers. They must sound like philosophy in ${langName}, not like translated English.`,
    '2. Where the passage has a well-known conventional rendering in the target language, use the phrasing a well-read speaker would recognise — but write it yourself. Do not quote a copyrighted published translation.',
    '3. Keep it TIGHT. The output is displayed on a smart-glasses HUD roughly ten words wide. Never exceed ~1.3× the source length. For Chinese and Japanese, aim well under the source length.',
    '4. Preserve the aphoristic shape: if the source is one sentence, return one sentence. Keep antithesis, parallelism and rhythm where they carry the thought.',
    '5. Return ONLY the translations. No commentary, no notes, no quotation marks added, no numbering.',
    '',
    'You will receive a JSON array of strings. Return a JSON object of the form {"out": [...]} whose "out" array has EXACTLY the same length and order.',
  ].join('\n');
}

/** Metadata are LABELS, not prose: emotion names, rarity tiers, tags,
 *  archetypes, traditions and philosophers' names. They need the
 *  conventional term a native reader already knows (Socrates is
 *  苏格拉底 in Chinese, Сократ in Russian), not a literal rendering. */
function labelPrompt(langName) {
  return [
    `You are localising short INTERFACE LABELS for a philosophy app into ${langName}.`,
    '',
    'These are single words or short phrases: emotion names (Wonder, Conviction), rarity tiers (Epic, Legendary), thematic tags (Self Knowledge, Virtue), archetypes (The Mirror, The Flame), philosophical traditions (Stoicism, Vedanta), and the names of historical philosophers (Socrates, Laozi, Marcus Aurelius).',
    '',
    'Rules:',
    '1. Use the CONVENTIONAL established term in the target language, the one a well-read native speaker already knows. Philosopher names especially: use the standard local form (Socrates is 苏格拉底 in Chinese, ソクラテス in Japanese, Сократ in Russian), never a phonetic invention.',
    '2. Keep it SHORT. These render as chips and strip text on a small display. Never pad a one-word label into a phrase.',
    '3. Match the register: evocative, not clinical. "The Flame" is an archetype name, not a fire safety term.',
    '4. Preserve capitalisation style appropriate to the target language.',
    '5. "Enki" and "enkiRIDION" are brand marks and never change.',
    '',
    'You receive a JSON array of labels. Return {"out": [...]} with EXACTLY the same length and order.',
  ].join('\n');
}

async function translateBatch(items, langName, key, kind = 'quote') {
  const body = {
    model: MODEL,
    temperature: kind === 'label' ? 0.15 : 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: kind === 'label' ? labelPrompt(langName) : systemPrompt(langName) },
      { role: 'user', content: JSON.stringify(items) },
    ],
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
      });
      if (resp.status === 429 || resp.status >= 500) {
        const wait = 2 ** attempt * 2000;
        console.log(`  … ${resp.status}, retrying in ${wait / 1000}s`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!resp.ok) throw new Error(`${resp.status} ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json();
      const out = JSON.parse(data.choices[0].message.content).out;
      if (!Array.isArray(out) || out.length !== items.length) {
        throw new Error(`length mismatch: sent ${items.length}, got ${Array.isArray(out) ? out.length : typeof out}`);
      }
      return { out, usage: data.usage };
    } catch (e) {
      if (attempt === 4) throw e;
      await new Promise(r => setTimeout(r, 2 ** attempt * 1500));
    }
  }
}

// ─── Run one language ────────────────────────────────────────────────
async function runLang(code, all, key, kind = 'quote') {
  const outPath = path.join(OUT_DIR, `${code}.json`);
  const done = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : {};
  const todo = all.filter(s => !done[hash12(s)]);
  if (todo.length === 0) {
    console.log(`[${code}] already complete (${Object.keys(done).length} strings)`);
    return { code, tokens: 0 };
  }
  console.log(`[${code}] ${todo.length} ${kind === 'label' ? 'labels' : 'strings'} to translate (${Object.keys(done).length} cached)`);

  const batches = [];
  for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));

  let finished = 0, tokens = 0;
  let cursor = 0;
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (cursor < batches.length) {
      const mine = batches[cursor++];
      const { out, usage } = await translateBatch(mine, LANGS[code], key, kind);
      mine.forEach((src, i) => { done[hash12(src)] = out[i]; });
      tokens += usage?.total_tokens ?? 0;
      finished++;
      // Checkpoint every batch — a crash costs one batch, never the run.
      fs.writeFileSync(outPath, JSON.stringify(done, null, 0));
      if (finished % 5 === 0 || finished === batches.length) {
        console.log(`[${code}] ${finished}/${batches.length} batches · ${Object.keys(done).length} strings`);
      }
    }
  });
  await Promise.all(workers);
  console.log(`[${code}] DONE — ${Object.keys(done).length} strings, ~${tokens.toLocaleString()} tokens`);
  return { code, tokens };
}

// ─── Main ────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dry = args.includes('--dry');
const picked = args.filter(a => !a.startsWith('--'));
const targets = picked.length ? picked : Object.keys(LANGS);

const { texts, sources, meta } = readCorpus();
const all = [...texts, ...sources];
console.log(`corpus: ${texts.length} unique quotes + ${sources.length} unique sources = ${all.length} strings`);
console.log(`metadata: ${meta.length} labels (emotions, rarities, tags, archetypes, traditions, philosopher names)`);
console.log(`targets: ${targets.join(', ')}`);

if (dry) {
  const perLang = Math.ceil(all.length / BATCH);
  const est = all.length * 60 * 2 * targets.length; // ~60 tok/string, in+out
  console.log(`\n${perLang} requests per language × ${targets.length} = ${perLang * targets.length} requests`);
  console.log(`≈ ${est.toLocaleString()} tokens ≈ $${((est / 1e6) * 6).toFixed(2)} at gpt-4o blended rates`);
  process.exit(0);
}

const KEY = process.env.OPENAI_API_KEY;
if (!KEY) { console.error('OPENAI_API_KEY not set in the environment.'); process.exit(2); }

fs.mkdirSync(OUT_DIR, { recursive: true });
const started = Date.now();
let total = 0;
for (const code of targets) {
  if (!LANGS[code]) { console.error(`unknown language "${code}"`); continue; }
  const r = await runLang(code, all, KEY);
  total += r.tokens;
  // Labels go into the SAME per-language file and use the same hash
  // lookup, so the runtime needs no second loader — but they get the
  // label prompt, not the aphorism prompt.
  const rm = await runLang(code, meta, KEY, 'label');
  total += rm.tokens;
}
console.log(`\nALL DONE in ${Math.round((Date.now() - started) / 60000)} min · ~${total.toLocaleString()} tokens`);
