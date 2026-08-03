// ═══════════════════════════════════════════════════════════════════
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

export const INTRO_COUNT = 11;

export interface StorySection {
  /** Key prefix, e.g. "story.s3" */
  id: string;
  /** Paragraph count under this section. */
  paras: number;
}

export const STORY_SECTIONS: StorySection[] = [
  { id: 'story.s1', paras: 5 },   // Philosophy as something you actually use
  { id: 'story.s2', paras: 2 },   // Before you support anything
  { id: 'story.s3', paras: 2 },   // What remains free
  { id: 'story.s4', paras: 2 },   // Why it is called enkiRIDION
  { id: 'story.s5', paras: 4 },   // What building it actually took
  { id: 'story.s6', paras: 3 },   // Where the money goes
  { id: 'story.s7', paras: 3 },   // What your support does not buy
  { id: 'story.s8', paras: 4 },   // Why any of this exists
];
