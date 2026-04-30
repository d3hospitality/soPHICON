# enkiSPEAKS — soPHICON G2

> _Consumer-facing brand: **enkiSPEAKS**. Internal codebase, repo, and platform layer remain **soPHICON**._

**Philosophy on Glass** — a conversational quote experience for Even Realities G2 smart glasses.

![Even G2](https://img.shields.io/badge/Even_G2-Compatible-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

## What it is

Two modes on a single Even Hub app:

1. **Browse** — ring-navigate tradition → philosopher → mindstate → quote, with emotion-reactive pixel-art philosopher sprites. 2,801 quotes auto-rotate every 33 seconds.
2. **enkiSPEAKS** — voice conversations with any philosopher via GPT-4o. Transcribed from the on-glass mic, persona-driven responses, emotion parsed out of each reply. Conversation history persists per philosopher in `bridge.setLocalStorage`, so you resume mid-thought next time.

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
2. `public/personas.json` — 17 persona sheets (voice, tone, principles, opening lines). Replace.
3. `public/sprites/` — 391 pixel-art portraits. Generated via the soPHICON sprite pipeline (separate repo). Replace.
4. `sophicon-api/` — Vercel serverless functions with OpenAI keys in env. Ship your own Vercel project; the bundle itself never sees a key.

## Notes

- See `NOTES-FOR-EVEN-REALITIES.md` for a detailed writeup of SDK friction points encountered while building this — what hurt, why, and concrete suggested fixes.

---

*Built for the Even Realities G2 smart glasses*
*Part of the d3hospitality ecosystem*

MIT © D3 Hospitality
