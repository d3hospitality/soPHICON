// ═══════════════════════════════════════════════════════════════════
// enkiRIDION — Daily Checklist module (src/checklist.ts)
//
// The action-learning loop. Every checklist item is metadata-rich:
//
//   Task → Intention → Action → Result → Lesson → Next Action
//
// Lenses (Eisenhower / Stoic control / Domain / 1-3-5 size) are NOT
// separate systems — they're metadata fields on the same ChecklistItem.
// You filter, color, and group by whichever lens is useful for the view.
//
// Causality graph: when you complete an item and define a `nextAction`,
// we draft a NEW item on tomorrow's checklist with parentTaskId pointing
// back. originTaskId points to the root of the chain. So
//
//   "rewrite pitch (originId=A, parentId=A)" → "test pitch on 6 tables
//    (originId=A, parentId=B)" → "shorten to 12s (originId=A, parentId=C)"
//
// becomes a queryable thread of intention → result → next, and that
// thread is what the AI uses to learn your strengths and weaknesses.
//
// Storage:
//   checklist_<YYYY-MM-DD>   — array of ChecklistItem for one day
//   checklist_index          — sorted list of date keys with items
//
// All persistence is async via bridge.localStorage. Pure functions are
// safe to use without a bridge (return defaults).
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { isoWeekKey } from './weekly';

// ═══ Types ═══════════════════════════════════════════════════════════

export const SIZES = ['big', 'medium', 'small'] as const;
export type Size = typeof SIZES[number];

export const DOMAINS = ['Work', 'Love', 'Money', 'Health', 'Mind', 'Spirit', 'Other'] as const;
export type Domain = typeof DOMAINS[number];

export const QUADRANTS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export type Quadrant = typeof QUADRANTS[number];

export const CONTROL_AXES = ['within', 'influence', 'release'] as const;
export type ControlAxis = typeof CONTROL_AXES[number];

export interface ChecklistReflection {
  intention?: string;        // captured before action ("what's the intended outcome?")
  result?: string;           // captured after action ("what happened?")
  lesson?: string;           // captured after action ("what did I learn?")
  nextAction?: string;       // captured after action ("what's next?")
  emotionBefore?: string;    // autofills from current mindstate
  emotionAfter?: string;
}

export interface ChecklistItem {
  id: string;
  date: string;              // YYYY-MM-DD — the day this item belongs to

  title: string;
  size: Size;                // 1-3-5 layer
  domain: Domain;
  quadrant: Quadrant;        // Eisenhower (kept — discernment lens)
  controlAxis: ControlAxis;  // Stoic lens

  source: 'ai' | 'manual';   // how this item came into existence
  completed: boolean;
  completedAt?: number;
  createdAt: number;

  reflection: ChecklistReflection;

  // Quote attachment — the wisdom-corpus integration
  themes: string[];          // for matching against quotes
  tagHints: string[];
  attachedQuoteId?: string;  // pinned quote at intention time

  // Causality graph
  parentTaskId?: string;     // the item whose `nextAction` spawned this one
  originTaskId?: string;     // the root of the chain (parentTaskId of parentTaskId of ...)
  chainId: string;           // denormalized: always equals originTaskId || id —
                             //  filterable identifier for the whole chain even
                             //  for solo items (their chainId === their id).

  // Cross-link back to the weekly system
  fromWeeklyActionId?: string;  // if this item was promoted from a WeeklyAction
}

// ═══ Date helpers ════════════════════════════════════════════════════

export function dateKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

export function tomorrowKey(d: Date = new Date()): string {
  const t = new Date(d.getTime());
  t.setDate(t.getDate() + 1);
  return dateKey(t);
}

