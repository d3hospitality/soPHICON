// ═══════════════════════════════════════════════════════════════════
// soΦcon — Weekly Overview module (src/weekly.ts)
//
// Owns:
//   • Type definitions for the weekly action plan (Problem, Action, etc.)
//   • ISO week-key math (matches /api/weekly-overview's keying)
//   • Persistent storage per week, keyed weekly_overview_<YYYY-WW>
//   • Theme-based quote matching against the existing constants.ts corpus
//   • Roll-over: pluck open problems from week N and feed them to N+1
//
// Categories are a fixed enum so the dashboard can render coloured badges
// without branching on free-form GPT strings. The server prompt enforces
// the same enum. If a future model returns something off-list it's bucketed
// to "Other" client-side.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { PHILOSOPHERS, Quote } from './constants';

// ═══ Types ═══════════════════════════════════════════════════════════
export const CATEGORIES = ['Work', 'Love', 'Money', 'Health', 'Mind', 'Spirit', 'Other'] as const;
export type Category = typeof CATEGORIES[number];

export const QUADRANTS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export type Quadrant = typeof QUADRANTS[number];

export const QUADRANT_LABELS: Record<Quadrant, { label: string; sub: string }> = {
  Q1: { label: 'Do First',  sub: 'Urgent + Important' },
  Q2: { label: 'Schedule',  sub: 'Important, not urgent' },
  Q3: { label: 'Delegate',  sub: 'Urgent, not important' },
  Q4: { label: 'Eliminate', sub: 'Not urgent, not important' },
};

export interface WeeklyAction {
  id: string;
  title: string;
  detail: string;
  source: string;            // "Marcus Aurelius (Stoicism)"
  quadrant: Quadrant;
  themes: string[];          // emotions for quote matching
  tagHints: string[];        // topical tags
  done: boolean;
}

export interface WeeklyProblem {
  id: string;
  title: string;
  summary: string;
  category: Category;
  philosophers: string[];
  exchangeCount: number;
  firstSeen: string;          // YYYY-MM-DD
  status: 'open' | 'addressed' | 'rolled-over';
  createdAt: number;
  actions: WeeklyAction[];
}

export interface WeeklyOverview {
  weekKey: string;            // YYYY-WW (ISO week)
  problems: WeeklyProblem[];
  generatedAt: number;
}

