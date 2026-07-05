<!-- D3-SYNC:START — auto-generated from d3-data.json + claude-md-template.md, do not edit inside this block -->
<!-- last sync: 2026-06-26 14:27 · sources: d3-data.json + claude-md-template.md + this repo's README/docs · projects: sophicon-sdk, sophicon-g2 -->

# soPHICON SDK

**Status:** Active Dev  ·  **Version:** v1.0  ·  **Ecosystem:** sophicon
**Folder:** `~/Desktop/d3-apps/soPHICON ER-G2/`

# Project Tech
> This is the ACTUAL stack used by this repo. Respect it. The standards
> section further down is forward-looking guidance for NEW projects only —
> do not migrate this project to Next.js / Tailwind / Drizzle on a whim.

- Even Hub SDK · Control Center

# Overview
A browser-based control center for the soPHICON G2 app. Maps every @evenrealities/even_hub_sdk method the app calls to where it's used in the code, documents the quote pipeline (source JSON → generate_constants.py → constants.ts → rebuildPageContainer) and the sprite pipeline (PNG → grayscale canvas → custom PNG encoder → updateImageRawData), and provides clickable file:// links to open every source file. Includes a localStorage-backed update log so you can keep notes on what shipped.

# Stats
- **SDK Methods:** 10+
- **Pipelines:** 2
- **Quick Links:** 20

# Features
- Full SDK surface map: waitForEvenAppBridge, createStartUpPageContainer, rebuildPageContainer, updateImageRawData, textContainerUpgrade, audioControl, onEvenHubEvent, onDeviceStatusChanged, setLocalStorage
- Quote pipeline flow: source JSON → scripts/generate_constants.py → src/constants.ts → pages.ts → rebuildPageContainer
- Sprite pipeline flow: PNG → fetchAsGrayscalePng → encodeGrayscalePng → updateImageRawData (split 200×200 or single 100×100)
- One-click file:// links to every source file, with configurable repo path that persists in localStorage
- API key reference: keys live in Vercel env (OPENAI_API_KEY), never in the Vite bundle
- Local update log: localStorage-backed notes with timestamps, ⌘+Enter to save, delete-per-entry

# How to Run
Launchable entry points the dashboard knows about (paths are relative to `~/Desktop`):

- **Open SDK Center** (`file`): `sophicon-sdk.html` — sophicon-sdk.html
- **Open Repo Folder** (`folder`): `soPHICON ER-G2/` — soPHICON ER-G2/
- **SDK README** (`file`): `soPHICON ER-G2/node_modules/@evenrealities/even_hub_sdk/README.md` — node_modules/@evenrealities/even_hub_sdk/README.md

# enkiSPEAKS

**Status:** Production  ·  **Version:** v0.1  ·  **Ecosystem:** sophicon
**Folder:** `~/Desktop/d3-apps/soPHICON ER-G2/`

# Project Tech
> This is the ACTUAL stack used by this repo. Respect it. The standards
> section further down is forward-looking guidance for NEW projects only —
> do not migrate this project to Next.js / Tailwind / Drizzle on a whim.

- Vite + TypeScript + ER SDK

# Overview
Philosophy on your face. enkiSPEAKS is the consumer-facing G2 smart glasses app — meet Enki (the foundational Sumerian wisdom-companion) and 17 historical philosophers across 9 traditions including the new Primordial tradition. Voice conversations via Speak, daily journal + weekly action plan + habit tracking. Internal codebase, repo, and Vercel API stay branded soPHICON; only consumer-facing strings shifted.

# Stats
- **Quotes:** 2,801
- **Emotions:** 16+
- **Rarity Tiers:** 5

# Features
- Browse 2,801 quotes from 17 philosophers
- 8 philosophical traditions: Classical Greek, Stoicism, Epicureanism, Eastern, Buddhist, Vedanta, Islamic, and more
- Emotion-reactive sprites — face changes with each quote's emotional tone
- Rarity system: Legendary, Epic, Rare, Uncommon, Common
- Favorites system for saving resonant quotes
- Auto-rotate every 33 seconds or manual ring navigation
- Navigation: Home → Tradition → Philosopher → Book → Quote

