// ═══════════════════════════════════════════════════════════════════
// enkiAccount.ts — glasses-side account link (pairing token).
//
// The G2 webview cannot run Google OAuth (disallowed_useragent), so
// identity arrives via a 6-char pairing code minted on enkiridion.com
// (Settings → G2 Glasses) and exchanged at sophicon-api /glasses-link
// for a long-lived scoped JWT. The token rides every speak/transcribe
// call as a Bearer header; the server resolves the live tier per
// request, so Stripe upgrades/downgrades land without re-pairing.
//
// Unlinked glasses are a full seeker experience: baked-in quotes work
// offline forever, Speak is Enki-only with the anonymous daily limit.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';

const LINK_API_URL = 'https://sophicon-api.vercel.app/api/glasses-link';
const ME_API_URL = 'https://sophicon-api.vercel.app/api/me';
const TOKEN_KEY = 'enki_token';
const HANDLE_KEY = 'enki_handle';
const TIER_KEY = 'enki_tier';

let bridgeRef: EvenAppBridge | null = null;
let cachedToken: string | null = null;
let cachedHandle: string | null = null;
let cachedTier: string | null = null;
let loaded = false;

// Both faces of the app (phone dashboard + glasses pages) react to the
// account: the glasses' Sage gate, the phone's plan card and header chip.
// They used to read it once at startup, so linking mid-session left the
// glasses refusing a paying Sage until the app was restarted.
const listeners: Array<() => void> = [];
export function onAccountChange(cb: () => void): void { listeners.push(cb); }
function changed(): void { for (const cb of listeners) { try { cb(); } catch { /* one bad listener can't block the rest */ } } }

export function setAccountBridge(b: EvenAppBridge): void { bridgeRef = b; }

// The bridge store is the source of truth, but its writes can fail or
// silently return false — and then the link vanished on the next launch.
// Every write is mirrored to the webview's own localStorage, and a read
// falls back to the mirror when the bridge comes back empty.
const MIRROR = (k: string) => `enkiAccount:${k}`;
function mirrorGet(k: string): string | null { try { return window.localStorage.getItem(MIRROR(k)); } catch { return null; } }
function mirrorSet(k: string, v: string): void { try { if (v) window.localStorage.setItem(MIRROR(k), v); else window.localStorage.removeItem(MIRROR(k)); } catch { /* private mode */ } }

async function persist(key: string, value: string): Promise<boolean> {
  mirrorSet(key, value);
  if (!bridgeRef) return false;
  try { return (await bridgeRef.setLocalStorage(key, value)) !== false; } catch { return false; }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  let bridgeOk = false;
  if (bridgeRef) {
    try {
      cachedToken = (await bridgeRef.getLocalStorage(TOKEN_KEY)) || null;
      cachedHandle = (await bridgeRef.getLocalStorage(HANDLE_KEY)) || null;
      cachedTier = (await bridgeRef.getLocalStorage(TIER_KEY)) || null;
      bridgeOk = true;
    } catch { /* fall through to the mirror */ }
  }
  if (!cachedToken) {
    const t = mirrorGet(TOKEN_KEY);
    if (t) {
      cachedToken = t;
      cachedHandle = mirrorGet(HANDLE_KEY);
      cachedTier = mirrorGet(TIER_KEY);
      if (bridgeRef) { persist(TOKEN_KEY, t); persist(HANDLE_KEY, cachedHandle || ''); persist(TIER_KEY, cachedTier || ''); }
    }
  }
  // A failed bridge read is retried on the next call instead of leaving a
  // paying member "unlinked" for the whole session.
  loaded = bridgeOk || !!cachedToken || !bridgeRef;
}

/** True when these glasses carry an account token. */
export async function isLinked(): Promise<boolean> {
  await ensureLoaded();
  return !!cachedToken;
}

/** The linked account's handle, or null when unlinked. A linked account
 *  whose profile has no handle yet still counts as linked. */
