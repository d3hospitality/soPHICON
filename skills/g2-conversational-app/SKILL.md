---
name: g2-conversational-app
description: Production patterns for building voice-conversation apps on Even Realities G2 smart glasses — reactive sprites that respond to user mood, phone-side webview dashboard with calendar/journal, dated conversation history, firmware-safe text pagination (999-byte cap, ASCII-only fonts), the two-file split pattern for visual-editor integration, dual-emotion GPT prompting, and extraction endpoints for problems + action items. Use this skill whenever building a G2 app that involves voice input + LLM replies + reactive visual feedback, or when adding a phone-side webapp that mirrors on-glass state. Complements the everything-evenhub skill pack — does not duplicate its basics.
allowed-tools: [Read, Grep, Glob, Bash, Write, Edit]
---

# Building Conversational G2 Apps — Production Patterns

Hard-won patterns for a voice-conversation G2 app with reactive sprites and a phone-side dashboard. Distilled from building **soPHICON** (Philosophy on Glass: 17 philosopher personas × 23 emotion sprites × voice loop via GPT-4o).

Assumes you've read the `everything-evenhub` skill pack (handle-input, glasses-ui, sdk-reference, device-features). This skill covers what those don't.

---

## 1. The two-file split for pages

If you're using a visual layout editor that writes `pages.ts` directly, **stop**. The editor will overwrite your dynamic content, function signatures, and SDK wrappers on every save. Instead, split into:

```
src/pages.layout.ts   ← EDITOR-OWNED. Pure container geometry. Regenerated
                        in full on every editor save. Never hand-edit.

src/pages.ts          ← HAND-WRITTEN. Imports layout, composes SDK
                        wrappers (CreateStartUpPageContainer, etc.),
                        binds dynamic content (list itemNames, text
                        content), exports constants consumed by events.ts.
```

**`pages.layout.ts` shape:**
```ts
import { TextContainerProperty, ListContainerProperty, ImageContainerProperty }
  from '@evenrealities/even_hub_sdk';

export function buildHomePage() {
  return [
    new TextContainerProperty({ xPosition: 390, yPosition: 220, /* ... */,
      containerID: 1, containerName: 'title' } as any),
    new ListContainerProperty({ /* geometry only */ } as any),
    // ...
  ];
}
```

The `as any` cast is required because editors emit style fields (`textSize`, `textColor`, `bgColor`, `gravity`, `itemHeight`) that the SDK's TS types don't declare but the firmware reads. Teach your editor to emit `} as any)` in its generator.

**`pages.ts` shape:**
```ts
import { buildHomePage as homeLayout } from './pages.layout';

function geo(layout, name) {
  const c = layout.find(x => x.containerName === name);
  if (!c) throw new Error(`pages.layout: missing '${name}'`);
  return { xPosition: c.xPosition, yPosition: c.yPosition, width: c.width, height: c.height };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const layout = homeLayout();
  const title = new TextContainerProperty({
    ...geo(layout, "title"),
    containerID: 1, containerName: "title",
    content: "Some Dynamic String",   // ← the thing the editor can't know
    isEventCapture: 0,
  });
  // ... compose the rest, wrap in CreateStartUpPageContainer
}
```

Editor moves a box → `pages.layout.ts` updates → `pages.ts` picks up the new position via `geo()` → no manual edit needed. **But** renames, type changes, add/delete of containers require a `pages.ts` edit. Document this.

**Editor save must be full-rewrite, never surgical-patch.** Surgical patching (anchored regex find/replace) silently skips properties when anchors drift — you will ship bugs for weeks chasing "why didn't phil-name update." Always generate the whole file, always validate (see §9).

---

## 2. Firmware-level text gotchas

### 999-byte text container cap (NOT 2000 chars)

SDK README says 2000 chars. LVGL text engine actually rejects anything over **999 bytes**. You'll see:
```
TextContainerUpgrade failed: text content length 1184 exceeds limit of 999 bytes
```

Cap all text content at ~940 bytes before pushing. Byte-safe truncation with `TextEncoder`:

