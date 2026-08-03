// ═══════════════════════════════════════════════════════════════════
// Support the dev — tipping surface.
//
// One loud object on the phone's Home surface, one page behind it, one
// hosted checkout. Explicit NON-goals: no paywall, no feature gating,
// no upsell, no subscription, no "N free uses left". Nothing about
// enkiRIDION's behaviour changes whether or not anyone tips. If a
// future change makes that sentence false, this whole surface should
// come out rather than be reworded.
//
// Copy lives in letter.ts. This file is the wiring + the gates.
// ═══════════════════════════════════════════════════════════════════

import { tGlass, glassLang } from './i18n';
import type { DictKey } from './locales/en';

// ─── THE DEAD-BUTTON GATE ────────────────────────────────────────────
// Empty ⇒ the pill, the phone page, AND the on-glass row all disappear.
// The app must never render a button that goes nowhere, so every entry
// point checks supportEnabled() rather than assuming this is filled.
//
// TO FILL: create a Stripe payment link of type "Customers choose what
// to pay" (suggested amount on, minimum on, NO maximum, no shipping, no
// quantity adjuster, Stripe's own hosted thanks page), then COPY THE URL
// OUT OF THE DASHBOARD DOM. Never retype or OCR a payment URL — one
// wrong character routes real money to nothing.
export const SUPPORT_URL: string = 'https://buy.stripe.com/00w4gs9Rh46Jb4y1E1bAs01';

// ─── CRYPTO (display only) ───────────────────────────────────────────
// An address and a tap-to-copy, nothing more. No wallet connection, no
// signature request, no transaction building: a static receive address
// has no attack surface, a wallet integration has plenty and needs an
// audit nobody is paying for.
//
// These are PUBLIC keys, so they belong in a committed constant rather
// than .env.local — a gitignored env file means another machine builds
// the app with the addresses missing, and VITE_-prefixed vars get
// inlined into the client bundle anyway, so an env file buys no privacy.
//
// TO FILL: paste the FULL address (never a truncated 6igpBg…VPdu display
// form) and checksum-verify it offline first:
//     node scripts/addrcheck.js <address>
// EVM must keep its EIP-55 mixed case — the case IS the checksum, so
// never lowercase it. A send is irreversible; an unverified address here
// is a silent hole in the floor.
export type CryptoAddress = {
  /** Shown to the user, e.g. "Solana". */
  label: string;
  /** Which verifier applies — see scripts/addrcheck.js. */
  kind: 'sol' | 'evm' | 'btc';
  /** Full address. Empty ⇒ this row is not rendered. */
  address: string;
};

// Ethereum and Base are deliberately the SAME string: Base is an EVM
// chain, so it is one keypair on two networks. Not a copy-paste slip.
//
// All four verified offline on 2026-08-02 with scripts/addrcheck.js:
//   SOL  base58 → exactly 32 bytes
//   EVM  EIP-55 checksum valid (the mixed case IS the checksum)
//   BTC  bech32 checksum valid, segwit v0, mainnet
export const CRYPTO: CryptoAddress[] = [
  { label: 'Solana',   kind: 'sol', address: '6igpBgPodK9pAcEYctSj2GsQPR2DUeJgLUo4WwWCVPdu' },
  { label: 'Ethereum', kind: 'evm', address: '0x03052A993fa7eC2fa74234b5ea5dA18dAd31147D' },
  { label: 'Base',     kind: 'evm', address: '0x03052A993fa7eC2fa74234b5ea5dA18dAd31147D' },
  { label: 'Bitcoin',  kind: 'btc', address: 'bc1qe7hcjt7wx88yd0dt5p3as5fzjezwyjp27rc9rp' },
];

// ─── GATES ───────────────────────────────────────────────────────────

/** True when there is a real destination to send someone to. */
export function supportEnabled(): boolean {
  return SUPPORT_URL.trim().length > 0;
}

/** Only addresses that have actually been filled in. */
export function activeCrypto(): CryptoAddress[] {
  return CRYPTO.filter(c => c.address.trim().length > 0);
}

// ─── THE PILL ────────────────────────────────────────────────────────
// Two lines, all caps. Line 1 is the disclosure — a fact about who made
// this, offered before the ask. Line 2 never changes.
export const PILL_LINE_1 = 'BUILT BY A BOOTLEG ENGINEER.';
export const PILL_LINE_2 = 'SUPPORT THE DEV. →';

// ─── ON-GLASS ────────────────────────────────────────────────────────
// The glasses allow exactly ONE isEventCapture container per page, so a
// separate tappable Support widget is impossible — the entry has to be a
// row inside the home page's existing firmware list. '●' is from the
// firmware-safe symbol set; anything outside it is silently dropped.
export const SUPPORT_ROW = '● Support the dev';

// ═══ THE ON-GLASS STORY ═════════════════════════════════════════════
// The glass gets the SAME story as the phone, paginated, rather than a
// one-screen summary. It reads linearly: opening, then each section
// under its title.
//
// Pagination is by CHARACTER BUDGET, not by measured pixels, because
// @evenrealities/pretext is a build-time tool and is not in the bundle.
// The budget is per-language because a CJK glyph is 20px wide against
// roughly 8px for Latin, so an English-tuned budget would overflow in
// Chinese. Overflow on this panel is NOT clipped and raises no error:
// the text wraps and the extra lines are simply cut off by the
// container height, so a too-generous budget silently eats content.
// These numbers are deliberately conservative.
// The glass story is EIGHT AUTHORED PAGES, one screen each.
//
// It is deliberately not the phone story paginated. The glass is the
// glance tier (docs/TRANSLATION-SYSTEM.md) and it cannot take money at
// all, so its whole job is to earn attention and hand off. An earlier
// version flowed the full letter into 33 pages, which turned a glance
// surface into a 33-click commitment and put the ask on page 30.
//
// Each key is exactly one page. Nothing is packed or split at runtime,
// so what an author writes is what a wearer sees, and page count never
// drifts by language. The 7-line fit is enforced at build time by
// scripts/translate_ui.mjs, per language.
const GLASS_STORY_KEYS = [
  'g.story1', 'g.story2', 'g.story3', 'g.story4',
  'g.story5', 'g.story6', 'g.story7', 'g.story8',
] as const;

/** Hard ceiling. If someone adds a ninth key, the glass still shows 8. */
export const GLASS_MAX_PAGES = 8;

export function supportStoryPages(): string[] {
  return GLASS_STORY_KEYS.slice(0, GLASS_MAX_PAGES).map(k => tGlass(k as DictKey));
}

export function supportPageCount(): number { return supportStoryPages().length; }

// ─── THE PHONE LATCH ─────────────────────────────────────────────────
// Nothing on the glasses can foreground the phone app — there is no SDK
// call for it, and the webview is backgrounded while the wearer is on
// glass. So the on-glass row does two things: it opens the glass page,
// and it sets this latch. The dashboard consumes the latch on its next
// refresh — opening the Support page immediately if the phone is in
// hand, waiting quietly if it's in a pocket.
export const SUPPORT_LATCH_KEY = 'app.showSupport';
