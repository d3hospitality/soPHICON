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
import { INTRO_COUNT, STORY_SECTIONS } from './story';

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
// Pagination is modelled in LINES, not characters.
//
// A character budget looked right and shipped overflow: a Chinese page
// packed three paragraphs, and every paragraph break costs a blank line
// the char count never saw, so the last line collided with the pager
// and LVGL drew its scrollbar stub. Overflow on this panel is never
// clipped and never errors, so that stub is the only warning you get.
//
// The body is 210px = 7 lines at the firmware's 27px line height.
// CHARS_PER_LINE is measured against the 528px body: Latin ~55, German
// and Russian ~46 (longer words waste more of each line), CJK ~26
// glyphs at 20px each.
const BODY_LINES = 7;
const CHARS_PER_LINE: Record<string, number> = { zh: 26, ja: 26, de: 46, ru: 46 };
const CHARS_PER_LINE_DEFAULT = 55;

/** The story as one page of pre-wrapped text per entry.
 *
 * Lines are wrapped HERE, not left to the firmware, and joined with
 * explicit newlines. That makes page height deterministic: the panel
 * renders exactly the lines it is given instead of re-flowing them and
 * silently pushing the last one under the pager.
 *
 * Text flows like a book. An earlier version packed whole paragraphs
 * and refused to split them, which stranded short ones on their own
 * page ("A bootleg engineer." alone on 4/36 with six blank lines under
 * it). Paragraphs may now continue across a page break; the blank line
 * between them is preserved so the structure still reads.
 */
export function supportStoryPages(): string[] {
  const cpl = CHARS_PER_LINE[glassLang()] ?? CHARS_PER_LINE_DEFAULT;

  /** Word-aware wrap for spaced scripts; hard cut for CJK, which has no
   *  spaces to break on. */
  const wrap = (text: string): string[] => {
    const out: string[] = [];
    let rest = text.trim();
    while (rest.length > cpl) {
      let cut = rest.lastIndexOf(' ', cpl);
      if (cut <= 0 || cut < cpl * 0.5) cut = cpl;   // CJK / very long token
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
    return out.length ? out : [''];
  };

  // Reading order: opening paragraphs, then each section under its
  // title. Titles are upper-cased here; the phone does it in CSS, which
  // the glass has no equivalent for.
  const blocks: string[] = [];
  for (let i = 1; i <= INTRO_COUNT; i++) {
    blocks.push(tGlass(`story.i${String(i).padStart(2, '0')}` as DictKey));
  }
  for (const sec of STORY_SECTIONS) {
    blocks.push(`— ${tGlass(`${sec.id}.t` as DictKey).toUpperCase()} —`);
    for (let i = 1; i <= sec.paras; i++) {
      blocks.push(tGlass(`${sec.id}.p${String(i).padStart(2, '0')}` as DictKey));
    }
  }

  // Flatten to a single stream of rendered lines, blank line between
  // blocks.
  const lines: string[] = [];
  blocks.forEach((b, i) => {
    if (i > 0) lines.push('');
    lines.push(...wrap(b));
  });

  // Chunk into pages, never opening a page on a blank line.
  const pages: string[] = [];
  for (let i = 0; i < lines.length;) {
    while (i < lines.length && lines[i] === '') i++;
    if (i >= lines.length) break;
    pages.push(lines.slice(i, i + BODY_LINES).join('\n').replace(/\s+$/, ''));
    i += BODY_LINES;
  }
  return pages.length ? pages : [''];
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
