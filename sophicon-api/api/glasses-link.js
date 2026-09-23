import { SignJWT } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';
import { randomUUID } from 'node:crypto';
import { clientIp } from './_policy.js';

// PR04: bound brute force on 6-char codes (36^6 space, but unthrottled).
const ATTEMPTS_PER_IP_PER_HOUR = 10;
export const GLASSES_AUDIENCE = 'enki-glasses';

/**
 * Exchange a short pairing code (minted by the web app while signed in)
 * for a long-lived glasses token. The G2 phone dashboard calls this once;
 * the token then rides every speak/transcribe request as a Bearer header.
 *
 * Tier is NOT baked into the token — _auth.js looks it up per request,
 * so Stripe upgrades/downgrades reach the glasses within a minute.
 *
 * @description Redeem a glasses pairing code
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.code - 6-character pairing code from enkiridion.com settings
 * @returns {object} { token: string, handle: string, tier: string }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.GLASSES_TOKEN_SECRET) {
    return res.status(500).json({ error: 'Server configuration error: glasses linking not configured' });
  }

  try {
    // Throttle before touching the database. If the quota store is down,
    // pairing still works (codes are single-use + short-lived, so guessing
    // stays impractical) but it is logged loudly — pairing is the one flow
    // that must not break for already-paying customers.
    try {
      const hourKey = `gl:attempt:${clientIp(req.headers)}:${new Date().toISOString().slice(0, 13)}`;
      const n = await kv.incr(hourKey);
      if (n === 1) await kv.expire(hourKey, 3600);
      if (n > ATTEMPTS_PER_IP_PER_HOUR) return res.status(429).json({ error: 'too_many_attempts', retryAfterMinutes: 60 });
    } catch (e) {
      console.error('[glasses-link] QUOTA STORE UNAVAILABLE — pairing unthrottled:', e?.message);
    }

    const code = String(req.body?.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // PR04: consume atomically. The conditional update only matches an
    // unused, unexpired code, so two simultaneous redemptions cannot both
    // win (the old select-then-update could mint two tokens).
    const nowIso = new Date().toISOString();
    const { data: claimed } = await admin
      .from('glasses_link_codes')
      .update({ used_at: nowIso })
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', nowIso)
      .select('user_id');

    const row = Array.isArray(claimed) ? claimed[0] : null;
    if (!row) {
      return res.status(400).json({ error: 'invalid_code' });
    }

    const { data: profile } = await admin
      .from('profiles')
      .select('handle, tier')
      .eq('id', row.user_id)
      .single();

    // jti lets a single pairing be revoked (see _auth.js); aud separates
    // glasses tokens from every other HS256 token.
    const token = await new SignJWT({ scope: 'glasses' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(row.user_id)
      .setAudience(GLASSES_AUDIENCE)
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime('180d')
      .sign(new TextEncoder().encode(process.env.GLASSES_TOKEN_SECRET));

    return res.status(200).json({
      token,
      handle: profile?.handle || null,
      tier: profile?.tier === 'sage' ? 'sage' : 'seeker',
    });
  } catch (err) {
    console.error('[glasses-link]', err);
    return res.status(500).json({ error: 'link_failed' });
  }
}
