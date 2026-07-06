// ═══════════════════════════════════════════════════════════════════
// soΦcon — Habits module (src/habits.ts)
//
// "Solo Leveling" layer on top of the weekly action plan: long-press
// any action in the Eisenhower modal to promote it to a HABIT — a
// recurring daily commitment that the originating philosopher checks
// in on each morning.
//
// Each habit owns:
//   • A frozen quote (locked at favorite time) — no more shuffling,
//     this is the line the user is committing to sit with.
//   • A streak counter that increments on each "did it yesterday: yes"
//     and breaks on "no" or a missed day past a 36h grace window.
//   • A history log of date → status, so the calendar (or future
//     surfaces) can render "what did I keep this week".
//
// Persistence: bridge.localStorage key 'habits' (single JSON array).
// All public functions are async and survive a missing bridge ref.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { PHILOSOPHERS } from './constants';

const HABITS_KEY = 'habits';

// ═══ Types ═══════════════════════════════════════════════════════════

export type HabitStatus = 'done' | 'missed' | 'skipped';

export interface HabitCheckIn {
  date: string;            // YYYY-MM-DD (the day BEING reviewed, not when answered)
  status: HabitStatus;
  ts: number;              // when the user actually answered
}

export interface Habit {
  id: string;
  title: string;
  detail: string;
  source: string;          // "Marcus Aurelius (Stoicism)"
  philName: string;        // "Marcus Aurelius"
  philId: string | null;   // "marcus_aurelius" — used for sprite path; null if name didn't resolve
  tradition: string;       // "Stoicism"
  themes: string[];
  tagHints: string[];

  // Frozen-at-favorite quote
  quote: {
    text: string;
    source: string;        // book title from the quote object
    philName: string;      // philosopher who said it
  } | null;

  // Lifecycle
  createdAt: number;
  active: boolean;         // false = retired but kept for streak history

  // Streak machinery
  streak: number;              // current consecutive days
  bestStreak: number;
  lastDoneDate: string | null; // YYYY-MM-DD of last 'done'
  lastCheckInDate: string | null; // YYYY-MM-DD covered by the last check-in (whatever the answer)
  history: HabitCheckIn[];     // chronological
}

// ═══ Bridge wiring ═══════════════════════════════════════════════════
let bridgeRef: EvenAppBridge | null = null;
export function setHabitsBridge(b: EvenAppBridge): void { bridgeRef = b; }

