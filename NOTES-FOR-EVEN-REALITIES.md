# Notes for Even Realities

Written from building **soPHICON G2** on `@evenrealities/even_hub_sdk@0.0.7` + Vite + TypeScript. Ordered by the **actual hours lost** to each issue while building. Intended as engineering feedback — not a complaint — and sized so you can skim in five minutes.

Each item: **what bit me → why → concrete fix**.

---

## Tier 1 — Cost me a full day or more

### 1. Custom grayscale PNG encoder required; standard encoders silently fail

The G2 firmware only accepts 8-bit grayscale PNGs with **no filter byte**, **uncompressed DEFLATE blocks**, and explicit **Adler32 + CRC32** checksums. Pass it a 24-bit RGB PNG or a DEFLATE-compressed 8-bit PNG through `updateImageRawData` and it fails silently — no error, no render, container stays blank.

I only figured this out by tracing through the SDK's image pipeline + comparing working samples byte-for-byte. Then wrote my own 120-line encoder (`src/pngEncoder.ts`) from scratch. Every other G2 app I've seen quietly does the same.

**Fix:** ship a PNG helper in the SDK:

```ts
import { pngEncode } from '@evenrealities/even_hub_sdk';
const bytes = pngEncode.grayscale(width, height, pixels);
await bridge.updateImageRawData({ containerID, imageData: bytes });
```

Would delete 120 lines of fragile bit-shuffling from every image-using app.

### 2. Protobuf zero-value omission silently breaks event handling

Any field with value `0`, `false`, or empty-string arrives on the JS side as `undefined`. This matters enormously for events:

- `sysEvent.eventType === 0` means single-click — arrives as `undefined`
- `listEvent.currentSelectItemIndex === 0` means first item — arrives as `undefined`

I shipped a bug for weeks where single-click handling on my quote page used `type === OsEventTypeList.SINGLE_CLICK_EVENT || type === 1` as a fallback. That "|| 1" was wrong — `1` is `SCROLL_TOP_EVENT`. Every swipe-up on the quote page was being treated as a click and reshuffling the quote.

**Fix:** either normalize inside the SDK so zero-valued enum fields are always concrete, OR put a huge warning in the event-listening docs with the `?? 0` pattern. Even better: add a linter rule or runtime sanity check.

### 3. `OsEventTypeList.SINGLE_CLICK_EVENT` doesn't exist — but `.CLICK_EVENT = 0` does

I reached for `SINGLE_CLICK_EVENT` confidently. It's not in the enum. TypeScript's enum member access returns `undefined` without a type error (known TS quirk). The runtime check silently never matches. The correct name is `CLICK_EVENT`.

**Fix:** either alias `SINGLE_CLICK_EVENT → CLICK_EVENT` in the enum, or change the declared name entirely. The docs use "single click" in prose, so the mismatch is a real trap.

### 4. Text containers CAN capture events — but the README implies only lists do

The "Event Listening" section of the SDK README focuses on `listEvent`, with click/scroll examples all anchored on lists. Nothing there tells you that a **Text container with `isEventCapture: 1`** will receive:

- `textEvent.eventType === 1/2` for swipe up/down
- `sysEvent.eventType === 0/3` for click / double-click

I spent two evenings building a 3-button control strip (↑ / Speak / ↓ as a list) to work around what I thought was an SDK limitation — text couldn't handle clicks. It can. The workaround was all unnecessary. I learned the real model only after getting access to David's `@evenrealities/everything-evenhub` Claude skill set.

**Fix:** add a single reference table to the SDK README:

| Container type with `isEventCapture: 1` | Click → | Swipe → |
|------|------|------|
| List  | `listEvent` (with index) | handled internally, no event |
| Text  | `sysEvent` | `textEvent` |
| Image | *not allowed* (use a full-screen text capture layer) | *n/a* |

This one table would've saved me ~8 hours.

---

## Tier 2 — Meaningful friction

### 5. SDK types don't declare fields the firmware reads

The D3 Container Editor I built emits `textSize`, `textColor`, `bgColor`, `gravity`, `itemHeight` on containers. The firmware reads those fields. But `TextContainerProperty` / `ListContainerProperty` / `ImageContainerProperty` TypeScript classes don't declare them. Strict tsc rejects them as excess properties.

Workaround I ended up with: cast every container construction `as any`. Ugly, bypasses types, loses autocomplete on the legitimate SDK fields.

**Fix:** declare all firmware-supported fields in the class types (even if optional). If some are experimental, mark them with JSDoc but keep them typed.

### 6. `createStartUpPageContainer` silently no-ops on second call

Documented as one-shot, and the return code does indicate failure. But when I accidentally called it twice during development (re-mount, HMR), the app just... didn't update. No console warning. No distinctive error code.

**Fix:** return a specific error code like `AlreadyInitialized` and log a warning to the WebView console on the second call. Or at least a clear return-code constant.

### 7. Pages with zero `isEventCapture: 1` render but receive no input

If you forget to mark any container with capture, the page looks fine on-screen but the ring does nothing. No warning at creation, no error, just eerie unresponsiveness. Debugging this the first time is a 30-minute journey.

