// ═══════════════════════════════════════════════════════════════════
// enkiRIDION — companion sync spine (src/enkiSync.ts)
//
// Mirrors the Android app's device_sync rows (Supabase, via the
// sophicon-api gateway) into the companion's local stores — checklist
// (Today 1-3-5), habits, weekly overview — and pushes local mutations
// back as FULL Android-shaped payloads (kotlinx enum-NAME casing,
// embedded sync{} block). Wire contract source of truth:
// enkispeaks-web/lib/deviceSync.js + docs/TRANSLATION-SYSTEM.md.
//
// Rules:
//   • Unlinked = pure local. Every function no-ops without a token.
//     Offline/seeker experience is never gated on sync.
//   • LWW: server row updated_at vs the local dirty-mark timestamp.
//     A local edit newer than the pulled row wins (and pushes next).
//   • The GLASS never fetches. This module (phone webview) writes the
//     `glance_today` bridge.localStorage key; pages.ts reads it.
//   • Local stores keep their existing lowercase-enum shapes (the type
//     unions are load-bearing across dashboard/pages) — this module is
//     the single explicit map-in/map-out codec at the wire boundary.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { authHeaders, linkedHandle, handleUnauthorized } from './enkiAccount';
import {
  ChecklistItem, Size, Domain, Quadrant as ChecklistQuadrant, ControlAxis,
  SIZES, DOMAINS, QUADRANTS as CHECKLIST_QUADRANTS, CONTROL_AXES,
  loadDay, saveDay, loadAll, loadToday, dateKey,
} from './checklist';
import {
  Habit, HabitStatus, listAllHabits, replaceAllHabits, listHabits,
} from './habits';
import {
  WeeklyOverview, WeeklyProblem, WeeklyAction, CATEGORIES, Category,
  QUADRANTS as WEEKLY_QUADRANTS, Quadrant as WeeklyQuadrant,
  loadOverview, saveOverview,
} from './weekly';
import { log } from './ui';

const SYNC_API_URL = 'https://sophicon-api.vercel.app/api/device-sync';

export type EntityType = 'habit' | 'checklist_item' | 'weekly_overview';
const ENTITY_TYPES: EntityType[] = ['habit', 'checklist_item', 'weekly_overview'];

// ═══ Bridge-backed storage keys ══════════════════════════════════════
const sinceKey = (t: EntityType) => `enki_sync_since_${t}`;
const DIRTY_KEY = 'enki_sync_dirty';       // { "<type>:<id>": {ms, deleted?, tombstone?} }
const META_KEY = 'enki_sync_meta';         // { "<type>:<id>": {firstSeenDate?, userId?, serverId?} }
const LAST_PULL_KEY = 'enki_sync_last_pull';
const GLANCE_KEY = 'glance_today';

interface DirtyEntry { ms: number; deleted?: boolean; tombstone?: any }
interface MetaEntry { firstSeenDate?: string | null; userId?: string; serverId?: string | null }

let bridgeRef: EvenAppBridge | null = null;
export function setSyncBridge(b: EvenAppBridge): void { bridgeRef = b; }

