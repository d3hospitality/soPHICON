# G2 UX Lab

A **dev-only** cockpit for designing the phone-webapp ↔ glasses experience as ONE
coherent enkiRIDION surface. The phone acts as the control surface; the G2 display
is the eye-level glance layer. Nothing here ships to users unless explicitly
promoted (see *Promotion path* below).

## Running lab mode

```bash
npm run dev                       # then open http://localhost:5173/?lab=1
# or
VITE_G2_UX_LAB=1 npm run dev      # lab always on for this dev server
# with the Even simulator:
evenhub-simulator -g http://localhost:5173/?lab=1
```

`#lab` also works as the flag **and** deep-links straight to the Lab tab
(the dashboard's existing hash-tab behavior picks it up).

Lab off = production behavior, byte-for-byte: every lab file is loaded via
dynamic `import()` behind `isLabMode()`, the Lab tab button ships hidden, and
the only three touch-points in production files (`Main.ts` bridge acquisition,
`events.ts` lab hook, `pages.ts` glance-home flag) are inert when the flag is
false.

## How the phone-to-glasses flow works

```
phone webapp (Even Hub WebView)                    G2 glasses (576×288, green)
┌─────────────────────────────┐                    ┌─────────────────────────┐
│ dashboard tabs (Today, …)   │   bridge calls     │ page containers         │
│ LAB TAB:                    │ ─────────────────► │  createStartUpPage ×1   │
│  • gesture buttons ─────────┼─► events.ts router │  rebuildPageContainer   │
│  • fixtures / toggles       │   (simulateEvent)  │  textContainerUpgrade   │
│  • glass mirror  ◄──────────┼── mock model /     │  updateImageRawData     │
│                             │   GlassesState     │                         │
└─────────────────────────────┘                    └─────────────────────────┘
```

- **One event router.** Lab gesture buttons call `events.simulateEvent(...)`,
  which feeds the SAME `handleEvent` the real ring uses — payload shapes match
  the firmware exactly (`sysEvent 0/3`, `textEvent 1/2`, `listEvent`).
- **One startup call.** `createStartUpPageContainer` stays exactly once
  (Main.ts). Everything else is `rebuildPageContainer` — the lab renders its
  pages through `src/g2/adapter.ts`, which also serializes bridge calls,
  skips rebuilds when layout is unchanged (text-upgrade fast path), and
  queues image pushes.
- **No-SDK fallback.** In a plain browser `waitForEvenAppBridge()` never
  resolves; lab mode races it (1.5 s) and falls back to
  `src/lab/mockBridge.ts` — full bridge surface, an **isolated** localStorage
  (`g2lab::` prefix), a live model of what the glasses would show (powers the
  mirror), and paired/battery controls.
- **Machine-owned pages.** `src/g2/stateMachine.ts` drives the three new
  glance surfaces (Habit Check-In, Journal Prompt, Pairing). While one is
  active, `events.setLabEventHook` intercepts ring events so the production
  router never double-handles; double-tap exits via `returnHomeFromLab()`
  which restores Home + `currentPage` cleanly.

## The seven canonical G2 UX states

`HOME_GLANCE · QUOTE · SPEAK · HABIT_CHECKIN · JOURNAL_PROMPT · APHORICA_LITE · PAIRING`

Existing pages project onto these via `deriveState(currentPage)` — the Lab tab
badge always shows both (e.g. `SPEAK · speak-conversation`). The three states
without production pages are machine-owned and render the new builders in
`pages.ts` (`buildHabitCheckInPage`, `buildJournalPromptPage`,
`buildPairingPage`) — each ≤4 containers, exactly one `isEventCapture: 1`,
fixed ring grammar (scroll = move, click = select, double-click = back).

## Home Glance (practice-first home)

With the lab on, Home answers **"What should I practice right now?"** — the
lower-right logo slot becomes a practice stack (next 1-3-5 action · habit due ·
Enki prompt) fed by `setPracticeLines(...)`, while the traditions list keeps its
geometry and capture role so `events.ts` index math is untouched. "Refresh
glance home" on the Lab tab recomputes it from the checklist + habits stores.

## Fixture scenarios (mock bridge only — disabled on a real bridge)

| Scenario | Seeds |
|---|---|
| Fresh Seeker · offline | cleared store, tier=seeker |
| Linked Sage · Today data | token/handle/tier, 1-3-5 checklist, glance line, 2 habits |
| Habit due | habits with yesterday's last check-in |
| Speak just ended | a checkpointed journal session (drives Journal Prompt) |
| Quote resonance saved | `sophicon_favorites` entry |
| Aphorica read/react | glance line pointing at the community feed |
| Pairing lost → reconnect | unpairs, auto-reconnects after 6 s |

The **offline toggle** genuinely rejects `window.fetch` while on, so
network-dependent paths (Aphorica feed, sync) exercise their failure branches.

## G2 constraints honored (and enforced by the new pages)

576×288 canvas · 4-bit green grayscale · ≤4 containers per page in practice
(hard SDK cap observed in pages.ts) · exactly one `isEventCapture: 1` ·
`capForGlass` byte-cap on all text (≤940 bytes) · no CSS/flex/fonts on glass ·
concise text only · serialized bridge calls · image push sizes must match
container sizes exactly.

## Promotion path (what later moves to production)

1. **Adapter adoption** — migrate events.ts's 23 direct
   `rebuildPageContainer` call sites onto `G2Adapter` (serialization +
   layout-aware rebuild-skip for free). Mechanical, one page at a time.
2. **State machine as router** — replace the implicit `currentPage` string
   transitions with the explicit table once all seven states render through
   the adapter.
3. **Home Glance default** — flip `setGlanceHomeEnabled(true)` for everyone
   once the practice-stack copy is validated on real glass; promote the
   geometry into pages.layout.ts via the D3 Container Editor.
4. **Habit Check-In / Journal Prompt / Pairing pages** — wire real triggers
   (pending check-ins on foreground-enter; `checkpointSession` completion;
   `onDeviceStatusChanged` disconnect) instead of lab buttons.
5. **Entitlement previews** — the tier toggle already writes `enki_tier`;
   pair it with locked-state variants of each page when tier-gating ships.

## Files

```
src/lab/labFlag.ts      flag detection (?lab=1 / #lab / VITE_G2_UX_LAB=1)
src/lab/mockBridge.ts   isolated mock bridge + glass model mirror
src/lab/fixtures.ts     the seven scenarios
src/lab/labPanel.ts     the Lab tab UI (mirror, gestures, surfaces, toggles)
src/g2/adapter.ts       serialized, layout-aware rendering seam
src/g2/stateMachine.ts  canonical states + machine for the new pages
docs/G2_UX_LAB.md       this file
```
