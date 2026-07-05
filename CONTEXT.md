# soPHICON — Project Context

> Single-file brief for sharing with external tools (ChatGPT, Claude, code reviewers, contractors). Captures what soPHICON is, how it's built, what's shipped, and where it's going. Update when the architecture meaningfully shifts.

---

## What it is

**soPHICON** is a philosophy-on-glass companion for the Even Realities G2 smart glasses, plus an iOS/Android companion app. The core experience is:

1. **Quotes on the lens** — 2,801 hand-curated quotes across 17 philosophers and 8 traditions auto-rotate every 33 seconds, with emotion-reactive pixel-art philosopher portraits.
2. **Speak** — Voice conversations with any philosopher, transcribed via Whisper, replied to by GPT-4o in-character. Each conversation gets journaled.
3. **Daily journal + Eisenhower weekly action plan** — Conversations stack onto a dated journal, GPT extracts action items per session, weekly action plans cluster recurring themes by Eisenhower quadrant (Do First / Schedule / Delegate / Eliminate) tagged by life category (Work / Love / Money / Health / Mind / Spirit / Other).
4. **Habits** — Long-press an action to commit to it as a daily habit. Each morning the originating philosopher checks in: "Did you do X yesterday?" Streaks track follow-through (Solo Leveling pattern).
5. **Enki** — a foundational philosopher every user meets first. Default companion, capability scales by tier (see Pricing below).

---

## Stack

- **Glasses app**: TypeScript + Vite, served as a packaged WebView via the Even Hub Phone app. Uses `@evenrealities/even_hub_sdk@0.0.7`.
- **Companion phone dashboard**: same Vite bundle, different entry HTML. Tab-driven UI: Home / Picks / Mindful / Speak / Journal / Debug / About.
- **Backend**: Vercel serverless functions in `sophicon-api/` proxy all AI calls so OpenAI keys never ship to the glasses.
- **Auth + cloud (planned)**: Supabase for accounts + RLS-backed cloud sync of journal/habits/profile.
- **Billing (planned)**: Stripe + App Store / Play Billing for tier upgrades.
- **Hosting**: GitHub Pages serves the WebView bundle at `https://d3hospitality.github.io/soPHICON/`. Vite uses `base: './'` so the same build works packaged-locally on the phone (no internet required for sprites or assets).

---

## Pricing tiers

Three tiers, named to fit the philosophical-companion frame (not generic SaaS):