async function readKey(key: string): Promise<string | null> {
  if (!bridgeRef) return null;
  try { return (await bridgeRef.getLocalStorage(key)) || null; } catch { return null; }
}
async function writeKey(key: string, value: string): Promise<void> {
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(key, value); } catch (e) { console.error('[SYNC] write failed', key, e); }
}
async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await readKey(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

// ═══ Enum codecs — local lowercase ⇄ kotlinx enum NAME ═══════════════
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function sizeOut(s: Size): string { return cap1(s); }                    // big → Big
function sizeIn(s: any): Size {
  const v = String(s || '').toLowerCase();
  return (SIZES as readonly string[]).includes(v) ? v as Size : 'medium';
}
function domainIn(s: any): Domain {
  return (DOMAINS as readonly string[]).includes(String(s)) ? s as Domain : 'Other';
}
function quadIn(s: any): ChecklistQuadrant {
  return (CHECKLIST_QUADRANTS as readonly string[]).includes(String(s)) ? s as ChecklistQuadrant : 'Q2';
}
function controlOut(c: ControlAxis): string { return cap1(c); }          // within → Within
function controlIn(s: any): ControlAxis {
  const v = String(s || '').toLowerCase();
  return (CONTROL_AXES as readonly string[]).includes(v) ? v as ControlAxis : 'within';
}
function sourceOut(s: 'ai' | 'manual'): string { return s === 'ai' ? 'Ai' : 'Manual'; }
function sourceIn(s: any): 'ai' | 'manual' { return String(s).toLowerCase() === 'ai' ? 'ai' : 'manual'; }
function habitStatusOut(s: HabitStatus): string { return cap1(s); }      // done → Done
function habitStatusIn(s: any): HabitStatus {
  const v = String(s || '').toLowerCase();
  return v === 'missed' ? 'missed' : v === 'skipped' ? 'skipped' : 'done';
}
function problemStatusOut(s: WeeklyProblem['status']): string {
  return s === 'rolled-over' ? 'RolledOver' : cap1(s);                   // open → Open
}
function problemStatusIn(s: any): WeeklyProblem['status'] {
  const v = String(s || '').toLowerCase();
  return v === 'addressed' ? 'addressed' : v === 'rolledover' || v === 'rolled-over' ? 'rolled-over' : 'open';
}

/** Android-shaped embedded sync{} block. dirty=false: a pushed row IS
 * server state (mirrors web touchSync + Android absorbed()). */
function syncBlock(meta: MetaEntry | undefined, deletedAt: number | null): any {
  return {
    serverId: meta?.serverId ?? null,
    dirty: false,
    deletedAt,
    updatedAt: Date.now(),
    userId: meta?.userId ?? '',
  };
}

// ═══ ChecklistItem codec ═════════════════════════════════════════════
function checklistOut(it: ChecklistItem, meta: MetaEntry | undefined): any {
  return {
    id: it.id,
    date: it.date,
    title: it.title,
    size: sizeOut(it.size),
    domain: it.domain,                       // Domain NAMEs match locally
    quadrant: it.quadrant,                   // Q1..Q4 match
    controlAxis: controlOut(it.controlAxis),
    source: sourceOut(it.source),
    completed: it.completed,
    completedAt: it.completedAt ?? null,
    createdAt: it.createdAt,
    reflection: {
      intention: it.reflection.intention ?? null,
      result: it.reflection.result ?? null,
      lesson: it.reflection.lesson ?? null,
      nextAction: it.reflection.nextAction ?? null,
      emotionBefore: it.reflection.emotionBefore ?? null,
      emotionAfter: it.reflection.emotionAfter ?? null,
    },
    themes: it.themes,
    tagHints: it.tagHints,
    attachedQuoteId: it.attachedQuoteId ?? null,
    parentTaskId: it.parentTaskId ?? null,
    originTaskId: it.originTaskId ?? null,
    chainId: it.chainId,
    fromWeeklyActionId: it.fromWeeklyActionId ?? null,
    firstSeenDate: meta?.firstSeenDate ?? it.date,
    sync: syncBlock(meta, null),
  };
}

function checklistIn(p: any): ChecklistItem {
  const undef = (v: any) => (v === null || v === undefined ? undefined : String(v));
  const id = String(p.id || '');
  const originTaskId = undef(p.originTaskId);
  return {
    id,
    date: String(p.date || dateKey()),
    title: String(p.title || ''),
    size: sizeIn(p.size),
    domain: domainIn(p.domain),
    quadrant: quadIn(p.quadrant),
    controlAxis: controlIn(p.controlAxis),
    source: sourceIn(p.source),
    completed: Boolean(p.completed),
    completedAt: typeof p.completedAt === 'number' ? p.completedAt : undefined,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    reflection: {
      intention: undef(p.reflection?.intention),
      result: undef(p.reflection?.result),
      lesson: undef(p.reflection?.lesson),
      nextAction: undef(p.reflection?.nextAction),
      emotionBefore: undef(p.reflection?.emotionBefore),
      emotionAfter: undef(p.reflection?.emotionAfter),
    },
    themes: Array.isArray(p.themes) ? p.themes.map(String) : [],
    tagHints: Array.isArray(p.tagHints) ? p.tagHints.map(String) : [],
    attachedQuoteId: undef(p.attachedQuoteId),
    parentTaskId: undef(p.parentTaskId),
    originTaskId,
    chainId: String(p.chainId || originTaskId || id),
    fromWeeklyActionId: undef(p.fromWeeklyActionId),
  };
}

// ═══ Habit codec ═════════════════════════════════════════════════════
function habitOut(h: Habit, meta: MetaEntry | undefined): any {
  return {
    id: h.id,
    title: h.title,
    detail: h.detail,
    source: h.source,
    philName: h.philName,
    philId: h.philId,
    tradition: h.tradition,
    themes: h.themes,
    tagHints: h.tagHints,
    quote: h.quote ? { text: h.quote.text, source: h.quote.source, philName: h.quote.philName } : null,
    createdAt: h.createdAt,
    active: h.active,
    streak: h.streak,
    bestStreak: h.bestStreak,
    lastDoneDate: h.lastDoneDate,
    lastCheckInDate: h.lastCheckInDate,
    history: h.history.map(c => ({ date: c.date, status: habitStatusOut(c.status), ts: c.ts })),
    sync: syncBlock(meta, null),
  };
}

function habitIn(p: any): Habit {
  return {
    id: String(p.id || ''),
    title: String(p.title || ''),
    detail: String(p.detail || ''),
    source: String(p.source || ''),
    philName: String(p.philName || ''),
    philId: p.philId ? String(p.philId) : null,
    tradition: String(p.tradition || ''),
    themes: Array.isArray(p.themes) ? p.themes.map(String) : [],
    tagHints: Array.isArray(p.tagHints) ? p.tagHints.map(String) : [],
    quote: p.quote
      ? { text: String(p.quote.text || ''), source: String(p.quote.source || ''), philName: String(p.quote.philName || '') }
      : null,
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    active: p.active !== false,
    streak: Number(p.streak) || 0,
    bestStreak: Number(p.bestStreak) || 0,
    lastDoneDate: p.lastDoneDate ? String(p.lastDoneDate) : null,
    lastCheckInDate: p.lastCheckInDate ? String(p.lastCheckInDate) : null,
    history: Array.isArray(p.history)
      ? p.history.map((c: any) => ({ date: String(c.date || ''), status: habitStatusIn(c.status), ts: Number(c.ts) || 0 }))
      : [],
  };
}

// ═══ WeeklyOverview codec ════════════════════════════════════════════
function weeklyOut(ov: WeeklyOverview, meta: MetaEntry | undefined): any {
  return {
    weekKey: ov.weekKey,
    generatedAt: ov.generatedAt,
    problems: ov.problems.map(p => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      category: p.category,                  // Domain NAMEs match locally
      philosophers: p.philosophers,
      exchangeCount: p.exchangeCount,
      firstSeen: p.firstSeen,
      status: problemStatusOut(p.status),
      createdAt: p.createdAt,
      actions: p.actions.map(a => ({
        id: a.id, title: a.title, detail: a.detail, source: a.source,
        quadrant: a.quadrant, themes: a.themes, tagHints: a.tagHints, done: a.done,
      })),
    })),
    sync: syncBlock(meta, null),
  };
}