// ═══ ISO Week Math ═══════════════════════════════════════════════════
// Matches the Vercel handler exactly so client/server agree on which week
// any given date belongs to, including the Dec/Jan boundary edge cases.
export function isoWeekKey(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((+date - +yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

/** Human-friendly week label: "Apr 27 → May 3" */
export function weekRangeLabel(weekKey: string): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return weekKey;
  const [_, y, w] = m;
  // ISO week 1 contains Jan 4. Find Monday of that week, then offset.
  const jan4 = new Date(Date.UTC(+y, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monW1 = new Date(jan4);
  monW1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const mon = new Date(monW1);
  mon.setUTCDate(monW1.getUTCDate() + (parseInt(w) - 1) * 7);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = (d: Date) =>
    d.toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${fmt(mon)} → ${fmt(sun)}`;
}

/** Shift an ISO week-key by N weeks (positive = forward, negative = back). */
export function shiftWeek(weekKey: string, deltaWeeks: number): string {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!m) return weekKey;
  const jan4 = new Date(Date.UTC(+m[1], 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monW1 = new Date(jan4);
  monW1.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(monW1);
  target.setUTCDate(monW1.getUTCDate() + (parseInt(m[2]) - 1 + deltaWeeks) * 7);
  return isoWeekKey(target);
}

// ═══ Persistence ═════════════════════════════════════════════════════
const overviewKey = (weekKey: string) => `weekly_overview_${weekKey}`;
const INDEX_KEY = 'weekly_overview_index';   // list of weekKeys we've ever stored

let bridgeRef: EvenAppBridge | null = null;
export function setWeeklyBridge(b: EvenAppBridge): void { bridgeRef = b; }

async function readKey(key: string): Promise<string | null> {
  if (!bridgeRef) return null;
  try { return (await bridgeRef.getLocalStorage(key)) || null; } catch { return null; }
}
async function writeKey(key: string, value: string): Promise<void> {
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(key, value); } catch (e) { console.error('[WEEKLY] write failed', e); }
}

export async function loadOverview(weekKey: string): Promise<WeeklyOverview | null> {
  const raw = await readKey(overviewKey(weekKey));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.problems)) return parsed;
    return null;
  } catch { return null; }
}

export async function saveOverview(ov: WeeklyOverview): Promise<void> {
  await writeKey(overviewKey(ov.weekKey), JSON.stringify(ov));
  // Maintain a small index of stored weeks so the UI can offer prev/next
  const idxRaw = await readKey(INDEX_KEY);
  let idx: string[] = [];
  try { idx = idxRaw ? JSON.parse(idxRaw) : []; } catch {}
  if (!idx.includes(ov.weekKey)) {
    idx.push(ov.weekKey);
    idx.sort();
    await writeKey(INDEX_KEY, JSON.stringify(idx));
  }
}

export async function listStoredWeeks(): Promise<string[]> {
  const raw = await readKey(INDEX_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) || []; } catch { return []; }
}

// ═══ Mutations ═══════════════════════════════════════════════════════
export async function setActionDone(weekKey: string, problemId: string, actionId: string, done: boolean): Promise<void> {
  const ov = await loadOverview(weekKey);
  if (!ov) return;
  const p = ov.problems.find(p => p.id === problemId);
  if (!p) return;
  const a = p.actions.find(a => a.id === actionId);
  if (!a) return;
  a.done = done;
  // If every action is done, auto-mark problem addressed
  if (p.actions.every(x => x.done)) p.status = 'addressed';
  else if (p.status === 'addressed') p.status = 'open';
  await saveOverview(ov);
}

export async function setProblemStatus(weekKey: string, problemId: string, status: WeeklyProblem['status']): Promise<void> {
  const ov = await loadOverview(weekKey);
  if (!ov) return;
  const p = ov.problems.find(p => p.id === problemId);
  if (!p) return;
  p.status = status;
  await saveOverview(ov);
}

/** Pluck open + rolled-over problems from a week so they can be passed
 * to the server as `rolledOver` when generating the next week. */
export async function pickRolloverCandidates(weekKey: string): Promise<WeeklyProblem[]> {
  const ov = await loadOverview(weekKey);
  if (!ov) return [];
  return ov.problems.filter(p => p.status !== 'addressed');
}

// ═══ Server Call ═════════════════════════════════════════════════════
const API_URL = 'https://sophicon-api.vercel.app/api/weekly-overview';

export async function generateOverview(args: {
  weekKey: string;
  journal: any[];
  rolledOver?: WeeklyProblem[];
}): Promise<WeeklyOverview> {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`weekly-overview ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const ov: WeeklyOverview = {
    weekKey: data.weekKey || args.weekKey,
    problems: (data.problems || []).map((p: any) => normalizeProblem(p)),
    generatedAt: Date.now(),
  };
  await saveOverview(ov);
  return ov;
}

function normalizeProblem(p: any): WeeklyProblem {
  const cat: Category = (CATEGORIES as readonly string[]).includes(p.category) ? p.category : 'Other';
  return {
    id: String(p.id || slug(p.title || 'untitled')),
    title: String(p.title || 'Untitled'),
    summary: String(p.summary || ''),
    category: cat,
    philosophers: Array.isArray(p.philosophers) ? p.philosophers : [],
    exchangeCount: Number(p.exchangeCount) || 0,
    firstSeen: String(p.firstSeen || ''),
    status: (p.status === 'addressed' || p.status === 'rolled-over') ? p.status : 'open',
    createdAt: Number(p.createdAt) || Date.now(),
    actions: Array.isArray(p.actions) ? p.actions.map(normalizeAction) : [],
  };
}
function normalizeAction(a: any): WeeklyAction {
  const q: Quadrant = (QUADRANTS as readonly string[]).includes(a.quadrant) ? a.quadrant : 'Q2';
  return {
    id: String(a.id || slug(a.title || 'action')),
    title: String(a.title || 'Untitled'),
    detail: String(a.detail || ''),
    source: String(a.source || ''),
    quadrant: q,
    themes: Array.isArray(a.themes) ? a.themes.map(String) : [],
    tagHints: Array.isArray(a.tagHints) ? a.tagHints.map(String) : [],
    done: Boolean(a.done),
  };
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

// ═══ Quote Matching ══════════════════════════════════════════════════
// Builds a flat index of all quotes once, then ranks them per action by
// theme overlap (emotion match) + tagHints overlap. Fast: ~2,801 quotes
// scanned in linear time, no GPT call needed for shuffles.
interface FlatQuote { q: Quote; phil: string; tradition: string; }
let flatIndex: FlatQuote[] | null = null;
function ensureFlatIndex(): FlatQuote[] {
  if (flatIndex) return flatIndex;
  const out: FlatQuote[] = [];
  for (const phil of PHILOSOPHERS) {
    for (const q of phil.quotes) out.push({ q, phil: phil.name, tradition: phil.tradition });
  }
  flatIndex = out;
  return out;
}

/** Find up to N quotes that match an action's themes + tagHints.
 * Falls back gracefully: emotion match → tag match → high-rated random. */
export function pickQuotesForAction(action: WeeklyAction, n: number = 3): FlatQuote[] {
  const idx = ensureFlatIndex();
  const themes = new Set(action.themes.map(t => t.toLowerCase()));
  const hints = new Set(action.tagHints.map(t => t.toLowerCase()));

  const scored: { item: FlatQuote; score: number }[] = idx.map(item => {
    let score = 0;
    if (themes.has(item.q.emotion?.toLowerCase())) score += 10;
    if (item.q.blend && themes.has(item.q.blend.toLowerCase())) score += 4;
    for (const tag of (item.q.tags || [])) {
      if (hints.has(tag.toLowerCase())) score += 3;
    }
    score += (item.q.rating || 0) * 0.05;  // tiny tiebreaker by rating
    return { item, score };
  });
  scored.sort((a, b) => b.score - a.score);
  // Take top 3*n by score then randomize among those for variety on shuffle
  const pool = scored.slice(0, Math.max(n * 3, 9)).filter(x => x.score > 0);
  const final = pool.length > 0 ? pool : scored.slice(0, Math.max(n * 3, 9));
  // Fisher-Yates shuffle
  for (let i = final.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [final[i], final[j]] = [final[j], final[i]];
  }
  return final.slice(0, n).map(x => x.item);
}

// ═══ Category Color Map ═════════════════════════════════════════════
export const CATEGORY_HUE: Record<Category, string> = {
  Work:   '#5b8def',  // blue
  Love:   '#e7659f',  // rose
  Money:  '#67c181',  // green
  Health: '#f0a04b',  // amber
  Mind:   '#9b6dd7',  // violet
  Spirit: '#d6c45a',  // gold
  Other:  '#888',
};
