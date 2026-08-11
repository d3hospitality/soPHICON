# The glasses display, page by page

A review of every page and state the G2 surface can be in, and the
contextual menu each one carries as of 1.6.0 (SDK 0.0.14, firmware 2.2.9).

Grounded in `src/pages.ts` (builders), `src/events.ts` (state + routing),
verified in the simulator 2026-08-11. The input vocabulary is four
gestures — tap, double-tap, scroll up, scroll down — plus, new in this
release, **tap-and-hold** for the contextual menu (one fast tap, then
hold; a plain long press does NOT open it).

## Menu design rules used throughout

- **Verbs only.** Action items give no state feedback, so every label is
  a command, never a setting. (Per the early-access doc: "Night mode"
  feels broken; "Switch to night" does not.)
- **≤ 4 items per page.** The limit is 10; a glance-tier surface should
  come nowhere near it.
- **Stable global itemIDs.** One ID means one command everywhere it
  appears, so the handler is a single switch with no per-page ambiguity.
- **Labels come from the dictionary** (`g.menu*`), translated into all 6
  languages, and validated at build time to ≤ 32 UTF-8 bytes (CJK ≈ 10
  glyphs). An over-long label would reject the WHOLE page and blank the
  glasses, so `translate_ui.mjs` refuses to ship one and the `menu()`
  helper in pages.ts byte-truncates as a last-resort runtime guard.
- **Every non-home page carries "Go home".** Deep navigation previously
  required chained double-taps; the menu makes escape O(1) from anywhere.

### Global itemID registry

| ID | Command | Appears on |
|---|---|---|
| 1 | Go home | every page except home |
| 2 | Surprise me (random quote, whole corpus) | home, philosophies, philosophers, mindstate, quote |
| 3 | Save to favorites | quote |
| 4 | Speak with this philosopher | quote |
| 5 | End conversation | speak-conversation |
| 6 | Refresh feed | aphorica, aphorica-read |
| 7 | Read the dev story | home |
| 8 | New mindful quote | mindful-blank, mindful-quote |
| 9 | Open tip jar on phone | support |
| 10 | Restart story | support |

IDs are never reused for different meanings. New commands take new IDs.

---

## HOME

