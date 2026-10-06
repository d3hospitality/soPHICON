// ═══════════════════════════════════════════════════════════════════
// plans.ts — the one place the offer lives on the glasses app.
//
// Mirrors enkispeaks-web lib/plans.js (the website is the source of
// truth: Stripe resolves the real price there). Every phone screen and
// glass page that mentions a price or a link reads from here, so the
// next price change is one edit instead of a hunt through copy.
// ═══════════════════════════════════════════════════════════════════

export const PLAN = {
  monthly: '$5.99',
  yearly: '$49.99',
  trialDays: 7,
  sageRepliesPerDay: 20,
  freeRepliesPerDay: 1,
} as const;

/** "$5.99 a month or $49.99 a year" */
export const PRICE_LINE = `${PLAN.monthly} a month or ${PLAN.yearly} a year`;

/** Sign in (if needed) → Stripe checkout → land on Settings, where the
 *  G2 pairing code is. The Even webview can't run Google sign-in, so the
 *  wearer opens this in their phone's browser. */
export const TRIAL_URL = 'https://enkiridion.com/start?plan=sage_monthly&next=%2Fsettings';
/** Free account only: sign in and get a pairing code. */
export const SETTINGS_URL = 'https://enkiridion.com/settings';