function weeklyIn(p: any): WeeklyOverview {
  const catIn = (s: any): Category =>
    (CATEGORIES as readonly string[]).includes(String(s)) ? s as Category : 'Other';
  const qIn = (s: any): WeeklyQuadrant =>
    (WEEKLY_QUADRANTS as readonly string[]).includes(String(s)) ? s as WeeklyQuadrant : 'Q2';
  return {
    weekKey: String(p.weekKey || ''),
    generatedAt: typeof p.generatedAt === 'number' ? p.generatedAt : Date.now(),
    problems: Array.isArray(p.problems) ? p.problems.map((pr: any): WeeklyProblem => ({
      id: String(pr.id || ''),
      title: String(pr.title || ''),
      summary: String(pr.summary || ''),
      category: catIn(pr.category),
      philosophers: Array.isArray(pr.philosophers) ? pr.philosophers.map(String) : [],
      exchangeCount: Number(pr.exchangeCount) || 0,
      firstSeen: String(pr.firstSeen || ''),
      status: problemStatusIn(pr.status),
      createdAt: Number(pr.createdAt) || Date.now(),
      actions: Array.isArray(pr.actions) ? pr.actions.map((a: any): WeeklyAction => ({
        id: String(a.id || ''),
        title: String(a.title || ''),
        detail: String(a.detail || ''),
        source: String(a.source || ''),
        quadrant: qIn(a.quadrant),
        themes: Array.isArray(a.themes) ? a.themes.map(String) : [],
        tagHints: Array.isArray(a.tagHints) ? a.tagHints.map(String) : [],
        done: Boolean(a.done),
      })) : [],
    })) : [],
  };
}

