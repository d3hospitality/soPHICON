// ═══════════════════════════════════════════════════════════════════
// api/waitlist.js — demand test for two products we haven't built.
//
//   paint-me : "Paint me into the canon"
//   summon   : "Summon a philosopher"
//
// POST { feature, action: 'view'|'tap'|'join', surface, src?, philosopher? }
//   view/tap → counted, anonymous allowed.
//   join     → needs a signed-in user (web session or paired glasses).
//              Anonymous joins get 401 { error: 'auth_required' } so the
//              client can open sign-up — the waitlist doubles as a sign-up
//              reason. Re-joining just updates the philosopher request.
// GET ?feature=paint-me|summon → { joined } for the signed-in caller.
//
// No provider spend. No IPs stored: `visitor` is an HMAC of ip+day.
// ═══════════════════════════════════════════════════════════════════

import { createHmac } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { identify } from './_auth.js';
import { kv } from './_store.js';
import { clientIp } from './_policy.js';

export const FEATURES = ['paint-me', 'summon'];
export const ACTIONS = ['view', 'tap', 'join'];
export const SURFACES = ['g2', 'web', 'ios', 'android'];
const PER_IP_PER_HOUR = 60;

let _db = null;
function db() {
  if (!_db) {
    _db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _db;
}

/** Trim, strip control chars and markup-ish characters, cap length. */
export function cleanText(v, max) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

function visitorHash(ip) {
  const day = new Date().toISOString().slice(0, 10);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || 'waitlist';
  return createHmac('sha256', key).update(`${day}|${ip}`).digest('hex').slice(0, 24);
}

/** Abuse brake only. Store down → still count (this costs nothing). */
async function overLimit(ip) {
  const hour = new Date().toISOString().slice(0, 13);
  const key = `wl:ip:${ip}:${hour}`;
  try {
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, 3600);
    return n > PER_IP_PER_HOUR;
  } catch (e) {
    console.warn('[waitlist] rate store unavailable', e?.message);
    return false;
  }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    const feature = String(req.query?.feature || '');
    if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'bad_feature' });
    const id = await identify(req).catch(() => null);
    if (!id?.userId) return res.status(200).json({ joined: false, signedIn: false });
    const { data } = await db().from('waitlist_signups').select('philosopher')
      .eq('feature', feature).eq('user_id', id.userId).maybeSingle();
    return res.status(200).json({ joined: Boolean(data), signedIn: true, philosopher: data?.philosopher ?? null });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const feature = String(body.feature || '');
  const action = String(body.action || 'tap');
  const surface = String(body.surface || '');
  if (!FEATURES.includes(feature)) return res.status(400).json({ error: 'bad_feature' });
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'bad_action' });
  if (!SURFACES.includes(surface)) return res.status(400).json({ error: 'bad_surface' });

  const ip = clientIp(req.headers);
  if (await overLimit(ip)) return res.status(429).json({ error: 'slow_down' });

  const id = await identify(req).catch(() => null);
  const userId = id?.userId || null;
  if (action === 'join' && !userId) {
    // Still count the intent; the client turns this into a sign-up prompt.
    await logTap({ feature, action: 'tap', surface, src: 'join-anon', ip, signedIn: false });
    return res.status(401).json({ error: 'auth_required' });
  }

  const src = cleanText(body.src, 40);
  const ok = await logTap({ feature, action, surface, src, ip, signedIn: Boolean(userId) });

  if (action === 'join') {
    const philosopher = feature === 'summon' ? cleanText(body.philosopher, 60) : null;
    const now = new Date().toISOString();
    const row = { feature, user_id: userId, surface, updated_at: now };
    if (philosopher) row.philosopher = philosopher;
    const { error } = await db().from('waitlist_signups').upsert(row, { onConflict: 'feature,user_id' });
    if (error) {
      console.error('[waitlist] signup failed', error.code);
      return res.status(503).json({ error: 'try_again' });
    }
    return res.status(200).json({ joined: true });
  }
  return res.status(ok ? 200 : 202).json({ counted: ok });
}

async function logTap({ feature, action, surface, src, ip, signedIn }) {
  const { error } = await db().from('waitlist_taps').insert({
    feature, action, surface, src: src || null, visitor: visitorHash(ip), signed_in: signedIn,
  });
  if (error) console.error('[waitlist] tap insert failed', error.code);
  return !error;
}
