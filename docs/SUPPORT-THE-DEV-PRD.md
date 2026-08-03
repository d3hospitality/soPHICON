# PRD — "Support the dev" tipping surface (enkiRIDION)

**Status:** shipped in 1.5.2 · **Surfaces:** phone webview + G2 glasses
**Reference implementation:** this repo. Every file path below is real.

This is the enkiRIDION version of the pattern. It started from the TEMPO
PRD and diverged in four places that mattered; those divergences are
marked **DIFFERS FROM TEMPO** and each one has a reason.

---

## 0. Configuration

| Field | Value |
|---|---|
| App | enkiRIDION (`com.d3hospitality.sophicon`) |
| Repo | `~/Desktop/d3-apps/soPHICON ER-G2` |
| Surfaces | phone webview · G2 glasses display |
| Pill line 1 | `BUILT BY A BOOTLEG ENGINEER.` |
| Pill line 2 | `SUPPORT THE DEV. →` (never changes) |
| Stripe link | `https://buy.stripe.com/00w4gs9Rh46Jb4y1E1bAs01` |
| Crypto | SOL / ETH / Base / BTC, display-only |

---

## 1. Goal and non-goals

Ask for money without turning a free-to-start tool into a funnel. One
loud object on the phone's home surface, one page behind it, one hosted
checkout.

**Non-goals.** No paywall, no feature gating, no upsell, no recurring
subscription *created by this surface*, no "you have N free uses left".
Nothing about the app's behaviour changes whether or not someone tips.
No wallet connection.

**A non-goal that is NOT inherited from TEMPO.** TEMPO could say "there
is no subscription" because TEMPO is free. enkiRIDION has a real $8/mo
Sage tier with real gates. The rule here is therefore narrower and
harder: *this surface* must grant nothing, and the copy must never imply
the app as a whole is free. Getting this wrong is the single worst
failure mode available — a support page that misdescribes the product
destroys the trust it exists to earn.

**Ship order.** pill → phone page → Stripe link → crypto → glass. Each
stage works alone and is a valid stopping point. Glass goes last because
it is the stage that adds a payments domain to the manifest whitelist,
and that diff should be isolated for review.

---

## 2. The two doors

Both doors lead to the same place, and only one of them can take money.

**Phone door.** The red-and-gold pill at the bottom of Today →
Support page. Direct.

**Glass door.** `● Support the dev`, last row of the home list. Tapping
it does two things at once:

```
1. rebuildPageContainer(buildSupportPage(0))   the glass story opens
2. bridge.setLocalStorage('app.showSupport', <timestamp>)   a latch
```

The wearer reads the story on glass. **The glasses never take money.**
When the phone is next picked up, the dashboard sees the latch, clears
it, and opens the Support view — where the buttons are.

**The insight that makes this recreatable:** no SDK call can foreground
the phone app, so the glass surface *physically cannot* complete a
transaction. Once you accept that, the design writes itself. The glass
earns attention, the phone converts it, and a latch carries intent
across the gap. A glass row labelled "tap to pay" would be a lie.

Latch details: `SUPPORT_LATCH_KEY` in `src/support.ts`, consumed by
`consumeSupportLatch()` in `src/dashboard.ts`, 15-minute TTL. The TTL
matters — without it, opening the dashboard days later ambushes someone
with a tip jar they asked for on Tuesday.

---

## 3. The pill (phone)

Two lines, all caps, red with a gold rim, at the bottom of Home. It is
the only saturated object in the app and it deliberately does **not**
follow the theme: hardcoded literals, never palette tokens.

`button.supportline` in `src/style.css`, rendered by `initSupport()` in
`src/dashboard.ts`.

One trap: `display: flex` beats the `hidden` attribute, and `hidden` is
how the dead-button gate hides it. `button.supportline[hidden] { display: none }`
is load-bearing.

---

## 4. The phone page

Reachable **only** from the pill. There is no `.tab-btn` for it, so no
tab tap can land on it; the panel is `data-panel="support"` with no
matching button.

**DIFFERS FROM TEMPO:** TEMPO says "add `'support'` to the `TabId` union
and leave it out of `TAB_ORDER`". enkiRIDION has neither — tabs are
DOM-declared in `index.html` and wired by `initTabs()`. A panel with no
button is structurally unreachable, which achieves the same guarantee
with no code.

Order on the page:

