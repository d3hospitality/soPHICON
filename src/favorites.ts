// ══════════════════════════════════════════════════════════════════════════
// soΦcon — Favorites (THE single store, both surfaces)
//
// History, because it explains the shape of this file: before 1.7.0 there
// were TWO disconnected favorites stores. The glass wrote quote-text
// strings to 'sophicon_favorites' through this module — except
// initFavorites() was never called, so the bridge ref stayed null, saves
// no-oped, and glass ♥ marks silently evaporated on relaunch. The phone
// Picks tab kept its own working Set under 'enki_favorites'. A wearer
// could favorite the same quote twice and see it in neither place.
//
// Now: ONE canonical key ('enki_favorites_v2' — see the key comment
// below for why it is versioned), ONE module (this file; dashboard.ts
// delegates here), and entries carry a TIMESTAMP. Readable formats:
//   read:  ["text", ...]                       (legacy phone format)
//          [{"t": "text", "ts": 123}, ...]     (current)
//          'enki_favorites' + 'sophicon_favorites' (legacy keys, merged in)
//   write: [{"t": "text", "ts": 123}, ...]     ts=0 ⇒ migrated from legacy,
//                                               save date unknown
// ══════════════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { Quote } from './constants';

// v2 SUFFIX IS LOAD-BEARING. The currently-shipped 1.5.3 dashboard reads
// 'enki_favorites' with `new Set(arr.map(String))` — handed the new
// {t,ts} objects it collapses every entry to "[object Object]" and its
// save then DESTROYS the store. Old and new versions coexist during any
// rollout (cached webviews, the Android wrap), so the new format lives
// under a key old readers never touch. 'enki_favorites' is migrated in
// once and then LEFT INTACT for whatever old reader still runs.
const STORAGE_KEY = "enki_favorites_v2";
const LEGACY_PHONE_KEY = "enki_favorites";
const LEGACY_GLASS_KEY = "sophicon_favorites";

export interface FavoriteEntry {
  /** Quote text — the unique key (matches Android + Picks convention). */
  t: string;
  /** Epoch ms when saved. 0 = saved before 1.7.0, date unknown. */
  ts: number;
}

let favorites: FavoriteEntry[] = [];
let bridgeRef: EvenAppBridge | null = null;
let loaded = false;
// A load that THREW is not an empty store — it is an unknown store.
// Writing over it would clobber real data with []. save() refuses
// until a re-load succeeds.
let loadFailed = false;

/** Change listeners — the Picks tab repaints its ★s when the glass
 *  toggles a ♥ and vice versa, since both surfaces share this store. */
type FavListener = () => void;
const listeners: FavListener[] = [];
export function onFavoritesChange(cb: FavListener): () => void {
  listeners.push(cb);
  return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); };
}
function notify(): void { for (const cb of listeners) { try { cb(); } catch { /* listener's problem */ } } }

function parseEntries(raw: string): FavoriteEntry[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((e: unknown): FavoriteEntry | null => {
        if (typeof e === 'string') return { t: e, ts: 0 };            // legacy phone
        if (e && typeof e === 'object' && typeof (e as any).t === 'string') {
          return { t: (e as any).t, ts: Number((e as any).ts) || 0 }; // current
        }
        return null;
      })
      .filter((e): e is FavoriteEntry => e !== null);
  } catch { return []; }
}

/** Load the store and run the one-time legacy-glass merge. MUST be
 *  awaited in boot before any surface renders favorite state. */
export async function initFavorites(bridge: EvenAppBridge): Promise<void> {
  bridgeRef = bridge;
  try {
    const raw = await bridge.getLocalStorage(STORAGE_KEY);
    favorites = raw ? parseEntries(raw) : [];
    loadFailed = false;
  } catch { favorites = []; loadFailed = true; }

  // Merge the legacy stores IN, never clearing the old phone key: the
  // 1.5.3 dashboard still reads/writes it, and both versions coexist
  // during rollout. Entries migrated from it carry ts=0 (save date
  // unknown). The dead glass key IS cleared — nothing shipped reads it.
  if (!loadFailed) {
    try {
      const seen = new Set(favorites.map(f => f.t));
      let merged = false;
      const oldPhone = await bridge.getLocalStorage(LEGACY_PHONE_KEY);
      for (const e of parseEntries(oldPhone || '[]')) {
        if (!seen.has(e.t)) { favorites.push(e); seen.add(e.t); merged = true; }
      }
      const oldGlass = await bridge.getLocalStorage(LEGACY_GLASS_KEY);
      if (oldGlass) {
        for (const e of parseEntries(oldGlass)) {
          if (!seen.has(e.t)) { favorites.push(e); seen.add(e.t); merged = true; }
        }
        await bridge.setLocalStorage(LEGACY_GLASS_KEY, "");
      }
      if (merged) await save();
    } catch { /* legacy merge is best-effort */ }
  }
  loaded = true;
  notify();
}

async function save(): Promise<void> {
  if (!bridgeRef) return;
  if (loadFailed) {
    // Retry the read before ever writing: the in-memory [] is a load
    // FAILURE, and persisting it would destroy whatever is really there.
    try {
      const raw = await bridgeRef.getLocalStorage(STORAGE_KEY);
      const disk = raw ? parseEntries(raw) : [];
      const seen = new Set(favorites.map(f => f.t));
      for (const e of disk) if (!seen.has(e.t)) favorites.push(e);
      loadFailed = false;
      notify();
    } catch {
      console.error("[soΦcon] favorites store unreadable — refusing to overwrite it");
      return;
    }
  }
  try { await bridgeRef.setLocalStorage(STORAGE_KEY, JSON.stringify(favorites)); }
  catch (err) { console.error("[soΦcon] Failed to save favorites:", err); }
}

export function favoritesLoaded(): boolean { return loaded; }

export function isFavorite(quote: Quote): boolean {
  return favorites.some(f => f.t === quote.text);
}

export function isFavoriteText(text: string): boolean {
  return favorites.some(f => f.t === text);
}

/** Toggle by Quote. Returns true when ADDED. */
export async function toggleFavorite(quote: Quote): Promise<boolean> {
  return toggleFavoriteText(quote.text);
}

/** Toggle by raw text (the Picks tab has text, not Quote objects). */
export async function toggleFavoriteText(text: string): Promise<boolean> {
  const idx = favorites.findIndex(f => f.t === text);
  let added: boolean;
  if (idx >= 0) { favorites.splice(idx, 1); added = false; }
  else { favorites.push({ t: text, ts: Date.now() }); added = true; }
  await save();
  notify();
  return added;
}

export function getFavoriteCount(): number { return favorites.length; }

export function getFavoriteTexts(): string[] { return favorites.map(f => f.t); }

/** Newest first — the order the glass favorites page reads in. */
export function getFavoriteEntries(): FavoriteEntry[] {
  return [...favorites].sort((a, b) => b.ts - a.ts);
}
