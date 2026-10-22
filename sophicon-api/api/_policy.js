// ═══════════════════════════════════════════════════════════════════
// api/_policy.js — PURE capability policy for every billable route.
// No I/O here, so it is unit-testable (see sophicon-api/test/).
//
// PR01 (SEC-01/02). Rules:
//   • Unknown feature → deny. A new billable route must be added here.
//   • Anonymous callers are keyed by IP only. X-Device-Id is
//     client-chosen, so it is never trusted to identify an anon user.
//   • Limits below are INTERIM SAFETY CAPS to stop unbounded spend,
//     not the commercial offer. The approved plan (PRD §7) replaces them.
//   • null for a tier = that tier may not call the feature at all.
// ═══════════════════════════════════════════════════════════════════

export const POLICY = Object.fromEntries([
 'speak','transcribe','tts','day-insight','next-move','symposium','photo-reflection','extract-memory','weekly-overview','actions','problems','aphorica-classify','aphorica-post','community-submit','become-philosopher','sprite'
].map(feature=>[feature,{
 anon:['speak','transcribe','tts','next-move'].includes(feature)?{perMinute:6}:null,
 seeker:{perMinute:feature==='sprite'?2:10},sage:{perMinute:feature==='sprite'?2:10}
}]));

/** Global ceiling on ALL anonymous calls to a feature per UTC day (demo budget). */
export const ANON_GLOBAL_PER_DAY = { speak: 300, transcribe: 300 };

/**
 * Decide whether a call may proceed (before any quota counting).
 * @param {string} feature
 * @param {{ tier?: string, isAnon: boolean, persona?: string }} ctx
 */
export function evaluate(feature, ctx) {
  const policy = POLICY[feature];
  if (!policy) return { allow: false, status: 403, error: 'unknown_feature', feature };

  const bucket = ctx.isAnon ? 'anon' : (ctx.tier === 'sage' ? 'sage' : 'seeker');
  const rule = policy[bucket];

  if (!rule) {
    return ctx.isAnon
      ? { allow: false, status: 401, error: 'auth_required', feature }
      : { allow: false, status: 403, error: 'sage_required', feature };
  }

  if (rule.personas) {
    const persona = String(ctx.persona || '').toLowerCase();
    if (!rule.personas.includes(persona)) {
      return { allow: false, status: 403, error: 'sage_required', feature: `${feature}_all_philosophers` };
    }
  }
  return { allow: true, rule, bucket };
}

/** Quota key. Identity must come from a verified token or the IP, never the body. */
export function quotaKey(feature, who, day) {
  return `rl2:${feature}:${who}:${day}`;
}

/** Client IP from Vercel's forwarded header (first hop). */
export function clientIp(headers) {
  const fwd = headers['x-vercel-forwarded-for'] || headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || headers['x-real-ip'] || 'unknown';
}