| Tier         | Cost       | What's unlocked |
|--------------|------------|------------------|
| **Seeker**   | Free       | Quotes on glass (full corpus). Speak with **Enki** at base capability. 5 conversations/day. 1 active habit. 30-day journal retention. No cross-device sync. |
| **Examined** | ~$8/mo     | Speak with all 17 historical philosophers. Enki upgraded to "deeper" mode (reads the full UserProfile, extends context windows, applies user's `guidelines` honestly). Unlimited Speak. Weekly action plan. 5 active habits. Full journal sync across iOS / Android / G2. 1-year retention. Book-RAG philosopher voice. |
| **Sage**     | ~$60/yr or lifetime | Add custom user-added philosophers. Enki's full "uncapped" mode — unrestricted personalization, persistent memory, cross-philosopher narrative awareness. Mini-philosopher fine-tuned voice models when they ship. Unlimited journal retention. Priority transcription. |

Tier name etymology: **Seeker** = on the path; **Examined** from Socrates "the unexamined life is not worth living"; **Sage** = the destination.

---

## Enki

Enki is the foundational philosopher every user encounters. Sumerian god of wisdom, water, knowledge, and craft — predates Greek philosophy, distinctive, memorable.

**Product role**:
- New users meet Enki first. He's the "where do I start?" answer.
- Enki is the user's *personal* companion. The other 17 philosophers are historical figures Enki can introduce them to.
- Enki's capacity scales with tier — same character, deepened relationship.

**Capability by tier**:
- **Seeker (free Enki)**: Friendly, helpful, but operates with a soft cap on context window depth. Doesn't deeply incorporate the UserProfile. Surface-level personalization. Conversation history limited to last 10 turns in the prompt.
- **Examined (deep Enki)**: Full UserProfile injected as ABOUT THIS PERSON. Last 14 days of cross-philosopher journal as context. User's `guidelines` are followed verbatim. Conversation history extended to last 40 turns.
- **Sage (uncapped Enki)**: Persistent semantic memory across all conversations (RAG over full journal, not just 14 days). Cross-philosopher narrative awareness — Enki references your conversations with Marcus, Buddha, Seneca by name when it serves the user. User can shape Enki's tone/voice/values via long-term `guidelines` that Enki actively negotiates.

**Implementation hooks**:
- Enki lives in `personas.json` like the other 17, but with `philId: "enki"` and a tier-aware persona.
- Server-side `/api/speak` reads `userProfile.tier` and adjusts Enki's system prompt accordingly (depth caps, cross-context inclusion, guideline weight).
- Enki sprite set: needs pixel art, 23 emotion variations matching the existing canonical list.

---

## Repo map

```
soPHICON ER-G2/
├── index.html                    # Companion-app dashboard entry (8 tabs)
├── vite.config.ts                # base: './' for packaged WebView delivery
├── app.json                      # Even Hub manifest (entrypoint: index.html)
├── package.json                  # Deps: @evenrealities/even_hub_sdk + Vite
├── publish.sh                    # One-button deploy: push → build → gh-pages → vercel
├── deploy.sh                     # Old per-step deploy
├── README.md                     # Project overview
├── CONTEXT.md                    # ← you are here
├── NOTES-FOR-EVEN-REALITIES.md   # Engineering feedback for the SDK team
│
├── public/
│   ├── personas.json             # 17 philosopher persona sheets (tone, principles, openings)
│   ├── sprites/<philId>/         # 23 emotion PNGs per philosopher (391 total)
│   └── assets/                   # Logos
│
├── src/
│   ├── Main.ts                   # Boot: bridge attach, register events, init dashboard
│   ├── constants.ts              # Auto-generated quote corpus (3061 lines, 2801 quotes)
│   ├── pages.ts                  # Page builders (Home / Picks / Speak / Quote view)
│   ├── pages.layout.ts           # Container property defs (auto-generated by D3 Container Editor)
│   ├── events.ts                 # Event router: ring scrolls, clicks, audio, lifecycle exits
│   ├── speak.ts                  # Voice conversation pipeline + journal + cross-context
│   ├── habits.ts                 # Habit store, daily check-ins, streak math
│   ├── weekly.ts                 # Weekly overview types, ISO week math, quote matcher
│   ├── profile.ts                # UserProfile JSON: name, language, life context, preferences
│   ├── dashboard.ts              # Phone-side companion dashboard (tabs, modals, state mirror)
│   ├── image-utils.ts            # Sprite/logo fetch + grayscale-PNG encode for the firmware
│   ├── pngEncoder.ts             # Custom PNG encoder (firmware only accepts a specific format)
│   ├── favorites.ts              # Quote favorites (in-memory)
│   └── style.css                 # Dark + gold dashboard styles
│
├── sophicon-api/                 # Vercel serverless functions
│   └── api/
│       ├── speak.js              # GPT-4o chat completion with persona + crossContext + userProfile
│       ├── transcribe.js         # Whisper transcription, language locked from profile
│       ├── actions.js            # Extract 3-5 concrete TODOs from a session/week of journal
│       ├── problems.js           # Cluster recurring problems from journal
│       └── weekly-overview.js    # Build the Eisenhower-quadrant weekly action plan
│
├── sophicon-sdk.html             # In-browser SDK control center (live doc, file links, roadmap)
└── scripts/
    └── generate_constants.py     # JSON → constants.ts code-gen
```

---

## Backend pipeline (current)

```
User speaks (G2 mic)
  → 16 kHz PCM streamed via bridge.audioControl + audioEvent
  → speak.ts: chunks accumulated, base64-encoded
  → POST sophicon-api.vercel.app/api/transcribe
       (audio + language='en' from UserProfile.language — locks Whisper)
  → returns { text }
  → POST /api/speak with:
       persona (loaded from personas.json),
       conversationHistory,
       userMessage,
       crossContext (last 14 days from other philosophers, opt-in),
       userProfile (compact: name, language, role, focus, challenges, preferences, guidelines)
  → server builds system prompt:
       persona priming HARD ("YOU ARE X — not a chatbot, not GPT")
       ABOUT THIS PERSON (from userProfile)
       RECENT CONVERSATION CONTEXT (crossContext)
       LANGUAGE directive
       RULES (with soft advice-mode rule for explicit "give me steps" prompts)
  → GPT-4o response with [USER_MOOD:x] [EMOTION:x] meta tags
  → speak.ts: appends to conversationHistory, persists to bridge.localStorage
  → on session end: checkpointSession() writes to speak_journal (idempotent)
  → fire-and-forget: /api/actions extracts TODOs into speak_action_items
```

---

## Storage keys (bridge.localStorage)

| Key                         | Shape                          | Owner          |
|-----------------------------|--------------------------------|----------------|
| `user_profile`              | UserProfile object             | profile.ts     |
| `speak_journal`             | JournalSession[]               | speak.ts       |
| `speak_history_<philId>`    | SpeakMessage[] (per-philosopher running buffer) | speak.ts |
| `speak_action_items`        | ActionItem[] (all-time, stacked) | speak.ts     |
| `speak_cross_context`       | string (cached preamble)       | speak.ts       |
| `weekly_overview_<YYYY-WW>` | WeeklyOverview                 | weekly.ts      |
| `weekly_overview_index`     | string[] of weekKeys           | weekly.ts      |
| `habits`                    | Habit[]                        | habits.ts      |
| `sophicon_version`          | string                         | Main.ts        |

After cloud sync ships, all of these mirror to Supabase tables of the same name.

---

## Key decisions made

- **Naming**: Seeker / Examined / Sage. Considered alternatives: Pupil/Companion/Disciple, Logos/Phronēsis/Sophia. Locked in 2026-04-27.
- **Foundational philosopher**: Enki. Sumerian wisdom god, predates Greek, single syllable, distinctive. Capability scales with tier.
- **Sprite delivery**: relative paths (`base: './'` in Vite + `./sprites/...` fetches) so packaged WebView reads from local bundle. Earlier CDN pin to GitHub Pages absolute URL was reverted because the phone WebView is sandboxed and can't reach external CDNs at runtime.
- **PNG format**: G2 firmware only accepts 8-bit grayscale, no filter byte, uncompressed DEFLATE, explicit Adler32+CRC32. Custom encoder in `src/pngEncoder.ts` (~120 lines).
- **Container dimensions**: must match the `pushSpriteSingle(...w, h)` arguments exactly or firmware silently rejects. v10 enlarged QuoteView + SpeakConversation containers from 100×100 to 120×120; push sites were updated to match.
- **Whisper language**: locked via UserProfile.language (defaults `'en'`) to prevent auto-detect drift to Spanish/German/Japanese on unclear audio.
- **Speak prompt**: persona priming HARD at top of system prompt ("YOU ARE X — not a chatbot, not GPT"). Soft advice-mode rule (lean directive only when user explicitly asks for steps) to prevent every reply becoming a numbered list. Server-side dedupe of trailing user-message that the client double-sends.
- **Journal idempotency**: `currentSessionCheckpointed` flag prevents double-write when explicit back-out AND lifecycle exit both fire.
- **Cross-pollination**: philosophers receive last-14-days summary across other philosophers as quiet awareness, never volunteered.
- **Local-first sync**: UI writes update instantly, cloud upserts are fire-and-forget with retry queue. Last-write-wins on conflicts.

---

## Open questions / next decisions

1. **Enki sprite art** — needs commissioning. 23 emotion variations to match the existing canonical list. Visual identity: Sumerian/Mesopotamian aesthetic? Stylized water motifs? Same GBA-era pixel art style as other philosophers, just a different character.
2. **Enki persona text** — needs writing for `personas.json`. Voice should be wise-but-warm, not lecturing. Specific historical references? Use Sumerian texts (Enheduanna's hymns) for grounding. Different persona variant per tier or shared base + tier-aware capability injection?
3. **Auth provider mix** — Supabase Auth supports email magic link, Apple, Google. App Store review usually requires Sign In With Apple if any other social login is offered.
4. **Subscription pricing** — confirm $8/mo + $60/yr (or lifetime $X) and whether to offer a 14-day Examined trial.
5. **App Store bundle identifier** — the iOS / Android companion apps need bundle IDs registered. Currently only `app.json` declares `com.d3hospitality.sophicon` for the G2 hub.

---

## Where to look for what

- **"How does Speak actually work?"** — `src/speak.ts` (client), `sophicon-api/api/speak.js` (server prompt + GPT call), `sophicon-api/api/transcribe.js` (Whisper).
- **"How are sprites encoded?"** — `src/pngEncoder.ts` + comment block at top of `src/image-utils.ts`.
- **"Where does the journal data live?"** — `bridge.localStorage` key `speak_journal`. Append-only; entries written by `checkpointSession()` in `speak.ts`. Cloud mirror coming via Supabase `journal_sessions` table.
- **"How do I add a new philosopher?"** — Phase 1: extend `personas.json`. Phase 2: generate sprite set (23 emotions). Phase 3: extend `PHILOSOPHERS` in `constants.ts` (or just regenerate from JSON). The Even Realities G2 sprite pipeline at `~/Desktop/d3-apps/soPHICON/Sprite Maker/` (separate Flask app) handles 1-3 with reference image search + GPT-image-1 generation.
- **"What does the SDK control center show?"** — `sophicon-sdk.html`, opens locally in a browser. Has the architecture roadmap, schema SQL, file links, and update log.
- **"How does the deploy flow work?"** — `publish.sh` runs `git push origin main`, then `npm install && npm run build`, then `npx gh-pages -d dist` (publishes the WebView bundle to gh-pages branch), then `vercel --prod` from `sophicon-api/` (deploys the serverless API).

---

## Conventions

- Tabs in `dashboard.ts` are mutually exclusive (`.tab-panel.active`). Each tab init function lives near its render functions.
- All AI calls go through Vercel — never call OpenAI directly from the client. Keys live only in Vercel env vars.
- Bridge calls (`bridge.setLocalStorage`, `bridge.audioControl`, etc.) are fire-and-forget unless awaiting a return value. Never `await` a setLocalStorage in a hot UI path.
- `console.log` in serverless functions surfaces in `vercel logs`. Use `[/api/<name>]` prefix for searchability.
- `log()` in TS surfaces in the dashboard's Debug tab. Use `[MODULE]` prefix.

---

*Last updated: 2026-04-27 — Phase 1 (Auth) not yet started. Cross-context, language locking, journal idempotency, weekly action plan, habits, and daily check-in are all live.*