**Fix:** at page creation, warn if no capturing container exists. Optionally auto-promote the first list/text container with a log message.

### 8. Multiple `isEventCapture: 1` containers fail opaquely

The inverse of #7. Set capture on two containers (easy to do when iterating) and `createStartUpPageContainer` returns `1` (invalid). Which container is the problem? No idea without inspecting manually.

**Fix:** return a diagnostic:

```ts
{ ok: false, reason: "multiple-event-capture", containerIDs: [2, 3] }
```

### 9. BLE link concurrency crashes; the SDK doesn't serialize for you

All bridge calls share one BLE link. Concurrent `updateImageRawData` + `setLocalStorage` can hang the connection for 30+ seconds. Every app ends up implementing its own queue and per-call timeouts via `Promise.race`.

**Fix:** ship an internal FIFO queue inside `EvenAppBridge`. All methods take a turn, configurable timeout per call. Every app built on this SDK needs this, so it should live at the platform layer.

### 10. No live-reload story for on-glass iteration

Vite HMR works in the simulator. But to see changes on actual glass, I rebuild + redeploy + reload. My feedback loop for a 1-character content edit was 30–45 seconds. I ended up wiring a "build on save" into my visual layout editor so the loop is tighter, but this is really a platform feature.

**Fix:** a dev-mode flag on the WebView that refetches the bundle on a poll, or an HMR websocket.

---

## Tier 3 — Paper cuts

### 11. List items clip silently at 64 chars

No ellipsis, no warning. First long item I rendered was `"Socrates: The unexamined life is n"` — cut off mid-word. Had to add my own `truncate(s, 60)` everywhere.

**Fix:** render an ellipsis automatically when content exceeds the limit, or log a warning.

### 12. `textContainerUpgrade` is the fast path but easy to miss

Most devs reach for `rebuildPageContainer` to update text. `textContainerUpgrade` updates in-place without re-rendering the whole page — dramatically smoother for counters, auto-rotating quotes, status lines. The README mentions it but in a generic "it exists" tone.

**Fix:** in the "Creating Glasses UI" section, call this out as **the** idiomatic way to push text updates. Include a worked example (counter, quote-rotator) to cement the pattern.

### 13. Audio PCM → WAV → Whisper pipeline is non-trivial

PCM comes in at 16 kHz / 16-bit LE / 40 B per 10 ms frame. To send to GPT-4o-transcribe, you have to bolt on a 44-byte WAV header and POST as multipart form data. I ended up building the WAV header by hand in a Vercel function. No helper in the SDK.

**Fix:** ship `bridge.exportRecordingAsWav(pcmChunks)` returning a `Blob` ready for upload. Turns a 40-line dance into one call.

### 14. `ListItemContainerProperty` max item count (20) isn't enforced in types

You can build an items array of any length. At runtime, only the first 20 render. No warning.

**Fix:** either enforce at construction time or warn.

### 15. Simulator vs glass input differences

I had some subtle behavior differences in how text containers dispatched click/swipe events between the Even Hub Simulator and actual glass. Not sure if this is still true on latest firmware — wasn't major but was confusing mid-build.

**Fix:** (possibly already fixed) — a parity test suite would be great.

---

## What went well (for balance)

These were genuinely great and I want to make sure this doesn't read as a complaint-only memo:

- **`waitForEvenAppBridge()`** — zero-config, the right abstraction. Bridge "just appears."
- **`onDeviceStatusChanged`** as a real-time push — battery, connection, wearing — saves a ton of polling code.
- **`setLocalStorage` / `getLocalStorage`** as a persistent KV on the phone side is wonderful. I use it for per-philosopher conversation history without any backend work.
- **List → ring scroll + click** is tight. For list-based navigation, zero friction.
- **Even Hub Simulator launching a real WebView at the dev URL** and letting you test on Mac was the single thing that made me believe this platform would ship. The `evenhub-simulator` CLI is excellent.
- **Persona-sheet pattern for conversational agents** wasn't prescribed by the SDK but the localStorage + bridge event model makes it trivial. soPHICON Speaks exists because the primitives are composable.

---

## Meta: what I'd want next

If I could wave a wand and the SDK had three more things:

1. **An `@even-realities/ui` companion package** with battery-tested building blocks: paginated long-form text, scrollable history lists with text clipping, image-with-caption, tabbed pages. Most G2 apps will converge on the same handful of patterns — a shared kit prevents 100 people from re-inventing `paginate(text, 420)`.
2. **A CLI `evenhub doctor` command** that inspects a project and flags the classic traps (no `isEventCapture: 1`, multiple captures, oversized list items, missing audio cleanup on exit, etc.) before deploying.
3. **Sprite + image prompting helper** for apps like soPHICON that generate custom character art. Right now this is a separate pipeline entirely; getting it into the platform story (even as templates) would unlock a lot of shipped apps faster.

Happy to talk to any of this in detail. Source is here to read and pull apart — ask about any choice.

— Romario · D3 Hospitality