```ts
export function capForGlass(s: string, maxBytes = 940): string {
  if (typeof TextEncoder === "undefined") {
    return s.length <= maxBytes ? s : s.slice(0, maxBytes - 3) + "...";
  }
  const enc = new TextEncoder();
  const bytes = enc.encode(s);
  if (bytes.length <= maxBytes) return s;
  const dec = new TextDecoder("utf-8", { fatal: false });
  let cut = maxBytes - 3;
  while (cut > 0) {
    const out = dec.decode(bytes.slice(0, cut));
    if (!out.endsWith("\uFFFD")) return out + "...";  // not cut mid-codepoint
    cut--;
  }
  return s.slice(0, 100) + "...";
}
```

For long replies, **paginate, don't truncate** — break into ~780-char chunks at word boundaries and let the user swipe through pages.

### LVGL font doesn't have Unicode symbols

The on-glass font is missing most non-ASCII glyphs. Confirmed missing:
- `U+25CF` ● (BLACK CIRCLE)
- `U+25E6` ◦ (WHITE BULLET)
- `U+22EF` ⋯ (MIDLINE ELLIPSIS)
- `U+258C` ▌ (LEFT HALF BLOCK)

**Rule: ASCII only for anything rendered on-glass.** Use `...` not `⋯`, `>` not `▶`, `*` not `●`. Verify in simulator — the warning looks like:
```
lv_draw_letter: glyph dsc. not found for U+22EF
```

Visual emphasis comes from **CAPS** (e.g. `YOU:` vs `Socrates:`), not from Unicode decoration.

### Protobuf zero-value omission breaks event handling

`@evenrealities/even_hub_sdk` uses protobuf. Any field with value `0`, `false`, or empty string arrives as `undefined`, not the zero value. Critically:
- `sysEvent.eventType === 0` (single click) → arrives as `undefined`
- `listEvent.currentSelectItemIndex === 0` (first item) → arrives as `undefined`

Always use nullish coalescing:
```ts
const type = event.sysEvent.eventType ?? 0;
if (type === OsEventTypeList.CLICK_EVENT) { /* single click */ }
```

Writing `type === 1` as a "single click fallback" is the most common event-handling bug — `1` is `SCROLL_TOP_EVENT`. Swipes-up get misrouted as clicks.

### Event capture model

- Exactly **one** container per page must have `isEventCapture: 1`. Zero = no events. Two = SDK rejects page.
- **Text containers CAN capture** — swipes fire `textEvent` (type 1/2), clicks fire `sysEvent` (type 0/3).
- **Images cannot capture** — use a full-screen transparent text container if you need click handling on an image-dominant page.
- Lists with `itemName[]` populated get native ring-scroll; swipes are consumed internally (no event fired).

### 4-container page cap

Max 4 containers per page. Plan your information hierarchy accordingly. Common pattern for a conversation page:
1. Portrait (image) — emotion-reactive
2. Response body (text, event-capturing) — paginated conversation
3. Primary label (text) — philosopher name / persona
4. Secondary label (text) — tradition / tagline

---

## 3. Reactive sprite cycle pattern

On-glass faces reacting to voice conversation. Four-phase cycle per turn:

| Phase | Trigger | Sprite | Why |
|---|---|---|---|
| 1. Listening | Tap mic to start | context-aware from prior mood, default `contemplation` | receptive face |
| 2. Thinking | Tap mic to stop | same empathic frame held | don't snap to "wonder" (looks surprised) during heavy moments |
| 3. Empathy | GPT reply arrives | `userMoodToEmpathySprite(userMood)` | philosopher acknowledges what you said before answering |
| 4. Response | ~7s after empathy | GPT's `emotion` field, force-pushed | philosopher's own reaction |

Implementation:

