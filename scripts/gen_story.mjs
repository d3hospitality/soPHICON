import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'content', 'story.md');


const raw = fs.readFileSync(SRC, 'utf8');
const blocks = raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);

let hook = '';
const intro = [];
const sections = [];
let cur = null;
for (const b of blocks) {
  if (b.startsWith('# ')) { hook = b.slice(2).trim(); continue; }
  if (b.startsWith('## ')) { cur = { title: b.slice(3).trim(), body: [] }; sections.push(cur); continue; }
  (cur ? cur.body : intro).push(b);
}

const pad = n => String(n).padStart(2, '0');
const lines = [];
lines.push("  // ─── The story (generated from the authored markdown) ────────────");
lines.push("  // Section TITLES are stored in natural case and uppercased in CSS —");
lines.push("  // text-transform survives translation, a hand-uppercased string does");
lines.push("  // not (and German/Russian caps rules differ from English).");
lines.push(`  'story.hook': ${JSON.stringify(hook)},`);
intro.forEach((p, i) => lines.push(`  'story.i${pad(i + 1)}': ${JSON.stringify(p)},`));
sections.forEach((s, si) => {
  lines.push('');
  lines.push(`  'story.s${si + 1}.t': ${JSON.stringify(s.title)},`);
  s.body.forEach((p, i) => lines.push(`  'story.s${si + 1}.p${pad(i + 1)}': ${JSON.stringify(p)},`));
});
lines.push('');
lines.push(`  'story.signName': "Romario",`);
lines.push(`  'story.signRole': "Server by trade. Bootleg engineer by necessity.",`);

// manifest
const manifest = `// ═══════════════════════════════════════════════════════════════════
// Story manifest — GENERATED. Do not hand-edit.
//
// The prose itself lives in src/locales/en.ts as flat dictionary keys so
// the existing translation pipeline picks it up unchanged. This file is
// only the shape: how many intro paragraphs, which sections, how many
// paragraphs each. The renderer walks this rather than hardcoding key
// names, so re-running the generator after an edit to the markdown is
// the only step needed to reshape the page.
//
// Regenerate: node scripts/gen_story.mjs
// ═══════════════════════════════════════════════════════════════════

export const INTRO_COUNT = ${intro.length};

export interface StorySection {
  /** Key prefix, e.g. "story.s3" */
  id: string;
  /** Paragraph count under this section. */
  paras: number;
}

export const STORY_SECTIONS: StorySection[] = [
${sections.map((s, i) => `  { id: 'story.s${i + 1}', paras: ${s.body.length} },   // ${s.title}`).join('\n')}
];
`;
fs.writeFileSync(`${ROOT}/src/story.ts`, manifest);
fs.writeFileSync(path.join(ROOT, 'src', 'locales', 'story-keys.generated.txt'), lines.join('\n'));

console.log(`hook: ${hook}`);
console.log(`intro paragraphs: ${intro.length}`);
sections.forEach((s, i) => console.log(`  s${i + 1} (${s.body.length}p) ${s.title}`));
console.log(`total keys: ${1 + intro.length + sections.reduce((a, s) => a + s.body.length + 1, 0) + 2}`);
