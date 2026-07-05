// ═══════════════════════════════════════════════════════════════════
// api/_auth.js — bearer-token identity for every protected endpoint.
//
// Two token audiences share the Authorization header:
//   1. Supabase user JWTs (web + Android) — verified against the
//      project JWKS, falling back to HS256 with SUPABASE_JWT_SECRET
//      for legacy-secret projects.
//   2. Glasses JWTs (G2) — minted by api/glasses-link.js, HS256 with
//      GLASSES_TOKEN_SECRET, scope "glasses".
//
// Tier is read from public.profiles with the service-role client and
// cached in KV for 60s so a Stripe downgrade lands within a minute
// on every surface, glasses included.
// ═══════════════════════════════════════════════════════════════════

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createClient } from '@supabase/supabase-js';
import { kv } from '@vercel/kv';

const SUPABASE_URL = process.env.SUPABASE_URL;
let _jwks = null;
function jwks() {
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)
    );
  }
  return _jwks;
}

let _admin = null;
function admin() {
  if (!_admin) {
    _admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

/**
 * Resolve the caller's identity from the Authorization header.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ userId: string, tier: 'seeker'|'sage', scope: 'user'|'glasses' } | null>}
 *          null when there is no token or it fails verification.
 */
export async function identify(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;

  const payload = await verifyToken(token);
  if (!payload || !payload.sub) return null;

  const tier = await tierFor(payload.sub);
  return {
    userId: payload.sub,
    tier,
    scope: payload.scope === 'glasses' ? 'glasses' : 'user',
  };
}

async function verifyToken(token) {
  // Glasses tokens first — cheap local HS256, distinct secret.
  if (process.env.GLASSES_TOKEN_SECRET) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.GLASSES_TOKEN_SECRET)
      );
      if (payload.scope === 'glasses') return payload;
    } catch { /* not a glasses token — fall through */ }
  }

  // Supabase user JWT: asymmetric (JWKS) projects first, HS256 legacy after.
  try {
    const { payload } = await jwtVerify(token, jwks());
    return payload;
  } catch { /* fall through to HS256 */ }

  if (process.env.SUPABASE_JWT_SECRET) {
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
      );
      return payload;
    } catch { /* invalid */ }
  }
  return null;
}

async function tierFor(userId) {
  const cacheKey = `tier:${userId}`;
  try {
    const cached = await kv.get(cacheKey);
    if (cached === 'seeker' || cached === 'sage') return cached;
  } catch { /* KV down — fall through to DB */ }

  let tier = 'seeker';
  try {
    const { data } = await admin()
      .from('profiles')
      .select('tier')
      .eq('id', userId)
      .single();
    if (data?.tier === 'sage') tier = 'sage';
  } catch { /* unknown user — seeker */ }

  try { await kv.set(cacheKey, tier, { ex: 60 }); } catch { /* best effort */ }
  return tier;
}