async function read(): Promise<Habit[]> {
  if (!bridgeRef) return [];
  try {
    const raw = await bridgeRef.getLocalStorage(HABITS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
async function write(items: Habit[]): Promise<void> {
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(HABITS_KEY, JSON.stringify(items)); }
  catch (e) { console.error('[HABITS] save failed', e); }
}

// ═══ Date helpers (local time — habits are about a person's day, not UTC) ═
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
export function yesterdayKey(d: Date = new Date()): string {
  const y = new Date(d);
  y.setDate(d.getDate() - 1);
  return todayKey(y);
}
function daysBetween(aKey: string, bKey: string): number {
  const a = new Date(aKey + 'T00:00:00');
  const b = new Date(bKey + 'T00:00:00');
  return Math.round((+b - +a) / 86400000);
}

// ═══ Resolve philosopher name → philId ═══════════════════════════════
function philIdFromName(name: string): string | null {
  if (!name) return null;
  const norm = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  for (const p of PHILOSOPHERS) {
    const pname = p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (pname === norm) return p.philId;
    if (norm.includes(pname) || pname.includes(norm)) return p.philId;
  }
  return null;
}

// ═══ Public API ══════════════════════════════════════════════════════
export async function listHabits(): Promise<Habit[]> {
  const all = await read();
  return all.filter(h => h.active !== false);
}
export async function listAllHabits(): Promise<Habit[]> { return read(); }

/** Replace the entire habits array. Used by the device-sync merge
 * (enkiSync.ts) — never call from UI code. */
export async function replaceAllHabits(all: Habit[]): Promise<void> { await write(all); }

export async function getHabit(id: string): Promise<Habit | null> {
  const all = await read();
  return all.find(h => h.id === id) || null;
}

/** Promote a weekly-action to a habit. Idempotent — calling twice with
 * the same actionId returns the existing habit unchanged. */
export async function favoriteAsHabit(args: {
  actionId: string;
  title: string;
  detail: string;
  source: string;
  themes: string[];
  tagHints: string[];
  quote: Habit['quote'];
}): Promise<Habit> {
  const all = await read();
  const existing = all.find(h => h.id === args.actionId);
  if (existing) {
    existing.active = true;
    if (!existing.quote && args.quote) existing.quote = args.quote;
    await write(all);
    return existing;
  }
  // Parse "Marcus Aurelius (Stoicism)" → name + tradition
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(args.source);
  const philName = m ? m[1].trim() : args.source.trim();
  const tradition = m ? m[2].trim() : '';
  const habit: Habit = {
    id: args.actionId,
    title: args.title,
    detail: args.detail,
    source: args.source,
    philName,
    philId: philIdFromName(philName),
    tradition,
    themes: args.themes,
    tagHints: args.tagHints,
    quote: args.quote,
    createdAt: Date.now(),
    active: true,
    streak: 0,
    bestStreak: 0,
    lastDoneDate: null,
    lastCheckInDate: null,
    history: [],
  };
  all.push(habit);
  await write(all);
  return habit;
}

/** Demote a habit back to plain action (preserves history but flags inactive). */
export async function unfavoriteHabit(id: string): Promise<void> {
  const all = await read();
  const h = all.find(h => h.id === id);
  if (!h) return;
  h.active = false;
  await write(all);
}

export async function isHabit(id: string): Promise<boolean> {
  const h = await getHabit(id);
  return !!(h && h.active);
}

// ═══ Daily Check-In ══════════════════════════════════════════════════
//
// Each morning the dashboard surfaces a check-in modal: for every active
// habit whose lastCheckInDate is older than yesterday, ask the user
// "Yesterday, did you [habit title]?" — answer feeds streak math.
//
// The grace window: if a habit was created today, it's not eligible for
// check-in until tomorrow (we won't ask about a day that didn't exist
// when they made the commitment). Habits skipped get a stat row but
// don't break the streak.

export interface PendingCheckIn {
  habit: Habit;
  forDate: string;   // YYYY-MM-DD — the day being reviewed
}

export async function pendingCheckIns(now: Date = new Date()): Promise<PendingCheckIn[]> {
  const all = await read();
  const today = todayKey(now);
  const yesterday = yesterdayKey(now);
  const out: PendingCheckIn[] = [];
  for (const h of all) {
    if (!h.active) continue;
    // Brand-new habit (created today) — don't ask about yesterday
    const created = todayKey(new Date(h.createdAt));
    if (created === today) continue;
    // Already checked in for yesterday (or for today, somehow)
    if (h.lastCheckInDate === yesterday || h.lastCheckInDate === today) continue;
    out.push({ habit: h, forDate: yesterday });
  }
  return out;
}

export async function recordCheckIn(habitId: string, status: HabitStatus, forDate: string, now: Date = new Date()): Promise<void> {
  const all = await read();
  const h = all.find(h => h.id === habitId);
  if (!h) return;

  // Append history (idempotent for same date)
  const idx = h.history.findIndex(c => c.date === forDate);
  const checkIn: HabitCheckIn = { date: forDate, status, ts: now.getTime() };
  if (idx >= 0) h.history[idx] = checkIn;
  else h.history.push(checkIn);
  h.history.sort((a, b) => a.date.localeCompare(b.date));

  h.lastCheckInDate = forDate;

  // Streak math
  if (status === 'done') {
    // If we'd previously done it on yesterday-of-forDate, extend; else reset to 1
    const prevDay = (() => {
      const d = new Date(forDate + 'T00:00:00');
      d.setDate(d.getDate() - 1);
      return todayKey(d);
    })();
    if (h.lastDoneDate === prevDay) {
      h.streak += 1;
    } else {
      h.streak = 1;
    }
    h.lastDoneDate = forDate;
    if (h.streak > h.bestStreak) h.bestStreak = h.streak;
  } else if (status === 'missed') {
    h.streak = 0;
  }
  // 'skipped' leaves streak alone (you intentionally took the day off)

  await write(all);
}

// ═══ Streak Health UI hint ═══════════════════════════════════════════
// Returns a label + color hint for the dashboard to render the
// philosopher's check-in face based on follow-through.
export function streakHealth(h: Habit): { label: string; tone: 'good' | 'warn' | 'cold' | 'fresh' } {
  if (h.streak === 0 && h.history.length === 0) return { label: 'fresh start', tone: 'fresh' };
  if (h.streak >= 7) return { label: `${h.streak} day streak`, tone: 'good' };
  if (h.streak >= 1) return { label: `${h.streak} day streak`, tone: 'good' };
  // streak == 0 with history → recently broke
  return { label: 'broken streak', tone: 'cold' };
}

// ═══ Sprite path resolver for dashboard (uses public/sprites/) ═══════
export function habitSpritePath(h: Habit, emotion: string = 'compassion'): string | null {
  if (!h.philId) return null;
  return `${h.philId}/${h.philId}-${emotion}.png`;
}