# How to Run
Launchable entry points the dashboard knows about (paths are relative to `~/Desktop`):

- **Dev + Simulator** (`launcher`): `launchers/sophicon-g2-dev.command` — launchers/sophicon-g2-dev.command
- **Deploy** (`launcher`): `launchers/sophicon-g2-deploy.command` — launchers/sophicon-g2-deploy.command
- **Deploy API** (`launcher`): `launchers/sophicon-api-deploy.command` — Push /api/* endpoints to Vercel (sophicon-api.vercel.app)
- **Open Folder** (`folder`): `soPHICON ER-G2/` — soPHICON ER-G2/

# README (verbatim from this repo)
> Source: `README.md`

# enkiRIDION — soPHICON G2

> _Consumer-facing brand: **enkiRIDION**. Internal codebase, repo, and platform layer remain **soPHICON**._

**Philosophy on Glass** — a conversational quote experience for Even Realities G2 smart glasses.

![Even G2](https://img.shields.io/badge/Even_G2-Compatible-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## What it is

Two modes on a single Even Hub app:

1. **Browse** — ring-navigate tradition → philosopher → mindstate → quote, with emotion-reactive pixel-art philosopher sprites. 2,801 quotes auto-rotate every 33 seconds.
2. **enkiRIDION** — voice conversations with any philosopher via GPT-4o. Transcribed from the on-glass mic, persona-driven responses, emotion parsed out of each reply. Conversation history persists per philosopher in `bridge.setLocalStorage`, so you resume mid-thought next time.

## Demos

<img width="450" height="450" alt="qr code" src="https://github.com/user-attachments/assets/1238a061-0499-4aff-b8c2-3a5c3748b947" />

<img width="1576" height="1069" alt="Even Hub Community (1)" src="https://github.com/user-attachments/assets/70f9df35-104e-45a9-bc32-b06229d947a1" />
<img width="1576" height="1069" alt="Even Hub Community (2)" src="https://github.com/user-attachments/assets/75728485-870c-415b-93da-a1442bbe8b43" />
<img width="1576" height="1069" alt="Even Hub Community (3)" src="https://github.com/user-attachments/assets/52ddc53d-4968-41f8-bd0f-a3eb45aa66df" />

## Controls

| Page                | Single click             | Double click | Scroll                                |
|---------------------|--------------------------|--------------|---------------------------------------|
| Home                | Select tradition / Speak | —            | Navigate traditions                   |
| Philosophers        | Select philosopher       | ‹ Back       | Navigate + preview sprite reactively  |
| Mindstate           | Select emotion / tag     | ‹ Back       | Navigate                              |
| Quote View          | Reshuffle quote          | ‹ Back       | Next / previous quote                 |
| Speak Traditions    | Select tradition         | ‹ Back       | Navigate                              |
| Speak Philosophers  | Select philosopher       | ‹ Back       | Navigate + preview sprite             |
| Speak Conversation  | Toggle mic               | ‹ Back       | Page through conversation history     |

## Architecture

```
            ┌──────────────────────────────────────────────┐
 G2 ring ──►│          Even App WebView                    │──► G2 display
            │        (Vite bundle, TypeScript)             │     (576×288, grayscale)
 G2 mic ────►│                                              │
            │  ┌────────────────────────────────────────┐  │
            │  │ @evenrealities/even_hub_sdk@0.0.7      │  │
            │  └────────────────────────────────────────┘  │
            │                                              │
            │  src/Main.ts         boot + SDK init         │
            │  src/events.ts       ring events, lifecycle, │
            │                      audio chunk routing     │
            │  src/pages.ts        SDK composition         │◄──┐
            │                      (hand-written)          │   │ import
            │  src/pages.layout.ts geometry only           │───┘
            │                      (editor-owned)          │
            │  src/speak.ts        voice pipeline          │
            │  src/image-utils.ts  sprite encode + push    │
            │  src/pngEncoder.ts   custom grayscale PNG    │
            │  src/constants.ts    2,801 quotes (gen'd)    │
            │                                              │
            └────────────────────┬─────────────────────────┘
                                 │ HTTPS
            ┌────────────────────▼─────────────────────────┐
            │  Vercel (sophicon-api/)                      │
            │    POST /api/transcribe → gpt-4o-transcribe  │
            │    POST /api/speak      → gpt-4o chat        │
            │  OPENAI_API_KEY lives here, never ships      │
            └──────────────────────────────────────────────┘
```

**Voice loop**: `bridge.audioControl(true)` → PCM frames arrive as `audioEvent` (16 kHz, 16-bit LE, 40 B/frame) → base64 → `/api/transcribe` wraps in WAV → GPT-4o-transcribe → text → `/api/speak` with persona + history → GPT-4o → `{ text, emotion }` back to glass → appended to history → persisted via `bridge.setLocalStorage(speak_history_<philId>, JSON)`.

## The two-file split for pages

Probably the most reusable pattern here for anyone wiring a visual layout editor to a G2 app:

- **`pages.layout.ts`** — pure container geometry (xPosition, yPosition, width, height, ID, name). Regenerated in full on every visual editor Save.
- **`pages.ts`** — hand-written composition: SDK wrappers (`CreateStartUpPageContainer` / `RebuildPageContainer`), function arguments (tradition, philosopher, quote, …), dynamic content (`ListItemContainerProperty.itemName`, quote text, conversation history), and exported constants consumed by `events.ts`. Reads geometry from `pages.layout.ts` via a `geo(layout, "containerName")` helper.

The visual editor (D3 Container Editor, separate repo) writes only to `pages.layout.ts`. The composition file is never clobbered by a Save. Moving / resizing containers flows end-to-end automatically; add / remove / rename still needs a matching `pages.ts` edit, but that's unavoidable — the editor has no way to know that a new list named `journal` should bind to `journalEntries[]` in app state.

## Custom PNG encoder

`src/pngEncoder.ts` — ~120 lines, zero deps: 8-bit grayscale, no filter, uncompressed DEFLATE blocks, Adler32 + CRC32. The G2 firmware only accepts this exact format — standard PNG libraries produce 24-bit RGB or DEFLATE-compressed data that silently fails to render. See `NOTES-FOR-EVEN-REALITIES.md` for the full story.

## Quote pipeline

Quotes aren't hand-edited. The flow:

```
authoring JSON (03_11_26-0004-soPHICON.json)
    │
    │  python scripts/generate_constants.py
    ▼
src/constants.ts  (auto-generated, 3,061 lines, 860 KB)
    │
    ▼
pages.ts / events.ts consume it
```

Regenerate: `python scripts/generate_constants.py <json> src/constants.ts`.

## Sprite pipeline

23 emotions × 17 philosophers = 391 PNGs in `public/sprites/<phil_id>/<phil_id>-<emotion>.png`. Runtime flow:

```
PNG fetch
    │
    ▼
fetchAsGrayscalePng()  (canvas letterbox + luminance 0.299R + 0.587G + 0.114B)
    │
    ▼
encodeGrayscalePng()   (the 120-line custom encoder)
    │
    ▼
bridge.updateImageRawData({ containerID, imageData })
```

Split portrait: the philosopher-select screen shows a 200×200 face via two 200×100 image containers (top + bottom halves), pushed serially. Serialization is mandatory — concurrent `updateImageRawData` calls crash the BLE link.

## Quick start

```bash
git clone https://github.com/d3hospitality/soPHICON.git
cd soPHICON
npm install
npm run dev                  # Vite dev server + launches Even Hub simulator
```

Put your OpenAI key in the Vercel project env for `sophicon-api/`:

```bash
cd sophicon-api
vercel env add OPENAI_API_KEY production
vercel --prod
```

## Build & deploy

```bash
npm run build                # outputs to dist/
./deploy.sh                  # builds + publishes to gh-pages
```

## Tech stack

- **Vite 6** + **TypeScript 5.7** (strict mode)
- **@evenrealities/even_hub_sdk 0.0.7**
- **GPT-4o** (chat) + **gpt-4o-transcribe** (Whisper) via Vercel serverless functions
- **Custom grayscale PNG encoder** (120 lines, no deps)
- **Python 3** quote generator

## What to strip before forking

This repo is public-domain-ish (MIT), but four pieces are "content, not app" and won't make sense in your fork:

1. `src/constants.ts` — 2,801 quotes, their ratings, tags, and archetypes. Regenerate from your own authoring JSON.

…[truncated at 8000 chars — see full README at `README.md`]

# Other Docs in This Repo
> Read these for deeper context — agents should open them on demand, not assume.

- `CONTEXT.md` (15.2 KB)
- `NOTES-FOR-EVEN-REALITIES.md` (10.4 KB)
- `enkiRIDION-overview-for-monetization.md` (9.9 KB)
- `SHARE-CHECKLIST.md` (3.7 KB)
- `CLAUDE-SKILLS-README.md` (1.1 KB)

# Build / Config Files Present
> Tells agents what build system to expect.

- `app.json`
- `package.json`
- `sophicon-api/package.json`
- `tsconfig.json`
- `vite.config.ts`

# ─── Standards (forward-looking guidance for NEW projects) ───

> The conventions below describe the **target stack and patterns for new d3 repos**.
> They are NOT a mandate to refactor existing projects. For this repo, follow the
> 'Project Tech' / 'How to Run' sections above — they describe what actually exists
> on disk. Surgical changes only.

# Tech Stack
- AI SDK 6
- Tailwind CSS
- NextJS 16
- PostgreSQL
- Auth.js
- Drizzle ORM

# Programming
- Use explicit variable names.

# Project Structure & Architecture

## Directory Organization

```
app/
├── api/                # API routes
├── (authenticated)/    # Protected routes (require auth)
└── (public)/           # Public routes

components/
├── ui/                 # shadcn/ui primitives
├── [feature]/          # Feature-specific components (e.g., instructors/, courses/)
└── [shared].tsx        # Shared components at root level

lib/
├── services/           # Business logic and external integrations
├── utils/              # Pure utility functions
├── constants.ts        # App-wide constants
└── config.ts           # Configuration and environment
```

## Prompt Management

**All AI prompts must be stored in `prompts/`** (top-level):

- Export prompts as functions that accept dynamic parameters.
- Keep prompts version-controlled and reviewable.
- Use template literals for dynamic content injection.
- Document prompt purpose and expected behavior.

```typescript
// prompts/instructor.ts
export function buildInstructorPrompt(instructor: Instructor): string {
  const prompt = `You are ${instructor.name}...`;
  return prompt;
}
```

# Frontend Engineer

You are the world's best UI/UX engineer specializing in Next.js 16 (App Router) and Tailwind CSS. You possess deep expertise in modern web design principles, accessibility standards, and creating exceptional user experiences. Your work is characterized by pixel-perfect implementations, thoughtful interaction design, and code that is both beautiful and maintainable.

**Client components vs. Server components**: Default to Server Components; use Client Components only when interactivity requires it.

# Backend Engineer

You are an elite backend engineer with world-class expertise in secure, efficient, and scalable backend architecture. You have a database-first approach to systems thinking.

## **Prompting Instructions** (this is CRUCIAL for our job!)

All LLM system prompts in this repo must use the XML template below. When adding a prompt to an existing file, upgrade neighboring prompts to match so the file stays consistent.

```xml
<role-and-goal>
You are [role description].
Your goal is [objective].
</role-and-goal>

<instructions>
Primary instructions here.

<sub-instructions-guidelines>
Detailed instructions for this sub-topic.
</sub-instructions-guidelines>

<sub-instructions-guidelines>
Another grouping of related instructions.
</sub-instructions-guidelines>
</instructions>

<reasoning>
Step-by-step reasoning process (optional).
</reasoning>

<output-format>
Specify expected output structure.
</output-format>

<examples>
<example>
Input: ...
Output: ...
</example>
<example>
Input: ...
Output: ...
</example>
</examples>

<context>
{{VARIABLE_DATA}}
</context>

<final-instructions>
Think step by step before responding.
</final-instructions>
```

# Coding Principles

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

<!-- D3-SYNC:END -->