**Shows** four-row menu (enkiSPEAKS · Public Aphorica · Philosophies ·
● Support the dev) centred left; 200×200 dithered ENKI mark right;
wordmark under the mark; glance line (today's cockpit state) along the
bottom, dimmed to brightness 3.

**State** `currentPage === "home"`. The list is the capture container.

**Gestures** scroll moves the firmware cursor · tap opens the row ·
double-tap raises the system exit dialog.

**Menu** `Surprise me · Read the dev story`

*Why:* home's list is navigation; the menu carries the two things that
aren't destinations. Surprise-me is the single best use of the feature
on this app — a random quote from all 2,801 previously took four taps
and a scroll; now it is tap-hold → select from anywhere.

**Review notes** The exit double-tap is required by store review (the
"double-tap yields no response" rejection) — the menu must NOT carry an
"Exit" verb, since `shutDownPageContainer(1)` from a menu event would
bypass the confirm dialog's context.

---

## PHILOSOPHIES (tradition list)

**Shows** the 8 quote-bearing traditions + Back, same furniture as home
(list left, mark right, title bottom-right).

**State** `currentPage === "traditions"`.

**Gestures** scroll · tap selects tradition (or Back) · double-tap home.

**Menu** `Surprise me · Go home`

**Review notes** Tradition names come through `tMeta` (Stoizismus,
斯多葛主义). The Back row predates the menu and stays — a row costs
nothing and not everyone will find tap-and-hold.

---

## PHILOSOPHERS (quote browse select)

**Shows** `▶ NAME ◀` navpad windowed to 7, split 200×200 portrait
pushed for the hovered philosopher, live sprite preview on scroll.

**State** `currentPage === "philosophers"` + `currentTradition`,
`picksSelectedIndex`.

**Gestures** scroll cycles + repaints the portrait (BLE-throttled) ·
tap selects · double-tap back.

**Menu** `Surprise me · Go home`

**Review notes** The sprite preview push is serialized (concurrent
`updateImageRawData` crashes the BLE link) — the menu handler must not
push images while a preview is in flight; Surprise-me and Go-home both
land on pages that push their own art through the existing serialized
path, so this is safe by construction.

---

## MINDSTATE (emotion filter)

**Shows** `Shuffle All (159)` + per-emotion rows with counts, portrait
right. Since 1.5.4 the emotion names are translated (信念, 惊奇…).

**State** `currentPage === "mindstate"` + `currentPhilosopher`.

**Menu** `Surprise me · Go home`

**Review notes** This page is a filter, and filters are the one thing
the action-item model cannot express (no checked state). Correctly, the
menu does not try — selection stays on the page rows.

---

## QUOTE VIEW

**Shows** the quote (framed in quotation marks), split portrait
top-left, info strip: position/progress bar/emotion, philosopher +
source, rarity + rating stars, tag row — all through `tMeta`.
Auto-rotates every 33 s.

**State** `currentPage === "quote"` + `currentPhilosopher`,
`currentQuotes`, `currentQuoteIndex`; auto-rotate timer.

**Gestures** scroll = next/prev quote · tap = reshuffle · double-tap
back.

**Menu** `Save to favorites · Speak with this philosopher · Surprise me
· Go home`

*Why:* the two high-value commands here were previously impossible or
buried. **Favorites existed in code (`favorites.ts`, and the ♥ mark
renders in the info strip) but no gesture could reach toggle** — tap
was taken by reshuffle. The menu finally connects it. **Speak-with-this-
philosopher is the cross-mode jump**: reading Epictetus and wanting to
talk to him used to mean double-tap ×3, then Speak → Stoicism →
Epictetus. Now it is one menu selection; the handler carries the
philosopher straight into `startConversation`.

**Review notes** After a favorite toggle the info strip repaints via
`textContainerUpgrade` (♥ appears/disappears) — the menu itself shows
nothing, per the action-item contract.

---

## SPEAK: TRADITIONS · SPEAK: PHILOSOPHERS

**Shows** tradition list (all 9, including Primordial/Enki) · then the
navpad + portrait select, same pattern as browse.

**State** `speak-traditions` / `speak-philosophers` + `speakTradition`,
`speakSelectedIndex`.

**Menu** `Go home`

**Review notes** Thin menus are deliberate: these are transit pages.
Adding Surprise-me here would jump modes (browse, not speak) and make
the command mean different things in different places.

---

## SPEAK: CONVERSATION

**Shows** ghost mood layer (dithered emotion sprite behind text), the
rolling exchange (420-char pages, 940-byte cap), status line, controls
list `[↑ · Speak/Stop · ↓]`.

**State** `speak-conversation` + `speakPhilId`, conversation history,
recording state, deferred emotion-sprite timer.

**Gestures** tap = mic toggle · scroll = page history · double-tap =
back (checkpoints the session).

**Menu** `End conversation · Go home`

*Why:* ending a conversation cleanly (checkpoint → journal) previously
lived only on double-tap, which also means "back" everywhere else —
users report accidental exits. An explicit verb removes the ambiguity.
Go-home from mid-conversation checkpoints first, then leaves.

**Review notes** This page consumes the mic; the menu gesture
(tap-and-hold) and mic-toggle (tap) coexist per the early-access doc,
but this is the page to watch on real hardware — a fast tap that opens
the menu instead of toggling the mic mid-recording would be the worst
failure. Flagged for the Discord feedback loop.

---

## MINDFUL: BLANK · MINDFUL: QUOTE

**Shows** nothing (deliberate blank-lens rest state) · or a single
centred quote with source, no chrome.

**State** `mindful-blank` / `mindful-quote` + interval timers.

**Menu** `New mindful quote · Go home`

*Why:* the blank state had NO affordance at all — a wearer who forgot
the gesture had a dead lens. The menu is the escape hatch that costs
zero pixels, which is exactly right for this page: the surface stays
empty until asked.

---

## APHORICA (member list) · APHORICA: READ

**Shows** community authors as `@handle · SAGE (n)` navpad · then one
member's posts with votes and profile-insight strip.

**State** `aphorica` / `aphorica-read` + `aphAuthors`, cursor indices.
Data is fetched once on entry; no TTL.

**Menu** `Refresh feed · Go home`

*Why:* the feed could previously go stale for an entire session — the
only refresh was leaving and re-entering. Refresh re-runs
`openAphorica` (list) or re-fetches in place (read), preserving the
author cursor when the author still exists.

---

## SUPPORT (the dev story)

**Shows** 8 authored pages, one screen each, header with position
(`1/8`), pager footer dimmed to brightness 2.

**State** `support` + `supportPageIndex`.

**Gestures** tap = next (wraps) · swipe = prev/next · double-tap home.

**Menu** `Open tip jar on phone · Restart story · Go home`

*Why:* the phone latch previously fired only on page entry; if the
phone consumed it while the wearer kept reading, there was no second
chance without re-entering. "Open tip jar on phone" re-arms it
explicitly — the glass still never takes money, it just carries intent
across the gap on demand.

---

## FAVORITES (1.7.0)

**Shows** each saved quote through the quote-view layout (portrait, info
strip with ♥, position `i/n`), newest save first. Empty state: a single
explanatory line. Texts that no longer match the corpus (regenerated
quotes) are held out of the pager but stay in the store, the phone
Picks tab, and the calendar history.

**Menu** `Speak with this philosopher · Remove from favorites · Go home`

**Review notes** Favorites are ONE store for both surfaces since 1.7.0
(`enki_favorites_v2`, timestamped; the v2 suffix protects users running
a cached 1.5.x phone view, whose reader would destroy the new format).
Remove is remove, never toggle — a phone-side un-star while the pager
is open must not silently re-save. Cross-surface changes repaint the
open pager live.

## CALENDAR · DAYS · DAY (1.7.0)

**Shows** month overview as an equal-advance glyph grid (○ quiet ·
● activity · ◆ today — all measured 20px; a proportional '·' made
columns wander, and Latin weekday initials can never align, so there is
no weekday header), with active-day count and streak in the header. →
day list navpad (`11 · 1▶ 2♥`) → day detail, paged like the support
story. Swipe pages months / cycles days / pages entries; click drills
in; double-tap walks back up.

**Menu** `Go to today · Go home` on all three levels.

**Data** talks from `speak_journal`; saves and logs from the
`wisdom_log` — an APPEND-ONLY capture history (saves, logged replies,
likes), so un-favoriting later never rewrites the day you saved it.
Free-tier talks still leave no trace (checkpointing is entitlement-
gated) — captures are the free tier's visible history.

## Cross-cutting notes from this review

1. **Every create/rebuild return value is now checked** (wrapper in
   `Main.ts`). SDK 0.0.14 validates menus and brightness before the
   bridge; a silent `invalid` blanks the glasses and looks identical to
   a firmware fault. The wrapper logs the validation error loudly.
2. **The simulator cannot open the menu.** Its automation API has no
   tap-and-hold action (`up/down/click/double_click` only). What CAN be
   verified there: create/rebuild results are 0/true with menus
   attached, pages render unchanged, and `menuItemClickEvent` handling
   via direct event injection is NOT possible — handler logic is
   exercised by calling the same functions the gestures call. Menu
   open/select needs real hardware on firmware 2.2.9.
3. **textColor brightness (0–4)** is used for hierarchy, not decoration:
   support pager = 2, home glance = 3, everything content-bearing stays
   at the default 4. Historical note: passing `textColor` on SDK 0.0.12
   rejected the whole page — the D3 Container Editor's generated layout
   files still carry hex `textColor: 'FFFFFF'` junk fields, which never
   reach the bridge because `geo()` strips to geometry. Do not start
   spreading layout objects into containers.
4. **Long-press split events** (`LONG_PRESS_EVENT`/`RELEASE`, PB 9/10)
   are not consumed anywhere in this app — no migration needed. If a
   hold interaction is ever added, remember a stray release with no
   press must be a no-op.
