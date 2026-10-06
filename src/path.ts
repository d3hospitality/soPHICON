// ═══════════════════════════════════════════════════════════════════
// enkiRIDION — Your path (src/path.ts)
//
// Goals the wearer chose, and the moves they kept at the end of talks.
// One store for both surfaces (glass + phone), the same way favorites
// work: bridge storage, mirrored to the webview's own localStorage.
//
//   • Goals: Free holds 1 active goal, Sage holds 3.
//   • Moves: one concrete next step, proposed by /api/next-move when a
//     talk ends, kept with a tap; open → done | skipped.
//   • Philosophers see it: pathContext() rides every /api/speak call.
//   • Linked accounts sync through /api/device-sync as `goal` and
//     `path_move` rows (no table of its own; last write wins on the
//     item's updatedAt). Unlinked = purely local, nothing is gated.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { authHeaders, isLinked, isSageCached, onAccountChange, setAccountBridge } from './enkiAccount';
import { log } from './ui';

export interface Goal {
  id: string;
  title: string;
  status: 'active' | 'done' | 'dropped';
  createdAt: number;
  updatedAt: number;
}

export interface Move {
  id: string;
  text: string;
  goalId: string | null;
  status: 'open' | 'done' | 'skipped';
  createdAt: number;
  updatedAt: number;
  philId?: string;
  philName?: string;
}

/** What /api/next-move proposes; nothing is stored until it is kept. */
export interface MoveProposal {
  move: string;
  goalId: string | null;
  suggestedGoal: string | null;
  philId?: string;
  philName?: string;
}

interface Store { goals: Goal[]; moves: Move[]; dirty: string[] }

const KEY = 'enki_path_v1';
const MIRROR_KEY = 'enkiPath:v1';
const SINCE_KEY = 'enki_path_since';
const API = 'https://sophicon-api.vercel.app/api';
const GOAL_TYPE = 'goal';
const MOVE_TYPE = 'path_move';
const MAX_MOVES = 200;
const MOVE_TIMEOUT_MS = 8000;

let bridgeRef: EvenAppBridge | null = null;
let store: Store = { goals: [], moves: [], dirty: [] };
let loaded = false;

type Listener = () => void;
const listeners: Listener[] = [];
export function onPathChange(cb: Listener): void { listeners.push(cb); }
function notify(): void { for (const cb of listeners) { try { cb(); } catch { /* listener's problem */ } } }

const newId = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// ─── storage ────────────────────────────────────────────────────────
function parse(raw: string | null): Store | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    return {
      goals: Array.isArray(s?.goals) ? s.goals : [],
      moves: Array.isArray(s?.moves) ? s.moves : [],
      dirty: Array.isArray(s?.dirty) ? s.dirty : [],
    };
  } catch { return null; }
}

export async function initPath(bridge: EvenAppBridge): Promise<void> {
  bridgeRef = bridge;
  setAccountBridge(bridge); // idempotent; sync needs the account before the glass boots
  let raw: string | null = null;
  try { raw = (await bridge.getLocalStorage(KEY)) || null; } catch { raw = null; }
  if (!raw) { try { raw = window.localStorage.getItem(MIRROR_KEY); } catch { raw = null; } }
  store = parse(raw) || store;
  loaded = true;
  onAccountChange(() => { syncPath().catch(() => {}); });
  syncPath().catch(() => {});
}

async function save(changed: string[] = []): Promise<void> {
  for (const k of changed) if (!store.dirty.includes(k)) store.dirty.push(k);
  // Oldest finished moves go first when the list gets long.
  if (store.moves.length > MAX_MOVES) {
    const open = store.moves.filter(m => m.status === 'open');
    const rest = store.moves.filter(m => m.status !== 'open').sort((a, b) => b.updatedAt - a.updatedAt);
    store.moves = [...open, ...rest].slice(0, MAX_MOVES);
  }
  const raw = JSON.stringify(store);
  try { window.localStorage.setItem(MIRROR_KEY, raw); } catch { /* private mode */ }
  if (bridgeRef) { try { await bridgeRef.setLocalStorage(KEY, raw); } catch (e) { log(`[PATH] save failed: ${e}`, 'error'); } }
  notify();
  if (changed.length) schedulePush();
}