// ═══ Dirty tracking ══════════════════════════════════════════════════
const dkey = (t: EntityType, id: string) => `${t}:${id}`;

/** Flag a local mutation so the next push carries it. */
export async function markDirty(type: EntityType, id: string): Promise<void> {
  const dirty = await readJson<Record<string, DirtyEntry>>(DIRTY_KEY, {});
  dirty[dkey(type, id)] = { ms: Date.now() };
  await writeKey(DIRTY_KEY, JSON.stringify(dirty));
}

/** Capture a checklist delete BEFORE the local row is removed, so the
 * push can send a full tombstone payload the Android decoder accepts. */
export async function captureChecklistDelete(date: string, id: string): Promise<void> {
  const items = await loadDay(date);
  const item = items.find(x => x.id === id);
  const meta = await readJson<Record<string, MetaEntry>>(META_KEY, {});
  const now = Date.now();
  let tombstone: any = null;
  if (item) {
    tombstone = checklistOut(item, meta[dkey('checklist_item', id)]);
    tombstone.sync = { ...tombstone.sync, deletedAt: now, updatedAt: now };
  }
  const dirty = await readJson<Record<string, DirtyEntry>>(DIRTY_KEY, {});
  dirty[dkey('checklist_item', id)] = { ms: now, deleted: true, tombstone };
  await writeKey(DIRTY_KEY, JSON.stringify(dirty));
}

// ═══ Pull ════════════════════════════════════════════════════════════
export interface SyncStatus {
  linkedHandle: string | null;
  lastPullMs: number | null;
  dirtyCount: number;
  lastError: string | null;
  syncing: boolean;
}

let syncing = false;
let lastError: string | null = null;
let appliedListeners: (() => void)[] = [];

/** Register a callback fired after a pull merges remote rows into the
 * local stores — the dashboard re-renders its cards from here. */
export function onSyncApplied(cb: () => void): void { appliedListeners.push(cb); }
function fireApplied(): void { for (const cb of appliedListeners) { try { cb(); } catch {} } }

export async function getSyncStatus(): Promise<SyncStatus> {
  const dirty = await readJson<Record<string, DirtyEntry>>(DIRTY_KEY, {});
  const lastPullRaw = await readKey(LAST_PULL_KEY);
  return {
    linkedHandle: await linkedHandle(),
    lastPullMs: lastPullRaw ? Number(lastPullRaw) || null : null,
    dirtyCount: Object.keys(dirty).length,
    lastError,
    syncing,
  };
}

