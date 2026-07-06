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
const TOKEN_KEY = 'enki_token';
const HANDLE_KEY = 'enki_handle';
const TIER_KEY = 'enki_tier';

let bridgeRef: EvenAppBridge | null = null;
let cachedToken: string | null = null;
let cachedHandle: string | null = null;
let cachedTier: string | null = null;
let loaded = false;

export function setAccountBridge(b: EvenAppBridge): void { bridgeRef = b; }

async function ensureLoaded(): Promise<void> {
  if (loaded || !bridgeRef) return;
  try {
    cachedToken = (await bridgeRef.getLocalStorage(TOKEN_KEY)) || null;
    cachedHandle = (await bridgeRef.getLocalStorage(HANDLE_KEY)) || null;
    cachedTier = (await bridgeRef.getLocalStorage(TIER_KEY)) || null;
  } catch { /* stay unlinked */ }
  loaded = true;
}

export async function linkedHandle(): Promise<string | null> {
  await ensureLoaded();
  return cachedToken ? cachedHandle : null;
}

/** Tier captured at link time ('seeker' | 'sage').
 * The server resolves the LIVE tier per request; this is display-only. */
export async function linkedTier(): Promise<string | null> {
  await ensureLoaded();
  return cachedToken ? cachedTier : null;
}

/** Extra headers for sophicon-api calls: Bearer token when linked. */
export async function authHeaders(): Promise<Record<string, string>> {
  await ensureLoaded();
  return cachedToken ? { Authorization: `Bearer ${cachedToken}` } : {};
}

/** Redeem a pairing code from enkiridion.com → store the glasses token. */
export async function linkWithCode(
  code: string,
): Promise<{ ok: boolean; handle?: string; tier?: string; error?: string }> {
  try {
    const resp = await fetch(LINK_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim().toUpperCase() }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.token) {
      return { ok: false, error: data.error || `link ${resp.status}` };
    }
    cachedToken = data.token;
    cachedHandle = data.handle || null;
    cachedTier = data.tier || null;
    loaded = true;
    if (bridgeRef) {
      await bridgeRef.setLocalStorage(TOKEN_KEY, data.token).catch(() => false);
      await bridgeRef.setLocalStorage(HANDLE_KEY, data.handle || '').catch(() => false);
      await bridgeRef.setLocalStorage(TIER_KEY, data.tier || '').catch(() => false);
    }
    return { ok: true, handle: data.handle, tier: data.tier };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function unlink(): Promise<void> {
  cachedToken = null;
  cachedHandle = null;
  cachedTier = null;
  loaded = true;
  if (bridgeRef) {
    await bridgeRef.setLocalStorage(TOKEN_KEY, '').catch(() => false);
    await bridgeRef.setLocalStorage(HANDLE_KEY, '').catch(() => false);
    await bridgeRef.setLocalStorage(TIER_KEY, '').catch(() => false);
  }
}

/** Call on a 401 from the API — the token is dead; drop back to seeker. */
export async function handleUnauthorized(): Promise<void> {
  await unlink();
}
