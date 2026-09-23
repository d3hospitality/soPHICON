import { kv } from './_store.js'; // Supabase-backed (Vercel KV host is gone)
import { identify } from './_auth.js';

/**
 * PR04: "Unpair all glasses" for the signed-in account.
 * Requires a normal user session (not a glasses token), then rejects
 * every glasses token issued up to now. Re-pairing mints a fresh token.
 *
 * @method POST
 * @returns {object} { ok: true, revokedBefore: number }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const id = await identify(req).catch(() => null);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });
  if (id.scope !== 'user') return res.status(403).json({ error: 'use_phone_or_web' });

  const cutoff = Math.floor(Date.now() / 1000);
  try {
    // 181 days > the 180d glasses token lifetime.
    await kv.set(`gl:revokedBefore:${id.userId}`, cutoff, { ex: 181 * 86400 });
  } catch {
    return res.status(503).json({ error: 'unlink_unavailable', retryable: true });
  }
  return res.status(200).json({ ok: true, revokedBefore: cutoff });
}
