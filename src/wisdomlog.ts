// ══════════════════════════════════════════════════════════════════════════
// soΦcon — Wisdom log (the capture store)
//
// Every explicit "keep this" action lands here as one dated entry:
//   fav    — saved a quote to favorites (glass ♥ or Picks ★)
//   reply  — logged a philosopher's reply mid-conversation (glass menu)
//   like   — liked an Aphorica post (glass menu or Picks heart)
//
// This is DELIBERATELY separate from speak_journal: the journal records
// whole sessions the system made; the wisdom log records moments the
// USER chose. The calendar merges both, but they answer different
// questions — "what happened" vs "what did I keep".
//
// Storage: bridge localStorage key 'wisdom_log', JSON array, newest
// LAST (append order), capped at MAX_ENTRIES by dropping the oldest.
// Entries are small on purpose (text capped at 300 chars) — this is a
// log, not an archive; the full quote/conversation lives elsewhere.
// ══════════════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';

const STORAGE_KEY = "wisdom_log";
const MAX_ENTRIES = 500;
const TEXT_CAP = 300;

export type WisdomKind = 'fav' | 'reply' | 'like';

export interface WisdomEntry {
  /** Epoch ms of the capture. */
  ts: number;
  kind: WisdomKind;
  /** The captured text, capped at 300 chars. */
  text: string;
  /** Who it came from: philosopher name, or @handle for likes. */
  who: string;
  /** Tradition, when known — lets the day view color-group later. */
  trad?: string;
}

let entries: WisdomEntry[] = [];
let bridgeRef: EvenAppBridge | null = null;
// See favorites.ts: a load that threw must never be overwritten with [].
let loadFailed = false;

type WlListener = () => void;
const listeners: WlListener[] = [];
export function onWisdomLogChange(cb: WlListener): () => void {
  listeners.push(cb);
  return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
}
function notify(): void { for (const cb of listeners) { try { cb(); } catch { /* theirs */ } } }

export async function initWisdomLog(bridge: EvenAppBridge): Promise<void> {
  bridgeRef = bridge;
  try {
    const raw = await bridge.getLocalStorage(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    entries = Array.isArray(arr)
      ? arr.filter((e: any) => e && typeof e.ts === 'number' && typeof e.text === 'string'
          && (e.kind === 'fav' || e.kind === 'reply' || e.kind === 'like'))
      : [];
    loadFailed = false;
  } catch { entries = []; loadFailed = true; }
}

async function save(): Promise<void> {
  if (!bridgeRef) return;
  if (loadFailed) {
    try {
      const raw = await bridgeRef.getLocalStorage(STORAGE_KEY);
      const disk = Array.isArray(JSON.parse(raw || '[]')) ? JSON.parse(raw || '[]') : [];
      // Disk entries win on conflict-less merge; ours append after.
      const mine = entries;
      entries = [...disk, ...mine].slice(-MAX_ENTRIES);
      loadFailed = false;
    } catch {
      console.error("[soΦcon] wisdom log unreadable — refusing to overwrite it");
      return;
    }
  }
  try { await bridgeRef.setLocalStorage(STORAGE_KEY, JSON.stringify(entries)); }
  catch (err) { console.error("[soΦcon] wisdom log save failed:", err); }
}

export async function addWisdomEntry(kind: WisdomKind, text: string, who: string, trad?: string): Promise<void> {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, TEXT_CAP);
  if (!clean) return;
  entries.push({ ts: Date.now(), kind, text: clean, who, ...(trad ? { trad } : {}) });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  await save();
  notify();
}

// NOTE: there is deliberately NO removeWisdomEntry. The log is
// append-only history: "you saved this that day" stays true even after
// the favorite is later removed. Un-favoriting affects the favorites
// STORE (and the glass viewer), never the calendar's past.

export function getWisdomEntries(): WisdomEntry[] { return [...entries]; }