```ts
// Dedupe on NORMALIZED sprite name (not raw tag), so "contemplative" →
// "contemplation" via synonym map doesn't fire twice. Pass force=true
// to guarantee a push even when emotion matches (response phase).
async function updateEmotionSprite(bridge, baseUrl, emotion, force = false) {
  const normalized = normalizeEmotion(emotion);
  if (!force && normalized === lastPushedEmotion) return;
  await pushEmotionPortrait(bridge, baseUrl, philId, normalized);
  lastPushedEmotion = normalized;
}

// 7-second empathy hold between phases 3 and 4. Cancellable so it
// doesn't race with the user's next tap. setTimeout, not await.
const EMPATHY_HOLD_MS = 7000;
let pendingTimer = null;
function cancelPending() {
  if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
}

// In toggleMic after reply arrives:
if (result.userMood && result.userMood !== "neutral") {
  await updateEmotionSprite(bridge, baseUrl, empathySprite(result.userMood), true);
  pendingTimer = setTimeout(() => {
    updateEmotionSprite(bridge, baseUrl, result.emotion, true);
  }, EMPATHY_HOLD_MS);
}
```

**Cancel the pending timer on:** next mic tap, double-tap back (goBack), `FOREGROUND_EXIT_EVENT`, `ABNORMAL_EXIT_EVENT`. Otherwise a stale push fires into a disconnected bridge.

### The empathy map

Map from user's inferred mood → the philosopher's empathic response face:

```ts
export function userMoodToEmpathySprite(userMood: string): string {
  const m = (userMood || "").toLowerCase().trim();
  const map: Record<string, string> = {
    // Soft / receiving — grief family
    grieving: "compassion", mournful: "compassion", sad: "sorrow",
    lonely: "compassion",   lost: "compassion",     numb: "compassion",
    guilty: "acceptance",   ashamed: "compassion",
    // Grounding / still — anxiety family
    anxious: "serenity",    overwhelmed: "peace",   panicked: "peace",
    angry: "serenity",      frustrated: "acceptance",
    // Orienting / teaching — cognitive family
    confused: "teaching",   stuck: "teaching",      seeking: "teaching",
    conflicted: "teaching", doubtful: "contemplation",
    // Bright / open
    hopeful: "joy",         inspired: "awe",        curious: "wonder",
    proud: "devotion",      resolved: "authority",
    neutral: "contemplation",
  };
  return map[m] || "compassion";  // unknown moods → compassion, not blank
}
```

Build this map from the actual sprite filenames your asset pipeline produces — check `public/sprites/<philId>/` for the canonical list.

### Sprite push cache + debug log

Cache encoded PNG bytes by `${spritePath}@${w}x${h}` keys, LRU-capped at ~120. Repeat pushes skip fetch + canvas + encode. BLE is the bottleneck, not image decoding.

Expose a ring buffer of the last N pushes with `{ts, key, ms, ok, err}` so the phone-side dashboard has a diagnostic view:

```ts
const pushLog: { ts: number; key: string; ms: number; ok: boolean; err?: string }[] = [];
export function getSpritePushLog() { return pushLog; }
```

Invaluable when debugging "sprite didn't appear" — shows if the push was attempted, how long it took, and the exact error.

---

## 4. Dual-emotion GPT prompt pattern

For conversational personas, ask GPT for **two emotional reads per reply**, not one:

```js
// System prompt (e.g. /api/speak.js)
- After your reply, append TWO meta tags on their own lines:
    [USER_MOOD:word]  — what you sensed in the user's message
    [EMOTION:word]    — the face YOU should wear responding to that user
  The sprite shown on their glasses is driven by [EMOTION]. Pick from
  this exact list (match sprite filenames 1:1): [acceptance, authority,
  awe, compassion, contemplation, conviction, defiance, devotion, doubt,
  grief, honor, joy, liberation, neutral, peace, rage, resolve,
  serenity, sorrow, teaching, transcendence, urgency, wonder]
```

Parse both order-agnostically, strip both from the visible text:

```js
const emotion  = raw.match(/\[EMOTION:(\w+)\]/i)?.[1]?.toLowerCase() ?? 'contemplation';
const userMood = raw.match(/\[USER_MOOD:(\w+)\]/i)?.[1]?.toLowerCase() ?? 'neutral';
const text = raw.replace(/\[EMOTION:\w+\]/gi, '').replace(/\[USER_MOOD:\w+\]/gi, '').trim();
return { text, emotion, userMood };
```