1. mark
2. hook
3. **the Stripe button**
4. **the crypto pills**
5. the opening (always visible, never behind a tap)
6. eight stacked story cards
7. signature

**The actionable things come first.** Someone who arrived already
decided should not read 400 words to find the button; someone who wants
to read scrolls past it in two seconds.

**The cards.** Titles are `<button>`s; pressing one drops it open and
closes whichever was open. Single-open is deliberate — eight sections
open at once stops being a stack and becomes a wall.

Titles are stored in **natural case and uppercased in CSS**. A
hand-uppercased source string does not survive translation: German
capitalises nouns, Russian casing rules differ. `text-transform` is the
only version correct in all languages.

The letter is left-aligned inside a centred card. Centred body copy dies
after two lines.

---

## 5. The glass story

Eight authored pages, one screen each, `g.story1`…`g.story8` in
`src/locales/en.ts`.

**DIFFERS FROM TEMPO — and this is the one worth understanding.** TEMPO
says "page the letter, don't excerpt it". enkiRIDION tried that: the
full story flowed into **33 pages** (29 in Chinese). It was wrong on
three counts:

- The glass is the *glance* tier per `docs/TRANSLATION-SYSTEM.md` —
  roughly ten readable words at a time. A 33-page letter is the opposite
  of a glance.
- `1/33` reads as a deterrent, not an invitation.
- Page count drifted by language, so the ask landed in a different place
  depending on locale.

Eight authored pages fixed all three. Nothing is packed or split at
runtime, so what an author writes is exactly what a wearer sees, and the
count never drifts.

**Navigation.** The firmware allows exactly ONE `isEventCapture`
container per page, and its lists are vertical-only, so a horizontal
Back/Next button row is not buildable — three list rows would consume
120px of a 288px screen. Instead the body captures and navigation uses
the app's existing grammar:

```
click        next page (wraps)
swipe up     previous page
swipe down   next page
double-tap   back to Home
```

The footer states this in words and shows position, so it is
discoverable rather than folklore.

**Content rule.** Pure narrative. No subscription pitch, no cost
accounting, no justification for asking. The wearer tapped a row called
Support the dev; what earns that is the story. The case for the money
does not belong on a surface that cannot take money.

---

## 6. The Stripe link — HUMAN GATE

**Cannot be automated. Create it in the dashboard and paste the URL
back.**

- Type: **"Customers choose what to pay"** — the primitive for a tip.
- Suggested amount on, minimum on, **no maximum**. No shipping, no
  quantity adjuster. Stripe's own hosted thanks page.
- **Copy the URL out of the DOM.** Never retype it, never OCR it from a
  screenshot. One wrong character routes real money to nothing.

**The dead-button gate.** `SUPPORT_URL = ''` hides the pill, the phone
page **and** the on-glass row. Build this first and the app can never
ship a button that goes nowhere.

---

## 7. Crypto (display only)

An address and a tap-to-copy. **No wallet connection, no signature
request, no transaction building.** A static receive address has no
attack surface; a wallet integration has plenty and needs an audit
nobody is paying for.

**Addresses live in a committed constant, not `.env.local`.**

**DIFFERS FROM TEMPO:** the TEMPO build keeps them in gitignored
`.env.local`. That is wrong for public keys — a gitignored env file
means another machine builds with the addresses missing, and `VITE_`
vars are inlined into the client bundle anyway, so the env file buys no
privacy.

**Checksum-verify every address offline before shipping.** A send is
irreversible.

```bash
node scripts/addrcheck.js --from-support
```

Covers EIP-55 (EVM), bech32/bech32m (BTC), base58→32 bytes (SOL), and
rejects truncated display forms like `6igpBgPo…WwWCVPdu`. Zero
dependencies, no network. Its Keccak-256 self-tests against published
vectors: `node scripts/keccak.js --selftest`.

**Never lowercase an EVM address.** The mixed case *is* the checksum.
`addrcheck` rejects all-one-case for exactly this reason.

**The pill is the whole button.** `data-copy` holds the full address,
`title` reveals it, the span shows 8 chars each end. Two copy paths:
`navigator.clipboard` guarded by `isSecureContext`, with an
`execCommand` textarea fallback behind it — the Even App webview is not
guaranteed to be a secure context, and a tip address that silently fails
to copy is indistinguishable from a broken app. Both failure paths are
surfaced (`Copy failed`), never swallowed.