function rowMs(v: any): number {
  if (typeof v === 'number') return v;
  const parsed = Date.parse(String(v || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

async function pull(): Promise<boolean> {
  const sinces: Record<EntityType, number> = {} as any;
  for (const t of ENTITY_TYPES) {
    sinces[t] = Number(await readKey(sinceKey(t))) || 0;
  }
  const since = Math.min(...ENTITY_TYPES.map(t => sinces[t]));
  const url = `${SYNC_API_URL}?since=${since}&types=${ENTITY_TYPES.join(',')}`;
  const resp = await fetch(url, { headers: { ...(await authHeaders()) } });
  if (resp.status === 401) { await handleUnauthorized(); throw new Error('sync 401 — unlinked'); }
  if (!resp.ok) throw new Error(`device-sync GET ${resp.status}`);
  const data = await resp.json();
  const rows: any[] = Array.isArray(data.rows) ? data.rows : [];
  const serverNow = rowMs(data.now) || Date.now();

  const dirty = await readJson<Record<string, DirtyEntry>>(DIRTY_KEY, {});
  const meta = await readJson<Record<string, MetaEntry>>(META_KEY, {});
  let applied = 0;

  // Group checklist rows by date so each day is one read-modify-write.
  const checklistByDate = new Map<string, { item: ChecklistItem | null; id: string }[]>();
  let habitsAll: Habit[] | null = null;

  for (const r of rows) {
    const type = String(r.entity_type) as EntityType;
    if (!ENTITY_TYPES.includes(type)) continue;
    const id = String(r.entity_id || '');
    const updated = rowMs(r.updated_at);
    if (updated <= sinces[type]) continue;               // already absorbed
    const key = dkey(type, id);
    const localDirty = dirty[key];
    if (localDirty && localDirty.ms >= updated) continue; // local edit wins (LWW)

    const deleted = Boolean(r.deleted_at) || Boolean(r.payload?.sync?.deletedAt);
    // Stash Android-side fields we don't model locally so round-trips
    // don't destroy them (firstSeenDate, sync.userId, sync.serverId).
    meta[key] = {
      firstSeenDate: r.payload?.firstSeenDate ?? null,
      userId: r.payload?.sync?.userId || '',
      serverId: r.payload?.sync?.serverId ?? null,
    };
    if (localDirty) delete dirty[key];                    // server won

    if (type === 'checklist_item') {
      const item = deleted ? null : checklistIn(r.payload || {});
      const date = item ? item.date : String(r.payload?.date || '');
      if (!date) continue;
      if (!checklistByDate.has(date)) checklistByDate.set(date, []);
      checklistByDate.get(date)!.push({ item, id });
      applied++;
    } else if (type === 'habit') {
      if (habitsAll === null) habitsAll = await listAllHabits();
      const idx = habitsAll.findIndex(h => h.id === id);
      if (deleted) {
        if (idx >= 0) habitsAll.splice(idx, 1);
      } else {
        const h = habitIn(r.payload || {});
        if (idx >= 0) habitsAll[idx] = h; else habitsAll.push(h);
      }
      applied++;
    } else if (type === 'weekly_overview') {
      if (deleted) continue;  // weekly tombstones: keep local copy (no local delete path)
      const ov = weeklyIn(r.payload || {});
      if (ov.weekKey) { await saveOverview(ov); applied++; }
    }
  }

  for (const [date, changes] of checklistByDate) {
    const items = await loadDay(date);
    for (const c of changes) {
      const i = items.findIndex(x => x.id === c.id);
      if (c.item === null) { if (i >= 0) items.splice(i, 1); }
      else if (i >= 0) items[i] = c.item;
      else items.push(c.item);
    }
    await saveDay(date, items);
  }
  if (habitsAll !== null) await replaceAllHabits(habitsAll);

  await writeKey(META_KEY, JSON.stringify(meta));
  await writeKey(DIRTY_KEY, JSON.stringify(dirty));
  for (const t of ENTITY_TYPES) await writeKey(sinceKey(t), String(serverNow));
  await writeKey(LAST_PULL_KEY, String(Date.now()));
  if (applied > 0) log(`[SYNC] pulled ${applied} change${applied === 1 ? '' : 's'}`, 'success');
  return applied > 0;
}

// ═══ Push ════════════════════════════════════════════════════════════
async function buildUpsert(type: EntityType, id: string, entry: DirtyEntry, meta: Record<string, MetaEntry>): Promise<any | null> {
  const m = meta[dkey(type, id)];
  if (entry.deleted) {
    return {
      entityType: type,
      entityId: id,
      payload: entry.tombstone || { id, sync: syncBlock(m, entry.ms) },
      deletedAt: entry.ms,
    };
  }
  if (type === 'checklist_item') {
    const all = await loadAll();
    const item = all.find(x => x.id === id);
    if (!item) return null;
    return { entityType: type, entityId: id, payload: checklistOut(item, m) };
  }
  if (type === 'habit') {
    const all = await listAllHabits();
    const h = all.find(x => x.id === id);
    if (!h) return null;
    return { entityType: type, entityId: id, payload: habitOut(h, m) };
  }
  // weekly_overview — entityId IS the weekKey
  const ov = await loadOverview(id);
  if (!ov) return null;
  return { entityType: type, entityId: id, payload: weeklyOut(ov, m) };
}

async function push(): Promise<void> {
  const dirty = await readJson<Record<string, DirtyEntry>>(DIRTY_KEY, {});
  const keys = Object.keys(dirty);
  if (keys.length === 0) return;
  const meta = await readJson<Record<string, MetaEntry>>(META_KEY, {});

  const upserts: any[] = [];
  const pushedKeys: string[] = [];
  for (const key of keys) {
    const sep = key.indexOf(':');
    const type = key.slice(0, sep) as EntityType;
    const id = key.slice(sep + 1);
    if (!ENTITY_TYPES.includes(type) || !id) { pushedKeys.push(key); continue; }
    const up = await buildUpsert(type, id, dirty[key], meta);
    if (up) { upserts.push(up); pushedKeys.push(key); }
    else pushedKeys.push(key);   // entity vanished locally with no tombstone — drop the mark
  }
  if (upserts.length === 0) {
    // Nothing pushable — still clear stale marks so they don't loop.
    for (const k of pushedKeys) delete dirty[k];
    await writeKey(DIRTY_KEY, JSON.stringify(dirty));
    return;
  }

  const resp = await fetch(SYNC_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ upserts }),
  });
  if (resp.status === 401) { await handleUnauthorized(); throw new Error('sync 401 — unlinked'); }
  if (!resp.ok) throw new Error(`device-sync POST ${resp.status}`);

  for (const k of pushedKeys) delete dirty[k];
  await writeKey(DIRTY_KEY, JSON.stringify(dirty));
  log(`[SYNC] pushed ${upserts.length} change${upserts.length === 1 ? '' : 's'}`, 'success');
}