// ─── reads ──────────────────────────────────────────────────────────
export const goalLimit = (): number => (isSageCached() ? 3 : 1);
export const activeGoals = (): Goal[] => store.goals.filter(g => g.status === 'active').sort((a, b) => a.createdAt - b.createdAt);
export const openMoves = (): Move[] => store.moves.filter(m => m.status === 'open').sort((a, b) => b.createdAt - a.createdAt);
export const goalById = (id: string | null): Goal | undefined => (id ? store.goals.find(g => g.id === id) : undefined);
export function recentDone(days = 14): Move[] {
  const since = Date.now() - days * 864e5;
  return store.moves.filter(m => m.status === 'done' && m.updatedAt >= since).sort((a, b) => b.updatedAt - a.updatedAt);
}

// ─── writes ─────────────────────────────────────────────────────────
export type AddGoalResult = { ok: true; goal: Goal } | { ok: false; reason: 'empty' | 'limit' | 'duplicate' };

export async function addGoal(rawTitle: string): Promise<AddGoalResult> {
  const title = rawTitle.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) return { ok: false, reason: 'empty' };
  if (activeGoals().some(g => g.title.toLowerCase() === title.toLowerCase())) return { ok: false, reason: 'duplicate' };
  if (activeGoals().length >= goalLimit()) return { ok: false, reason: 'limit' };
  const now = Date.now();
  const goal: Goal = { id: newId('g'), title, status: 'active', createdAt: now, updatedAt: now };
  store.goals.push(goal);
  await save([`${GOAL_TYPE}:${goal.id}`]);
  return { ok: true, goal };
}

export async function setGoalStatus(id: string, status: Goal['status']): Promise<void> {
  const g = store.goals.find(x => x.id === id);
  if (!g || g.status === status) return;
  g.status = status; g.updatedAt = Date.now();
  await save([`${GOAL_TYPE}:${id}`]);
}

/** Keep a proposed move. A suggested goal is created with it when
 *  there is room; otherwise the move is kept on its own. */
export async function keepMove(p: MoveProposal): Promise<Move> {
  let goalId = p.goalId && goalById(p.goalId)?.status === 'active' ? p.goalId : null;
  const changed: string[] = [];
  if (!goalId && p.suggestedGoal) {
    const r = await addGoal(p.suggestedGoal);
    if (r.ok) goalId = r.goal.id;
  }
  const now = Date.now();
  const move: Move = {
    id: newId('m'), text: p.move.slice(0, 160), goalId, status: 'open',
    createdAt: now, updatedAt: now, philId: p.philId, philName: p.philName,
  };
  store.moves.push(move);
  changed.push(`${MOVE_TYPE}:${move.id}`);
  await save(changed);
  log(`[PATH] kept move "${move.text}"${goalId ? ` toward ${goalById(goalId)?.title}` : ''}`, 'success');
  return move;
}

export async function setMoveStatus(id: string, status: Move['status']): Promise<void> {
  const m = store.moves.find(x => x.id === id);
  if (!m || m.status === status) return;
  m.status = status; m.updatedAt = Date.now();
  await save([`${MOVE_TYPE}:${id}`]);
}

// ─── what philosophers are told ────────────────────────────────────
const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Plain text for /api/speak's THEIR PATH block. Empty when there is
 *  nothing to say, so the block is left out entirely. */