/** Days that fall within the same ISO week as `weekKey`, oldest first. */
export function daysInWeek(weekKey: string): string[] {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return [];
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monW1 = new Date(jan4);
  monW1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const mon = new Date(monW1);
  mon.setUTCDate(monW1.getUTCDate() + (parseInt(m[2]) - 1) * 7);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`);
  }
  return out;
}

// ═══ Persistence ═════════════════════════════════════════════════════

const dayKey = (d: string) => `checklist_${d}`;
const INDEX_KEY = 'checklist_index';

let bridgeRef: EvenAppBridge | null = null;
export function setChecklistBridge(b: EvenAppBridge): void { bridgeRef = b; }

async function readKey(key: string): Promise<string | null> {
  if (!bridgeRef) return null;
  try { return (await bridgeRef.getLocalStorage(key)) || null; } catch { return null; }
}
async function writeKey(key: string, value: string): Promise<void> {
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(key, value); } catch (e) { console.error('[CHECKLIST] write failed', e); }
}

/** Load the items for a single day. Empty array if none. */
export async function loadDay(date: string): Promise<ChecklistItem[]> {
  const raw = await readKey(dayKey(date));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeItem);
  } catch { return []; }
}

/** Persist the items for a single day. Maintains the index. */
export async function saveDay(date: string, items: ChecklistItem[]): Promise<void> {
  await writeKey(dayKey(date), JSON.stringify(items));
  const idxRaw = await readKey(INDEX_KEY);
  let idx: string[] = [];
  try { idx = idxRaw ? JSON.parse(idxRaw) : []; } catch {}
  if (items.length > 0 && !idx.includes(date)) {
    idx.push(date);
    idx.sort();
    await writeKey(INDEX_KEY, JSON.stringify(idx));
  } else if (items.length === 0 && idx.includes(date)) {
    idx = idx.filter(d => d !== date);
    await writeKey(INDEX_KEY, JSON.stringify(idx));
  }
}

export async function listDates(): Promise<string[]> {
  const raw = await readKey(INDEX_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

/** Bulk load — every item across every day. Useful for graph queries. */
export async function loadAll(): Promise<ChecklistItem[]> {
  const dates = await listDates();
  const out: ChecklistItem[] = [];
  for (const d of dates) out.push(...await loadDay(d));
  return out;
}

/** Items for a whole ISO week. */
export async function loadWeek(weekKey: string): Promise<ChecklistItem[]> {
  const out: ChecklistItem[] = [];
  for (const d of daysInWeek(weekKey)) out.push(...await loadDay(d));
  return out;
}

// ═══ Mutations ═══════════════════════════════════════════════════════

export interface AddItemArgs {
  date?: string;             // defaults to today
  title: string;
  size?: Size;
  domain?: Domain;
  quadrant?: Quadrant;
  controlAxis?: ControlAxis;
  source?: 'ai' | 'manual';
  themes?: string[];
  tagHints?: string[];
  attachedQuoteId?: string;
  parentTaskId?: string;
  originTaskId?: string;
  fromWeeklyActionId?: string;
}

export async function addItem(args: AddItemArgs): Promise<ChecklistItem> {
  const date = args.date || dateKey();
  const items = await loadDay(date);
  const id = makeId();
  const originTaskId = args.originTaskId || args.parentTaskId;  // root if parent given
  const item: ChecklistItem = {
    id,
    date,
    title: args.title.trim(),
    size: args.size || 'medium',
    domain: args.domain || 'Other',
    quadrant: args.quadrant || 'Q2',         // default: important, not urgent
    controlAxis: args.controlAxis || 'within',
    source: args.source || 'manual',
    completed: false,
    createdAt: Date.now(),
    reflection: {},
    themes: args.themes || [],
    tagHints: args.tagHints || [],
    attachedQuoteId: args.attachedQuoteId,
    parentTaskId: args.parentTaskId,
    originTaskId,
    chainId: originTaskId || id,             // denormalized chain identifier
    fromWeeklyActionId: args.fromWeeklyActionId,
  };
  items.push(item);
  await saveDay(date, items);
  return item;
}

export async function updateItem(date: string, id: string, patch: Partial<ChecklistItem>): Promise<ChecklistItem | null> {
  const items = await loadDay(date);
  const i = items.findIndex(x => x.id === id);
  if (i < 0) return null;
  items[i] = { ...items[i], ...patch };
  // Deep merge reflection
  if (patch.reflection) {
    items[i].reflection = { ...items[i].reflection, ...patch.reflection };
  }
  await saveDay(date, items);
  return items[i];
}

/** Mark complete, stamp completedAt. Returns the item so callers can
 * prompt for reflection. Idempotent: re-completing has no effect. */
export async function completeItem(date: string, id: string, emotionAfter?: string): Promise<ChecklistItem | null> {
  return updateItem(date, id, {
    completed: true,
    completedAt: Date.now(),
    reflection: emotionAfter ? { emotionAfter } : {},
  });
}

export async function uncompleteItem(date: string, id: string): Promise<ChecklistItem | null> {
  return updateItem(date, id, { completed: false, completedAt: undefined });
}

export async function deleteItem(date: string, id: string): Promise<void> {
  const items = (await loadDay(date)).filter(x => x.id !== id);
  await saveDay(date, items);
}

/** Save reflection fields (intention/result/lesson/nextAction/emotion).
 * Auto-creates tomorrow's draft if `nextAction` is non-empty and no
 * draft exists yet for the chain. */
export async function reflectOnItem(
  date: string, id: string, reflection: ChecklistReflection,
): Promise<{ item: ChecklistItem | null; nextDraft: ChecklistItem | null }> {
  const item = await updateItem(date, id, { reflection });
  if (!item) return { item: null, nextDraft: null };

  let nextDraft: ChecklistItem | null = null;
  if (reflection.nextAction && reflection.nextAction.trim().length > 0) {
    nextDraft = await createNextActionDraft(item, reflection.nextAction.trim());
  }
  return { item, nextDraft };
}

/** Spawn a draft item on tomorrow's list from a completed item's nextAction.
 * Threads the parent + origin so the causality graph stays intact. */
export async function createNextActionDraft(parent: ChecklistItem, title: string): Promise<ChecklistItem> {
  return addItem({
    date: tomorrowKey(),
    title,
    size: parent.size,             // inherit unless user changes it
    domain: parent.domain,
    quadrant: parent.quadrant,
    controlAxis: parent.controlAxis,
    source: 'ai',                  // it was inferred from a reflection
    themes: parent.themes,
    tagHints: parent.tagHints,
    parentTaskId: parent.id,
    originTaskId: parent.originTaskId || parent.id,
  });
}

// ═══ Causality graph queries ═════════════════════════════════════════

/** Walk forward from `id` collecting every descendant via parentTaskId. */
export async function getChainForward(id: string): Promise<ChecklistItem[]> {
  const all = await loadAll();
  const out: ChecklistItem[] = [];
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    const children = all.filter(x => x.parentTaskId === cur);
    out.push(...children);
    queue.push(...children.map(c => c.id));
  }
  return out;
}

/** All items sharing the same originTaskId, oldest first. */
export async function getChainByOrigin(originId: string): Promise<ChecklistItem[]> {
  const all = await loadAll();
  return all
    .filter(x => x.originTaskId === originId || x.id === originId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ═══ Aggregations ════════════════════════════════════════════════════

export interface DayStats {
  date: string;
  total: number;
  completed: number;
  byDomain: Record<Domain, number>;
  byQuadrant: Record<Quadrant, number>;
  byControlAxis: Record<ControlAxis, number>;
  bySize: Record<Size, number>;
  dominantDomain?: Domain;
}

export function summarizeDay(items: ChecklistItem[], date: string): DayStats {
  const byDomain  = Object.fromEntries(DOMAINS.map(d => [d, 0])) as Record<Domain, number>;
  const byQuadrant = Object.fromEntries(QUADRANTS.map(q => [q, 0])) as Record<Quadrant, number>;
  const byControlAxis = Object.fromEntries(CONTROL_AXES.map(c => [c, 0])) as Record<ControlAxis, number>;
  const bySize = Object.fromEntries(SIZES.map(s => [s, 0])) as Record<Size, number>;
  let completed = 0;
  for (const it of items) {
    byDomain[it.domain]++;
    byQuadrant[it.quadrant]++;
    byControlAxis[it.controlAxis]++;
    bySize[it.size]++;
    if (it.completed) completed++;
  }
  let dominantDomain: Domain | undefined;
  let max = 0;
  for (const d of DOMAINS) {
    if (byDomain[d] > max) { max = byDomain[d]; dominantDomain = d; }
  }
  return { date, total: items.length, completed, byDomain, byQuadrant, byControlAxis, bySize, dominantDomain };
}

export interface WeekStats extends Omit<DayStats, 'date'> {
  weekKey: string;
  emotionDelta: { before: Record<string, number>; after: Record<string, number> };
}

export function summarizeWeek(items: ChecklistItem[], weekKey: string): WeekStats {
  const day = summarizeDay(items, weekKey);
  const before: Record<string, number> = {};
  const after: Record<string, number> = {};
  for (const it of items) {
    if (it.reflection.emotionBefore) before[it.reflection.emotionBefore] = (before[it.reflection.emotionBefore] || 0) + 1;
    if (it.reflection.emotionAfter)  after[it.reflection.emotionAfter]   = (after[it.reflection.emotionAfter] || 0) + 1;
  }
  return { ...day, weekKey, emotionDelta: { before, after } };
}

// ═══ Profile feedback hooks ══════════════════════════════════════════
// These are intentionally narrow — they extract structured signals from
// reflections that the dashboard or a server endpoint can later turn
// into UserProfile.guidelines updates. For v1 we just expose the data;
// inference (GPT-side) lives in a follow-up endpoint.

export interface ProfileSignals {
  // Domains where completion rate is high (strengths)
  strongDomains: { domain: Domain; rate: number; n: number }[];
  // Domains where completion rate is low (struggle / weakness)
  weakDomains: { domain: Domain; rate: number; n: number }[];
  // Quadrant distribution — Q1-heavy = firefighting, Q2-heavy = proactive
  quadrantDist: Record<Quadrant, number>;
  // Control-axis distribution — release-heavy = surrendering, within-heavy = agency
  controlDist: Record<ControlAxis, number>;
  // Top recurring lessons (deduped, lightweight clustering)
  recurringLessons: string[];
}

export function deriveProfileSignals(items: ChecklistItem[]): ProfileSignals {
  const perDomain: Record<Domain, { n: number; done: number }> = Object.fromEntries(
    DOMAINS.map(d => [d, { n: 0, done: 0 }])
  ) as any;
  const quadrantDist: Record<Quadrant, number> = Object.fromEntries(QUADRANTS.map(q => [q, 0])) as any;
  const controlDist: Record<ControlAxis, number> = Object.fromEntries(CONTROL_AXES.map(c => [c, 0])) as any;
  const lessonCounts = new Map<string, number>();

  for (const it of items) {
    perDomain[it.domain].n++;
    if (it.completed) perDomain[it.domain].done++;
    quadrantDist[it.quadrant]++;
    controlDist[it.controlAxis]++;
    const lesson = (it.reflection.lesson || '').trim().toLowerCase();
    if (lesson.length > 4) {
      // Light clustering: collapse to first 60 chars to dedupe near-identical
      const key = lesson.slice(0, 60);
      lessonCounts.set(key, (lessonCounts.get(key) || 0) + 1);
    }
  }

  const ratios = DOMAINS.map(d => ({
    domain: d as Domain,
    rate: perDomain[d].n > 0 ? perDomain[d].done / perDomain[d].n : 0,
    n: perDomain[d].n,
  })).filter(r => r.n >= 3);   // need a baseline of 3 items per domain to draw inference

  const strongDomains = [...ratios].sort((a, b) => b.rate - a.rate).slice(0, 3).filter(r => r.rate >= 0.6);
  const weakDomains = [...ratios].sort((a, b) => a.rate - b.rate).slice(0, 3).filter(r => r.rate <= 0.4);

  const recurringLessons = [...lessonCounts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  return { strongDomains, weakDomains, quadrantDist, controlDist, recurringLessons };
}

// ═══ Internals ═══════════════════════════════════════════════════════

function makeId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeItem(p: any): ChecklistItem {
  const size: Size = (SIZES as readonly string[]).includes(p.size) ? p.size : 'medium';
  const domain: Domain = (DOMAINS as readonly string[]).includes(p.domain) ? p.domain : 'Other';
  const quadrant: Quadrant = (QUADRANTS as readonly string[]).includes(p.quadrant) ? p.quadrant : 'Q2';
  const controlAxis: ControlAxis = (CONTROL_AXES as readonly string[]).includes(p.controlAxis) ? p.controlAxis : 'within';
  const id = String(p.id || makeId());
  const parentTaskId = p.parentTaskId ? String(p.parentTaskId) : undefined;
  const originTaskId = p.originTaskId ? String(p.originTaskId) : undefined;
  return {
    id,
    date: String(p.date || dateKey()),
    title: String(p.title || ''),
    size,
    domain,
    quadrant,
    controlAxis,
    source: p.source === 'ai' ? 'ai' : 'manual',
    completed: Boolean(p.completed),
    completedAt: typeof p.completedAt === 'number' ? p.completedAt : undefined,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    reflection: {
      intention: p.reflection?.intention,
      result: p.reflection?.result,
      lesson: p.reflection?.lesson,
      nextAction: p.reflection?.nextAction,
      emotionBefore: p.reflection?.emotionBefore,
      emotionAfter: p.reflection?.emotionAfter,
    },
    themes: Array.isArray(p.themes) ? p.themes.map(String) : [],
    tagHints: Array.isArray(p.tagHints) ? p.tagHints.map(String) : [],
    attachedQuoteId: p.attachedQuoteId ? String(p.attachedQuoteId) : undefined,
    parentTaskId,
    originTaskId,
    chainId: String(p.chainId || originTaskId || id),
    fromWeeklyActionId: p.fromWeeklyActionId ? String(p.fromWeeklyActionId) : undefined,
  };
}

// ═══ Convenience: today's items ══════════════════════════════════════

/** Today's checklist, oldest-first. Big items float to top regardless of
 * createdAt so the cockpit always shows the heavyweights first. */
export async function loadToday(): Promise<ChecklistItem[]> {
  const items = await loadDay(dateKey());
  return items.sort((a, b) => {
    const sizeRank = (s: Size) => s === 'big' ? 0 : s === 'medium' ? 1 : 2;
    const sd = sizeRank(a.size) - sizeRank(b.size);
    if (sd !== 0) return sd;
    return a.createdAt - b.createdAt;
  });
}

export function thisWeekKey(): string { return isoWeekKey(new Date()); }