`emotion` drives the response-phase sprite. `userMood` drives the empathy-phase sprite AND becomes conversation metadata for later analysis (see §6).

**Synonym map for LLM drift.** GPT sometimes returns emotions outside your canonical list ("thoughtful" instead of "contemplation"). Normalize client-side so sprites never 404:

```ts
const EMOTION_SYNONYMS = {
  thoughtful: "contemplation", reflective: "contemplation",
  angry: "rage", happy: "joy", sad: "sorrow", calm: "serenity",
  curious: "wonder", compassionate: "compassion",
  // ...
};
export function normalizeEmotion(raw: string): string {
  const e = (raw || "").toLowerCase().trim();
  if (CANONICAL_EMOTIONS.includes(e)) return e;
  return EMOTION_SYNONYMS[e] || "neutral";
}
```

---

## 5. Phone-side webview dashboard pattern

The Even App runs your bundle in a WebView. That WebView is a **free phone UI** — you don't have to show just a status bar. Use it for:

- Live mirror of on-glass state (which page, which philosopher, which sprite)
- Calendar / journal of past conversations (browser can render rich history that on-glass can't)
- Debug panels (manual sprite pushes, push log, API key management)
- Settings (API keys, reset, theme)

### Architecture: tabbed vanilla TS + DOM

No framework. Tabbed shell, each tab a `<div class="tab-panel">`. Tab switching toggles `.active`. Pub/sub from events.ts → dashboard for live state updates.

```ts
// events.ts — expose a state-change pub/sub
export interface GlassesState { page, tradition, philosopher, spritePath, ... }
let listeners: ((s: GlassesState) => void)[] = [];
export function onGlassesStateChange(cb) { listeners.push(cb); return () => {...}; }
function publishState(extra = {}) {
  const s = { page: currentPage, /* ... */, ...extra };
  listeners.forEach(cb => cb(s));
}
// Call publishState() at the end of every nav handler + after sprite pushes.
```

```ts
// dashboard.ts
import { onGlassesStateChange } from './events';

export async function initDashboard(bridge, baseUrl) {
  initTabs();
  onGlassesStateChange(state => {
    document.getElementById('glasses-page-name').textContent = pageLabel(state.page);
    document.getElementById('glasses-sprite').innerHTML = state.spritePath
      ? `<img src="${spriteUrl(state.spritePath)}" />` : '<svg>...</svg>';
  });
}
```

Mount after `bridge` is ready, from `Main.ts`. Settings (API keys) persist via `bridge.setLocalStorage`.

### ALWAYS include an `onerror` fallback for sprite `<img>` tags

If a sprite 404s in the browser, the default broken-image icon shows — often a boxed `?` that looks like missing content. Attach `onerror` to hide it:

```html
<img src="${spriteUrl(path)}" alt="" onerror="this.style.display='none'" />
```

Use **inline SVG for placeholders** in the dashboard, not fancy Unicode glyphs (user's system font may lack them).

### Sprite URL resolution

`import.meta.env.BASE_URL` in Vite equals whatever's in `vite.config.ts` → `base` (commonly `/projectname/` for GitHub Pages). Centralize into one helper:

```ts
function spriteUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return `${base}sprites/${path.replace(/^\/+/, '')}`;
}
```

Required for the dashboard `<img>` tags to resolve correctly both in dev and in gh-pages production.

---

## 6. Dated journal + extraction endpoints

Don't just store a single flat conversation history. Build a dated journal that supports calendar browsing and later analysis:

```ts
// Two-level storage
speak_history_<philId>   // running session buffer — last ~40 turns, sent to GPT
speak_journal            // append-only, dated: [{ date, philId, startTs, endTs, exchanges: [] }]
```

**Checkpoint on session end.** When the user double-taps back out of the conversation page, snapshot the in-memory history as a `JournalSession` and append to the journal:

```ts
export async function checkpointSession(philName, tradition) {
  const now = Date.now();
  const firstTurn = conversationHistory.find(m => m.ts)?.ts ?? now;
  const today = new Date(firstTurn);
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const session = { date, philId, philName, tradition, startTs: firstTurn, endTs: now, exchanges: [...conversationHistory] };
  const all = await loadJournal();
  all.push(session);
  await saveJournal(all);
}
```

**Timestamp every turn.** Include `{ ts: Date.now() }` on every `conversationHistory.push()`. And stamp `userMood` + `emotion` on assistant turns. This metadata is gold for later extraction.

### Extraction endpoints (Vercel)

Two serverless functions that turn the journal into insight:

**`/api/problems`** — cluster user turns across all history into 3–7 recurring themes:
```js
const system = `Cluster the user's utterances into 3–7 recurring PROBLEM THEMES.
Return JSON: { problems: [{ title, summary, firstSeen, philosophers, exchangeCount, moods }] }`;
```

**`/api/actions`** — turn recent sessions into concrete TODOs:
```js
const system = `Turn recent conversations into 3–5 CONCRETE action items doable this week.
Preserve the philosopher's voice. Cite which philosopher inspired each action.
Return JSON: { actions: [{ title, detail, source, theme }] }`;
```

Both use `response_format: { type: 'json_object' }` for reliable parsing. Both take the journal as POST body, cap input to ~18KB.

---

## 7. Vercel proxy for API keys

**The bundle must never see your OpenAI key.** Everything in `src/` ships to the client. Keys live server-side in a tiny Vercel project:

```
sophicon-api/
├── api/
│   ├── speak.js       — GPT-4o chat, reads process.env.OPENAI_API_KEY
│   ├── transcribe.js  — gpt-4o-transcribe, WAV-wraps the PCM from the mic
│   ├── problems.js    — theme extraction
│   └── actions.js     — TODO generation
```

Client-side `speak.ts` calls `https://your-project.vercel.app/api/speak`. No key visible anywhere.

### Audio PCM → WAV → Whisper

The G2 mic delivers PCM at **16 kHz, 16-bit LE, 40 bytes per 10 ms frame**. To get it to OpenAI's transcribe endpoint, bolt on a 44-byte WAV header yourself (Whisper doesn't accept raw PCM):

```js
function createWavHeader(dataLength) {
  const h = Buffer.alloc(44);
  const sampleRate = 16000, bps = 16, channels = 1;
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLength, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22); h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * channels * bps/8, 28);
  h.writeUInt16LE(channels * bps/8, 32); h.writeUInt16LE(bps, 34);
  h.write('data', 36); h.writeUInt32LE(dataLength, 40);
  return h;
}
const wavBuffer = Buffer.concat([createWavHeader(pcm.length), pcm]);
// POST as multipart/form-data to https://api.openai.com/v1/audio/transcriptions with model=gpt-4o-transcribe
```

---

## 8. Lifecycle event handling

The SDK emits four lifecycle events via `sysEvent` with `eventType` 4–7:

| Code | Event | What to do |
|---|---|---|
| 4 | `FOREGROUND_ENTER_EVENT` | log, optionally re-render |
| 5 | `FOREGROUND_EXIT_EVENT` | **flush conversation history**, stop timers |
| 6 | `ABNORMAL_EXIT_EVENT` | release mic (`audioControl(false)`), unsubscribe, flush |
| 7 | `SYSTEM_EXIT_EVENT` | same cleanup as ABNORMAL_EXIT |

Important: **cancel any pending `setTimeout`s** (like the empathy→response sprite timer) in these handlers so they don't fire into a torn-down bridge.

Most apps forget #7 because the SDK 0.0.7 enum doesn't include it. Cast: `(type as number) === 7`.

---

## 9. Visual editor integration

If you're using or building a visual layout editor (like the D3 Container Editor used for soPHICON):

1. **Always do full-rewrite of `pages.layout.ts` on Save.** Surgical patches silently fail. No tier-1 bug is more common.

2. **Validate before writing:**
   - Reject duplicate `containerID` within a page
   - Reject duplicate `containerName` within a page
   - Reject multiple `isEventCapture: 1`
   - Reject zero `isEventCapture: 1` on a page that should receive events

3. **Auto-build after save.** Spawn `npm run build` from the editor's Save handler so the bundle is fresh. Pass the project's Node `PATH` explicitly (Electron processes often don't inherit Homebrew paths):
   ```js
   exec('npm run build', {
     cwd: projectPath, timeout: 30000,
     env: { ...process.env, PATH: `/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}` },
   }, ...);
   ```

4. **Emit `} as any)` in the generator** (not just `})`) so strict tsc accepts the excess style fields the editor saves.

---

## 10. Worked example file tree

A minimal conversational G2 app:

```
├── index.html                       phone-side WebView shell, tab bar
├── src/
│   ├── Main.ts                      boot — bridge, events, dashboard
│   ├── pages.layout.ts              editor-owned geometry
│   ├── pages.ts                     SDK composition + dynamic content
│   ├── events.ts                    event router, sprite cycle, lifecycle
│   ├── speak.ts                     voice pipeline, journal, empathy map
│   ├── image-utils.ts               pushSprite, pushEmotionPortrait, cache
│   ├── pngEncoder.ts                custom 8-bit grayscale PNG (120 lines)
│   ├── dashboard.ts                 tabbed webapp UI + pub/sub consumer
│   ├── style.css                    dark theme matching on-glass vibe
│   └── vite-env.d.ts                `/// <reference types="vite/client" />`
├── sophicon-api/
│   └── api/
│       ├── speak.js                 GPT-4o chat, dual-emotion prompt
│       ├── transcribe.js            Whisper via gpt-4o-transcribe
│       ├── problems.js              theme extraction
│       └── actions.js               action item generation
└── public/
    ├── personas.json                persona sheets (tone, principles, openings)
    └── sprites/<phil_id>/<phil_id>-<emotion>.png
```

---

## Tier-1 gotcha checklist

Run through this before shipping any G2 app:

- [ ] `capForGlass()` wraps every `TextContainerUpgrade`/`rebuildPageContainer` text content (999-byte limit)
- [ ] No Unicode symbols in on-glass strings (ASCII only)
- [ ] `?? 0` used on every `eventType` read (protobuf zero-value omission)
- [ ] Exactly one `isEventCapture: 1` per page
- [ ] Image containers never capture — use transparent text overlay if needed
- [ ] All BLE calls serialized (never concurrent `updateImageRawData`)
- [ ] `OPENAI_API_KEY` only in Vercel env, never in `src/`
- [ ] Sprite filenames match emotion names 1:1 (or synonym-normalized)
- [ ] `pushLogoToGlasses`/`pushEmotionPortrait` happens AFTER `rebuildPageContainer` (image containers are placeholders after rebuild)
- [ ] Lifecycle 4/5/6/7 handlers clean up pending timers + mic + history
- [ ] Visual editor does full-rewrite + validates before Save

---

## How to install this skill locally

Skills files live at `~/.claude/skills/<skill-name>/SKILL.md` on your Mac. To register this one:

```bash
mkdir -p ~/.claude/skills/g2-conversational-app
cp "~/Desktop/d3-apps/soPHICON ER-G2/skills/g2-conversational-app/SKILL.md" \
   ~/.claude/skills/g2-conversational-app/SKILL.md
```

Claude Code will auto-discover it on next session start. Invoke via `/g2-conversational-app` or by describing work that matches the trigger phrases in the frontmatter `description`.

---

## References

- `everything-evenhub` skill pack (handle-input, glasses-ui, sdk-reference) — for SDK basics this skill doesn't re-cover
- `@evenrealities/even_hub_sdk@0.0.7+` — `bridge.rebuildPageContainer`, `bridge.textContainerUpgrade`, `bridge.updateImageRawData`, `bridge.audioControl`, `bridge.setLocalStorage`
- **soPHICON G2 source** (this repo): pattern reference implementation of everything in this skill