export function pathContext(): string {
  if (!loaded) return '';
  const goals = activeGoals();
  const open = openMoves().slice(0, 5);
  const done = recentDone().slice(0, 3);
  if (!goals.length && !open.length && !done.length) return '';
  const toward = (m: Move) => { const g = goalById(m.goalId); return g ? `, toward "${g.title}"` : ''; };
  const lines: string[] = [];
  if (goals.length) lines.push('Goals:', ...goals.map(g => `- ${g.title} (since ${shortDate(g.createdAt)})`));
  if (open.length) lines.push('Open moves:', ...open.map(m => `- ${m.text} (kept ${shortDate(m.createdAt)}${toward(m)})`));
  if (done.length) lines.push('Recently done:', ...done.map(m => `- ${m.text} (done ${shortDate(m.updatedAt)}${toward(m)})`));
  return lines.join('\n');
}

// ─── the end of a talk ─────────────────────────────────────────────
/** Ask for one next step from a finished talk. Null when the talk held
 *  nothing actionable, the API is unreachable, or it took too long. */
export async function requestMove(args: {
  philId: string; philName: string;
  exchanges: { role: 'user' | 'assistant'; content: string }[];
}): Promise<MoveProposal | null> {
  if (!args.exchanges.some(m => m.role === 'user')) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MOVE_TIMEOUT_MS);
  try {
    const resp = await fetch(`${API}/next-move`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
      body: JSON.stringify({
        philName: args.philName,
        exchanges: args.exchanges,
        goals: activeGoals().map(g => ({ id: g.id, title: g.title })),
        openMoves: openMoves().map(m => m.text),
      }),
    });
    if (!resp.ok) { log(`[PATH] next-move ${resp.status}`); return null; }
    const data = await resp.json();
    if (!data?.move) return null;
    return { move: String(data.move), goalId: data.goalId || null, suggestedGoal: data.suggestedGoal || null, philId: args.philId, philName: args.philName };
  } catch (e) {
    log(`[PATH] next-move failed: ${(e as any)?.name === 'AbortError' ? 'timeout' : e}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── sync (linked accounts) ────────────────────────────────────────
let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; syncPath().catch(() => {}); }, 1500);
}

let syncing = false;
/** Pull goal/move rows changed since the last pull, keep whichever side
 *  was edited last, then push what changed here. No-op when unlinked. */
export async function syncPath(): Promise<void> {
  if (syncing || !loaded || !(await isLinked())) return;
  syncing = true;
  try {
    const headers = await authHeaders();
    let since = 0;
    try { since = Number((await bridgeRef?.getLocalStorage(SINCE_KEY)) || 0) || 0; } catch { since = 0; }
    const pull = await fetch(`${API}/device-sync?since=${since}&types=${GOAL_TYPE},${MOVE_TYPE}`, { headers });
    if (pull.ok) {
      const data = await pull.json();
      let changed = false;
      for (const row of Array.isArray(data.rows) ? data.rows : []) {
        const p = row?.payload;
        if (!p?.id) continue;
        const list: (Goal | Move)[] = row.entity_type === GOAL_TYPE ? store.goals : row.entity_type === MOVE_TYPE ? store.moves : [];
        if (row.entity_type !== GOAL_TYPE && row.entity_type !== MOVE_TYPE) continue;
        const i = list.findIndex(x => x.id === p.id);
        if (i < 0) { list.push(p); changed = true; }
        else if ((Number(p.updatedAt) || 0) > list[i].updatedAt) { list[i] = p; changed = true; }
      }
      if (changed) await save();
      if (data.now) { try { await bridgeRef?.setLocalStorage(SINCE_KEY, String(data.now)); } catch { /* re-pulls next time */ } }
    }
    if (store.dirty.length) {
      const sending = [...store.dirty];
      const upserts = sending.map(k => {
        const [type, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        const item = type === GOAL_TYPE ? store.goals.find(g => g.id === id) : store.moves.find(m => m.id === id);
        return item ? { entityType: type, entityId: id, payload: item } : null;
      }).filter(Boolean);
      if (upserts.length) {
        const push = await fetch(`${API}/device-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify({ upserts }),
        });
        if (!push.ok) return;
      }
      store.dirty = store.dirty.filter(k => !sending.includes(k));
      await save();
    }
  } catch (e) {
    log(`[PATH] sync failed: ${e}`);
  } finally {
    syncing = false;
  }
}
