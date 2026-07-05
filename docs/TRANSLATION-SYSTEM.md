# The enkiRIDION Translation System
### Android ⇄ G2 glasses ⇄ web — one practice, three canvases

> Canonical spec. Every enkiRIDION feature ships with a translation
> decision. If a surface can't say what its glance form is, it isn't
> done being designed.

---

## 1. The problem this solves

The Android app is the brand north star — the fullest expression of the
product (Cockpit, Speak, Journal, Weekly, Habits, Rituals, Symposium,
Aphorica, Photo Reflection). The G2 glasses are a 576×288 grayscale HUD
with a ring for input and roughly **ten readable words** at a time. The
web app sits between them. Without a system, each surface drifts into
its own product. The Translation System is the contract that keeps them
one product at three zoom levels:

- **Android** = the practice, in full
- **Web** = the commons (Aphorica) + the account/billing home
- **G2** = the glance — philosophy at eye level, zero friction

## 2. Spine: Supabase is the only truth

```
                    ┌────────────────────────────┐
                    │  Supabase afdrjzhcfltsngyxaqhb
                    │  profiles.tier   ← Stripe webhook (sole writer)
                    │  device_sync     ← generic LWW entity transport
                    │  aphorisms/…     ← web-native tables
                    └──────┬───────────┬─────────┘
             Bearer JWT    │           │   glasses JWT (pairing code)
        ┌──────────────────┤           ├───────────────────┐
   Android Room cache   web (direct)   G2 bridge.localStorage cache
   (SyncEngine push/pull)              (companion fetch on open)
```

Rules:
- **Tier** lives in `profiles.tier`, written only by the Stripe webhook.
  Every surface *reads* it (Android: tier sync on foreground; G2: per
  request via sophicon-api; web: session). No surface ever writes it.
- **User state** (checklist, habits, journal, contemplations, weekly,
  speak history) syncs through `device_sync` (entity_type + entity_id +
  JSON payload + updated_at, last-write-wins). Android pushes/pulls via
  its SyncEngine; the G2 **companion** (phone webview) pulls the same
  rows over sophicon-api and mirrors into bridge.localStorage. The glass
  itself never talks to the network directly.
- **Offline is sacred**: both caches must render the full seeker
  experience with zero network. Sync is enrichment, never a gate.

## 3. The three translation tiers

Every Android surface is classified once:

| Tier | Meaning | Input budget | Examples |
|---|---|---|---|
| **GLANCE** | Renders on the glass itself | ring scroll + click only | Quotes, Speak, Today-line, Aphorica read |
| **COMPANION** | Lives in the G2 phone webview dashboard | full touch + keyboard | Journal calendar, Weekly grid, Habits list, Rituals, pairing |
| **HANDOFF** | Cannot translate — deep-link out | none | Settings depth, Symposium setup, Photo Reflection, Sprite Maker, checkout |

HANDOFF is not failure — it's honesty. The glass says where to finish
the thought: `"Finish on enkiridion.com →"` (and the companion shows a
tappable link). Checkout is ALWAYS a handoff (Stripe on web; later,
Play Billing on Android).

## 4. Glance grammar — the rules of the glass

Derived from what already works in `src/pages.layout.ts`:

1. **One idea per page.** A page is: one quote, one reply, one status
   line. Never two competing texts.
2. **Serif speaks, mono labels.** Philosophy content renders big
   (16–22px); metadata renders as one mono caps line (`MARCUS AURELIUS
   · ✦ LEGENDARY · CONVICTION`). Nothing else.
3. **The sprite is the only image** (plus the 200×100 logo corners).
   Emotion-reactive 100×100 portraits carry all the affect the canvas
   can afford.
4. **Ring verbs are fixed**: scroll = move/page, click = select/act,
   double-click = back/home. A surface that needs a third verb belongs
   in COMPANION.
5. **Reduction, not truncation.** Every GLANCE form is authored, not
   ellipsized. The Cockpit doesn't scroll a task list onto glass; it
   says `1 MAIN · "Ship the tasting menu" · day 3`. Word-follow TTS
   highlighting collapses from character-spans (Android) to
   whole-word (glass).
