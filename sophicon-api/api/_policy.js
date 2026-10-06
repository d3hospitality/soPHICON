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

const ENKI_ONLY = ['enki'];

export const POLICY = {
  // Speak: seekers and the public demo get Enki only.
  speak:               { anon: { perDay: 1, personas: ENKI_ONLY }, seeker: { perDay: 1, personas: ENKI_ONLY }, sage: { perDay: 20 } },   // Sage = 20 replies a day, as sold on enkiridion.com
  // A voice turn = transcribe + speak. Speak is the unit that counts;
  // these caps only stop transcribe being used as a free Whisper proxy.
  transcribe:          { anon: { perDay: 3 },  seeker: { perDay: 5 },  sage: { perDay: 120 } },
  tts:                 { anon: null,           seeker: { perDay: 3 },  sage: { perDay: 60 } },
  'day-insight':       { anon: null,           seeker: { perDay: 1 },  sage: { perDay: 20 } },
  // One next step at the end of a talk (gpt-4o-mini, ~200 tokens). Free
  // talks with Enki get a move too: the path is the reason to come back.
  'next-move':         { anon: { perDay: 2 },  seeker: { perDay: 5 },  sage: { perDay: 60 } },
  // Sage-only
  symposium:           { anon: null, seeker: null, sage: { perDay: 10 } },
  'photo-reflection':  { anon: null, seeker: null, sage: { perDay: 10 } },
  'extract-memory':    { anon: null, seeker: null, sage: { perDay: 60 } },
  'weekly-overview':   { anon: null, seeker: null, sage: { perDay: 10 } },
  actions:             { anon: null, seeker: null, sage: { perDay: 30 } },
  problems:            { anon: null, seeker: null, sage: { perDay: 30 } },
  // Aphorica stays active: seekers get their one daily aphorism graded.
  'aphorica-classify': { anon: null, seeker: { perDay: 3 }, sage: { perDay: 30 } },
  // Posting stays open to every signed-in member; the cap only bounds the
  // (cheap) server-side grading + moderation call each post triggers.
  'aphorica-post':     { anon: null, seeker: { perDay: 3 }, sage: { perDay: 30 } },
  'community-submit':  { anon: null, seeker: null, sage: { perDay: 20 } },
  'become-philosopher':{ anon: null, seeker: null, sage: { perDay: 5 } },
  sprite:              { anon: null, seeker: null, sage: { perDay: 5 } },
};

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
  const fwd = headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim();
  return first || headers['x-real-ip'] || 'unknown';
}
