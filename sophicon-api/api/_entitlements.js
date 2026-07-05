// ═══════════════════════════════════════════════════════════════════
// api/_entitlements.js — per-endpoint tier policy + seeker rate limits.
//
// Rollout is controlled by ENFORCE_ENTITLEMENTS:
//   off  — no checks at all (pre-migration behavior)
//   warn — evaluate + console.warn violations, never block (default)
//   hard — enforce with 401/403/429
//
// Policy (two tiers, seeker ⊂ sage):
//   speak / transcribe   seeker+anon: Enki persona only, 5/day; sage: all
//   sage-only            symposium, photo-reflection, extract-memory,
//                        aphorica-classify, community-submit,
//                        become-philosopher, sprite-*
//   sage (client-local   weekly-overview, actions, problems
//   fallback for seeker)
//   open                 community/feed, get-quote, health, glasses-link
// ═══════════════════════════════════════════════════════════════════

import { kv } from '@vercel/kv';
import { identify } from './_auth.js';

const SEEKER_SPEAK_PER_DAY = 5;
const SEEKER_PERSONA = 'enki';

const SAGE_ONLY = new Set([
  'symposium', 'photo-reflection', 'extract-memory', 'aphorica-classify',
  'community-submit', 'become-philosopher', 'sprite',
  'weekly-overview', 'actions', 'problems',
]);

function mode() {
  const m = (process.env.ENFORCE_ENTITLEMENTS || 'warn').toLowerCase();
  return m === 'off' || m === 'hard' ? m : 'warn';
}

/**
 * Gate an endpoint. Returns the identity (or an anonymous stub) when the
 * call may proceed; sends the response and returns null when blocked.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} feature - policy key, e.g. 'speak', 'symposium'
 * @param {{ persona?: string }} [opts] - persona name for speak/transcribe checks
 * @returns {Promise<{ userId: string|null, tier: string, scope: string } | null>}
 */
export async function requireEntitlement(req, res, feature, opts = {}) {
  const m = mode();
  if (m === 'off') return { userId: null, tier: 'seeker', scope: 'user' };

  const id = await identify(req);
  const tier = id?.tier || 'seeker';
  const who = id?.userId || anonKey(req);

  let violation = null;

  if (tier !== 'sage') {
    if (SAGE_ONLY.has(feature)) {
      violation = { status: 403, error: 'sage_required', feature };
    } else if (feature === 'speak') {
      // transcribe is deliberately NOT counted — a voice turn hits
      // transcribe then speak, and must burn exactly one unit.
      const persona = (opts.persona || '').toLowerCase();
      if (persona && persona !== SEEKER_PERSONA) {
        violation = { status: 403, error: 'sage_required', feature: 'speak_all_philosophers' };
      } else {
        const over = await overDailyLimit(who);
        if (over) violation = { status: 429, error: 'daily_limit', limit: SEEKER_SPEAK_PER_DAY };
      }
    }
  }

  if (!violation) return id || { userId: null, tier: 'seeker', scope: 'user' };

  if (m === 'warn') {
    console.warn(`[entitlements] would block: ${JSON.stringify({ ...violation, who, tier })}`);
    return id || { userId: null, tier: 'seeker', scope: 'user' };
  }

  res.status(violation.status).json({
    error: violation.error,
    feature: violation.feature,
    upgrade: 'https://enkiridion.com/pricing',
  });
  return null;
}

function anonKey(req) {
  const deviceId = req.headers['x-device-id'];
  if (deviceId) return `dev:${deviceId}`;
  const fwd = req.headers['x-forwarded-for'];
  return `ip:${(Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || 'unknown'}`;
}

async function overDailyLimit(who) {
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${who}:${day}`;
  try {
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, 86400);
    return n > SEEKER_SPEAK_PER_DAY;
  } catch {
    return false; // KV outage must never take Speak down
  }
}