export async function linkedHandle(): Promise<string | null> {
  await ensureLoaded();
  return cachedToken ? (cachedHandle || 'member') : null;
}

/** Tier captured at link time ('seeker' | 'sage').
 * The server resolves the LIVE tier per request; this is display-only. */
export async function linkedTier(): Promise<string | null> {
  await ensureLoaded();
  return cachedToken ? cachedTier : null;
}

/** Sync, display-only: is the cached tier Sage? (Server still enforces.) */
export function isSageCached(): boolean {
  return !!cachedToken && cachedTier === 'sage';
}

/** Ask the server for the LIVE tier and cache it. The tier captured at
 *  pairing goes stale after upgrades / trials / cancellations. A 401 means
 *  the token is dead: drop to unlinked so both screens say so. Offline
 *  keeps the cached value. */
export async function refreshTier(): Promise<string | null> {
  await ensureLoaded();
  if (!cachedToken) return null;
  try {
    const resp = await fetch(ME_API_URL, { headers: { Authorization: `Bearer ${cachedToken}` } });
    if (resp.status === 401) { await unlink(); return null; }
    if (!resp.ok) return cachedTier;
    const data = await resp.json().catch(() => ({}));
    const before = `${cachedTier}|${cachedHandle}`;
    if (data.tier === 'sage' || data.tier === 'seeker') {
      cachedTier = data.tier;
      await persist(TIER_KEY, data.tier);
    }
    if (typeof data.handle === 'string' && data.handle) {
      cachedHandle = data.handle;
      await persist(HANDLE_KEY, data.handle);
    }
    if (`${cachedTier}|${cachedHandle}` !== before) changed();
  } catch { /* offline — keep cached */ }
  return cachedTier;
}

/** Extra headers for sophicon-api calls: Bearer token when linked. */
export async function authHeaders(): Promise<Record<string, string>> {
  await ensureLoaded();
  return cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {};
}

/** What a failed link means, in words the wearer can act on. */
export function linkErrorText(error?: string): string {
  switch (error) {
    case 'invalid_code':
    case 'code_expired':
    case 'expired':
      return 'That code didn’t work. Codes last a few minutes. Get a fresh one at enkiridion.com/settings.';
    case 'too_many_attempts':
      return 'Too many tries. Wait a little, then use a fresh code.';
    case 'empty':
      return 'Type the 6-character code from enkiridion.com/settings first.';
    case 'offline':
      return 'No connection. Check your phone is online and try again.';
    default:
      return 'Linking didn’t work. Get a fresh code at enkiridion.com/settings and try again.';
  }
}

/** Redeem a pairing code from enkiridion.com → store the glasses token. */
export async function linkWithCode(
  code: string,
): Promise<{ ok: boolean; handle?: string; tier?: string; error?: string; saved?: boolean }> {
  const clean = code.replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (!clean) return { ok: false, error: 'empty' };
  let resp: Response;
  try {
    resp = await fetch(LINK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: clean }),
    });
  } catch {
    return { ok: false, error: 'offline' };
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.token) {
    return { ok: false, error: data.error || `link_${resp.status}` };
  }
  cachedToken = data.token;
  cachedHandle = data.handle || null;
  cachedTier = data.tier || null;
  loaded = true;
  const saved = (await persist(TOKEN_KEY, data.token)) && (await persist(HANDLE_KEY, data.handle || '')) && (await persist(TIER_KEY, data.tier || ''));
  changed();
  return { ok: true, handle: data.handle, tier: data.tier, saved };
}

export async function unlink(): Promise<void> {
  const was = !!cachedToken;
  cachedToken = null;
  cachedHandle = null;
  cachedTier = null;
  loaded = true;
  await persist(TOKEN_KEY, '');
  await persist(HANDLE_KEY, '');
  await persist(TIER_KEY, '');
  if (was) changed();
}

/** Call on a 401 from the API — the token is dead; drop back to seeker. */
export async function handleUnauthorized(): Promise<void> {
  await unlink();
}