// ═══ Orchestration ═══════════════════════════════════════════════════
/** Full cycle: pull remote → merge → push local dirty. No-op unlinked. */
export async function syncNow(): Promise<void> {
  if (syncing) return;
  if (!(await linkedHandle())) return;       // unlinked: pure local, always
  syncing = true;
  lastError = null;
  try {
    const changed = await pull();
    await push();
    if (changed) fireApplied();
    await updateGlance();
  } catch (e: any) {
    lastError = e?.message || String(e);
    console.error('[SYNC]', e);
  } finally {
    syncing = false;
  }
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
/** Debounced push (~5s) after a local mutation. Unlinked: no-op. */
export function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(async () => {
    pushTimer = null;
    if (!(await linkedHandle())) return;
    try { await push(); lastError = null; }
    catch (e: any) { lastError = e?.message || String(e); console.error('[SYNC push]', e); }
  }, 5000);
}

// ═══ Glass glance line (P2 of docs/TRANSLATION-SYSTEM.md) ════════════
// The companion authors ONE line from local cockpit/habit state and
// writes it to bridge.localStorage; the glass Home page renders it.
// Authored reduction, never raw truncation-only: segments drop in
// priority order until the line fits the ~26-char container budget
// (220px at textSize 16 in the Home page's spare title-region slot).
const GLANCE_MAX_CHARS = 26;

function composeGlanceLine(items: ChecklistItem[], maxStreak: number): string {
  const streakSeg = maxStreak >= 1 ? ` · Φ${maxStreak}d` : '';
  const big = items.find(i => i.size === 'big' && !i.completed) || items.find(i => i.size === 'big');
  if (big) {
    const tail = `${streakSeg}`;
    const fit = (prefix: string) => {
      const budget = GLANCE_MAX_CHARS - prefix.length - tail.length;
      if (budget < 6) return null;
      const t = big.title.length <= budget ? big.title : big.title.slice(0, budget - 1).trimEnd() + '…';
      return `${prefix}${t}${tail}`;
    };
    return fit('TODAY · 1 BIG: ') || fit('1 BIG: ') || fit('1B ') || `1 BIG${tail}`;
  }
  if (items.length > 0) {
    const done = items.filter(i => i.completed).length;
    return `TODAY ${done}/${items.length}${streakSeg}`;
  }
  if (maxStreak >= 1) return `Φ${maxStreak}d streak`;
  return '';   // nothing synced/local → glass shows nothing, never junk
}

/** Recompute + write the glance payload. Cheap; safe to call often. */
export async function updateGlance(): Promise<void> {
  if (!bridgeRef) return;
  try {
    const items = await loadToday();
    const habits = await listHabits();
    const maxStreak = habits.reduce((m, h) => Math.max(m, h.streak), 0);
    const line = composeGlanceLine(items, maxStreak);
    await writeKey(GLANCE_KEY, JSON.stringify({ d: dateKey(), line }));
  } catch (e) { console.error('[SYNC] glance failed', e); }
}