---

## 8. Localisation

Six languages: `en es pt de ru zh ja`. English is the source of truth in
`src/locales/en.ts`; the rest are generated into `public/i18n/<lang>.json`
and lazy-loaded from the pack, so switching never touches the network.

- Story pages route through a **higher-care prompt** than the rest of
  the UI (first person, wry, no added politeness formulas, factual
  claims preserved verbatim).
- `g.story*` pages are validated by **wrapped line count** against the
  528px body, per language, at build time. A translation that would
  overflow fails the key instead of shipping a clipped display.
- Rejected keys are **deleted**, not skipped, so the runtime genuinely
  falls back to English. Skipping leaves a previous run's value in place —
  that is how a stale over-wide Russian row survived a tightened budget.
- Orphaned keys are purged every run. 490 dead strings had accumulated
  across seven languages before that was added.

**Arabic was removed.** The G2 font has no Arabic glyphs — every
codepoint measures 0 advance width — and LVGL does no RTL shaping, so
glass text rendered as nothing. Phone-only would have meant a
"supported" language that is silently English on half the product. The
RTL plumbing is intentionally left in place.

**Even Hub does not accept `pt` or `ru`** in `supported_languages`; its
list is `en de fr es it zh ja ko`. Both work in the app's own picker —
that field is store metadata, not a runtime gate — they just cannot be
advertised.

---

## 9. Manifest + store review

```json
{
  "name": "network",
  "desc": "… An optional Support the dev page opens a Stripe-hosted tip page in your browser; it unlocks nothing, and none of your conversations, journal or account data is sent there.",
  "whitelist": ["…", "https://buy.stripe.com"]
}
```

Review reads the `desc`. Say what the domain is for.

**Adding a payments domain to a non-commerce app is a policy question
for the platform, not something code settles.** This app has already
been rejected once over an un-whitelisted URL. Push to the **Testing
group** first, and treat the Support surface as the first thing to pull
if review objects — `SUPPORT_URL = ''` removes it from both surfaces in
one line.

---

## 10. Firmware constraints discovered building this

These were all found on the simulator, and none of them raise an error.
They are the most transferable part of this document.

**Image containers are opaque and paint over text, regardless of
`zOrderIndex`.** A watermark *behind* copy cannot exist. Verified with
the list at z-order 7 and the image at 4 — the image still erased the
row text it covered. Anything that must be readable needs its own
rectangle.

**Text overflow is never clipped and never errors.** The text wraps and
the extra lines are cut off by the container height. The LVGL scrollbar
stub on the right edge is the only warning you get.

**List rows render ~380px wide, not the declared 528.** The selection
border box and padding eat ~120px. The naive `528 - 24` silently shipped
clipped text.

**Text containers cannot be right-aligned.** Only the box can be moved.

**List height must be a whole multiple of the 40px row pitch**, and
lists are vertical-only.

**Requested grey is discarded** — solid mid-grey thresholds to full
white. Dither density is the only available "dim".

**Line art dithers badly at low density.** 0.30 coverage with a 96px
blur ate the ENKI mark alive and left a smear of its densest core. Line
art has almost no mid-tones to sample; it needs high coverage (0.88) and
a sharp source.

**A box that letterboxes will letterbox.** A 200×44 container holding a
200×200 source shrinks it to a sliver with dead padding either side.

**Firmware-safe glyphs only** (`●○■□★☆▲▶◆✓✗·×—…` and friends). Anything
else is silently dropped. Curly apostrophe (U+2019, advance 80), curly
quotes and ellipsis are all present — but measure before using one, with
`@evenrealities/pretext`.

---

## 11. Acceptance checklist

- [x] Payment link created; URL copied from the DOM, not a screenshot
- [x] Every crypto address checksum-verified offline
- [x] Payment host in `app.json` whitelist + permission `desc`
- [x] `SUPPORT_URL = ''` hides pill, phone page **and** glass row
- [x] Support panel has no tab button; pill is the only entrance
- [x] Glass row is a row in the existing home list, `●` from the safe set
- [x] Glass story ≤ 8 pages, one screen each, fit-checked per language
- [x] Glass row sets the phone latch; dashboard consumes it with a TTL
- [x] Copy has two clipboard paths and surfaces failure
- [x] Verified in the G2 simulator, not just the browser
- [ ] **Submitted to the Testing group, not straight to production**