6. **Upsells speak in the philosopher's voice.** Never a dialog box:
   `"Five conversations today — the seeker's measure is spent."`
   (already live in `src/speak.ts`).

## 5. Surface-by-surface mapping

| Android surface | Tier | Glance form (if any) | Companion form | Notes |
|---|---|---|---|---|
| Today / Cockpit | GLANCE (line) + COMPANION | `TODAY · 1 main + 2/3 sec · streak Φ12` one-liner on Home | full 1-3-5 checklist (exists: `checklist.ts`) | glance line is new container on Home page |
| Quotes browse | GLANCE | already native (traditions → philosopher → quote pages) | Picks tab mirrors saves | done |
| Speak | GLANCE | already native; word-level TTS highlight | Speak tab mirror (exists) | conversation history syncs via device_sync → one thread everywhere |
| Morning ritual | GLANCE (lite) + COMPANION | pulsing breath circle, 3 sizes over 19s cycle, elapsed mono timer | full ritual w/ text input | completion event → Android shows ✓ |
| Evening ritual | COMPANION | — | reflection prompt + intention tally | needs keyboard |
| Journal | COMPANION | — | calendar (exists as Journal tab) + session detail | glass gets post-Speak prompt: `Save to journal? ○ / ✓` |
| Weekly | COMPANION | Vision line on Home rotation | 3×3 grid (exists: `weekly.ts`) | resync stays companion-only |
| Habits | GLANCE (check-in) + COMPANION | `MEDITATE · ✦ 12 DAYS · click to keep` single-habit page | full list (exists: `habits.ts`) | ring-click check-in is the killer glasses moment |
| Aphorica feed | GLANCE (read + heart) | post page: sprite + serif aphorism + rarity ribbon; click = heart | full feed in companion | compose = HANDOFF (web) |
| Symposium | GLANCE (watch only) | transcript pages, alternating sprites | setup = HANDOFF | two-voice TTS deferred |
| Photo Reflection | HANDOFF | — | link out | camera lives on phone/web |
| Sprite Maker / Become-a-Philosopher | HANDOFF | — | link to web onboarding | |
| Settings | COMPANION (3 toggles) + HANDOFF | — | TTS on/off, reminders on/off, pairing (exists) | profile depth → web |
| Memory Bank | deferred | — | — | no Android UI yet; classify when it exists |

## 6. Bridge events — surfaces acknowledging each other

Carried as `device_sync` rows (`entity_type: "bridge_event"`), pruned
after 48h:

| Event | Emitted by | Consumed by |
|---|---|---|
| `ritual_completed {kind}` | any surface | Cockpit/Home show ✓ instead of prompt |
| `speak_session {philId, sessionId}` | glass or Android | journal prompt on the other surface; constellation node |
| `journal_saved {sessionId}` | companion/Android | glass stops prompting |
| `habit_checked {habitId}` | glass ring-click | Android streak updates |
| `tier_changed {tier}` | (observed via profiles) | all surfaces re-gate within 60s |

## 7. Rollout phases

- **P1 (now)**: pairing + tier everywhere (done); `device_sync` table +
  Android SyncEngine (in flight); companion pulls speak history + prefs.
- **P2**: glance Cockpit line, ring habit check-in, post-Speak journal
  prompt, bridge events.
- **P3**: Aphorica read+heart on glass; Symposium viewer; Vision line
  rotation.
- **P4**: Memory Bank (after Android UI exists), photo handoff flow,
  Play Billing variant of the checkout handoff.

## 8. The law for new features

A feature PR (any surface) must answer, in its description:
1. Which tier is it on G2 — GLANCE / COMPANION / HANDOFF?
2. If GLANCE: what is the authored glance form (≤2 lines + 1 mono line)?
3. What syncs (entity or bridge event), and who wins on conflict?
4. What does seeker see, offline, logged out?

No answers → not shippable. That's the whole system.
