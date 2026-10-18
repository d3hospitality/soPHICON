// ═══════════════════════════════════════════════════════════════════
// api/_entitlements.js — per-endpoint tier policy + daily quotas.
//
// Rollout is controlled by ENFORCE_ENTITLEMENTS:
//   off  — no checks at all (pre-migration behavior)
//   warn — evaluate + console.warn violations, never block (default)
//   anon — enforce for ANONYMOUS callers only; signed-in callers are
//          warn-only. Closes anonymous spend without surprising paying
//          customers whose clients aren't all updated yet.
//   hard — enforce with 401/403/429/503
//
// PR01 changes (see _policy.js for the rules):
//   • Every feature must be listed in POLICY; unknown → deny.
//   • tts / transcribe / day-insight now have policies (they were open).
//   • Anonymous callers are keyed by IP only (X-Device-Id is spoofable)
//     and share a global per-feature demo budget.
//   • Quota-store outage fails CLOSED in hard mode (503, retryable),
//     instead of silently allowing unlimited spend.
// Identity comes only from a verified bearer token (see _auth.js).
// ═══════════════════════════════════════════════════════════════════

import { kv } from './_store.js'; // Supabase-backed (Vercel KV host is gone)
import { identify } from './_auth.js';
import { evaluate, quotaKey, clientIp, ANON_GLOBAL_PER_DAY } from './_policy.js';

function mode() {
  const m = (process.env.ENFORCE_ENTITLEMENTS || 'warn').toLowerCase();
  return m === 'off' || m === 'hard' || m === 'anon' ? m : 'warn';
}

const ANON = { userId: null, tier: 'seeker', scope: 'user' };

/**
 * Gate an endpoint. Returns the identity (or an anonymous stub) when the
 * call may proceed; sends the response and returns null when blocked.
 *
 * @param {import('http').IncomingMessage} req
 * @param {import('http').ServerResponse} res
 * @param {string} feature - policy key, e.g. 'speak', 'symposium'
 * @param {{ persona?: string }} [opts] - server-resolved persona id for speak
 */
export async function requireEntitlement(req, res, feature, opts = {}) {
  // The published chat allowance is enforced in every rollout mode.
  const m = feature === 'speak' ? 'hard' : mode();

  let id = null;
  try { id = await identify(req); } catch { id = null; }

  if (m === 'off') return id || ANON;

  const isAnon = !id?.userId;
  let violation = null;
  let remaining;

  const decision = evaluate(feature, { tier: id?.tier, isAnon, persona: opts.persona });
  if (!decision.allow) {
    violation = decision;
  } else {
    const who = isAnon ? `ip:${clientIp(req.headers)}` : `u:${id.userId}`;
    const day = new Date().toISOString().slice(0, 10);
    const q = await consume(quotaKey(feature, who, day), decision.rule.perDay);
    remaining = Math.max(0, decision.rule.perDay - (q.count || 0));
    if (q.status === 'unavailable') {
      violation = { status: 503, error: 'quota_unavailable', retryable: true };
    } else if (q.status === 'over') {
      violation = { status: 429, error: 'daily_limit', limit: decision.rule.perDay };
    } else if (isAnon && ANON_GLOBAL_PER_DAY[feature]) {
      const g = await consume(quotaKey(feature, 'anon-global', day), ANON_GLOBAL_PER_DAY[feature]);
      if (g.status === 'unavailable') violation = { status: 503, error: 'quota_unavailable', retryable: true };
      else if (g.status === 'over') violation = { status: 429, error: 'demo_busy', signin: true };
    }
  }

  if (!violation) return { ...(id || ANON), remaining };

  if (m === 'warn' || (m === 'anon' && !isAnon)) {
    console.warn(`[entitlements] would block: ${JSON.stringify({ ...violation, feature, anon: isAnon, tier: id?.tier || 'seeker' })}`);
    return id || ANON;
  }

  res.status(violation.status).json({
    error: violation.error,
    feature: violation.feature || feature,
    limit: violation.limit,
    remaining: violation.error === 'daily_limit' ? 0 : undefined,
    retryable: violation.retryable || undefined,
    upgrade: violation.status === 403 || violation.status === 429 ? 'https://enkiridion.com/pricing' : undefined,
  });
  return null;
}

/** Atomically reserve one use before calling the model. */
async function consume(key, limit) {
  try {
    const n = await kv.incr(key);
    if (n === 1) await kv.expire(key, 86400);
    return { status: n > limit ? 'over' : 'ok', count: n };
  } catch {
    return { status: 'unavailable' };
  }
}
