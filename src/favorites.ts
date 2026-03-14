// ══════════════════════════════════════════════════════════════════════════
// soΦcon — Favorites System
// Persists favorite quotes via Even Hub localStorage
// ══════════════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { Quote } from './constants';

const STORAGE_KEY = "sophicon_favorites";

// In-memory favorites (synced to storage)
let favorites: string[] = []; // Array of quote text strings (unique key)
let bridgeRef: EvenAppBridge | null = null;

export function initFavorites(bridge: EvenAppBridge): void {
  bridgeRef = bridge;
  // Load from storage on init
  bridge.getLocalStorage(STORAGE_KEY).then((stored) => {
    if (stored) {
      try {
        favorites = JSON.parse(stored);
      } catch {
        favorites = [];
      }
    }
  }).catch(() => {
    favorites = [];
  });
}

async function saveFavorites(): Promise<void> {
  if (!bridgeRef) return;
  try {
    await bridgeRef.setLocalStorage(STORAGE_KEY, JSON.stringify(favorites));
  } catch (err) {
    console.error("[soΦcon] Failed to save favorites:", err);
  }
}

export function isFavorite(quote: Quote): boolean {
  return favorites.includes(quote.text);
}

export async function toggleFavorite(quote: Quote): Promise<boolean> {
  const idx = favorites.indexOf(quote.text);
  if (idx >= 0) {
    favorites.splice(idx, 1);
    await saveFavorites();
    return false; // removed
  } else {
    favorites.push(quote.text);
    await saveFavorites();
    return true; // added
  }
}

export function getFavoriteCount(): number {
  return favorites.length;
}

export function getFavoriteTexts(): string[] {
  return [...favorites];
}
