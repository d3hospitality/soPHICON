// ═══════════════════════════════════════════════════════════════════
// soΦcon — Page Builders v10 (two-file split)
//
// Geometry for every container comes from src/pages.layout.ts, which is
// rewritten in its entirety by the D3 Container Editor on every Save.
// This file supplies what the editor cannot generate:
//   • SDK wrappers (CreateStartUpPageContainer / RebuildPageContainer)
//   • Function parameters (tradition, philosopher, quote, …)
//   • Dynamic content (ListItemContainerProperty.itemName, text content)
//   • Exported constants consumed by events.ts
//     (HOME_LIST_ITEMS, SPEAK_INDEX, SPEAK_ACTION_*, SPEAK_WINDOW_SIZE)
//   • Helper functions (rebuildHomePage, getMindstateSelections)
//
// SpeakConversation layout:
//   C1 portrait  (Image)
//   C2 response  (Text)  — sliding window of conversation history
//   C3 controls  (List, capture=1) — [↑ Up · Speak/Stop/Thinking · ↓ Down]
//   C4 tradition (Text)
// ═══════════════════════════════════════════════════════════════════

import {
  EvenAppBridge,
  CreateStartUpPageContainer, RebuildPageContainer,
  ListContainerProperty, TextContainerProperty,
  ImageContainerProperty, ListItemContainerProperty,
} from '@evenrealities/even_hub_sdk';
import {
  buildHomePage as homeLayout,
  buildPhilosopherSelectPage as philosopherSelectLayout,
  buildMindstatePage as mindstateLayout,
  buildQuoteViewPage as quoteViewLayout,
  buildSpeakTraditionPage as speakTraditionLayout,
  buildSpeakPhilosopherPage as speakPhilosopherLayout,
  buildSpeakConversationPage as speakConversationLayout,
} from './pages.layout';
import {
  TRADITIONS, Tradition, Philosopher, Quote,
  getPhilosophersByTradition, getQuotePhilosophersByTradition,
  getRarity,
  capitalize, formatTag,
  getEmotionsForPhilosopher, getTagsForPhilosopher,
} from './constants';

// ═══ Constants consumed by events.ts ═══
// Home page lists enkiRIDION first (the entry to voice conversations),
// then ONLY traditions that have at least one quote-philosopher. Primordial
// (Enki's tradition) is filtered out here because Enki has no quotes —
// the home page is the quote-browse entry point. Enki stays reachable via
// Speak → Primordial which uses an unfiltered list.
export const BROWSABLE_TRADITIONS = TRADITIONS.filter(t =>
  getQuotePhilosophersByTradition(t).length > 0
);
// On-glass home list: enkiSPEAKS (voice conversations) → Public Aphorica
// (the community feed, a living "school of thought") → then the quote
// traditions. Index math in events.ts offsets traditions by TRAD_OFFSET.
export const HOME_LIST_ITEMS = ["enkiSPEAKS", "Public Aphorica", ...BROWSABLE_TRADITIONS];
export const SPEAK_INDEX = 0;
export const APHORICA_INDEX = 1;
export const TRAD_OFFSET = 2;   // first tradition sits at home index 2

// Speak conversation text pagination — per glasses-ui skill, text
// containers rebuild cleanly at ~400–500 char boundaries. Swipes fire
// textEvent (1 = SCROLL_TOP, 2 = SCROLL_BOTTOM); events.ts pages the
// conversation up/down and rebuilds C2 with the new slice.
export const SPEAK_PAGE_CHARS = 420;

// G2 firmware cap on text container content. SDK README says 2000 chars
// but LVGL rejects anything over 999 BYTES (observed in simulator:
// "TextContainerUpgrade failed: text content length 1184 exceeds limit
// of 999 bytes"). We cap at 940 bytes to leave headroom for the status
// prefix + page marker prepended by composeSpeakResponseContent.
export const SPEAK_BYTE_CAP = 940;

/**
 * UTF-8 byte-aware truncate. Most philosophical English is ASCII so
 * char count ≈ byte count, but multi-byte chars (smart quotes, em-dash)
 * push real byte length higher. TextEncoder gives exact bytes; we walk
 * back to a safe char boundary so we never cut mid-codepoint.
 */
export function capForGlass(s: string, maxBytes: number = SPEAK_BYTE_CAP): string {
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
    if (!out.endsWith("\uFFFD")) return out + "...";
    cut--;
  }
  return s.slice(0, 100) + "...";
}

/**
 * Group history into "exchanges" — one user turn + the philosopher's
 * reply become a single page. Any lone user turn at the end (mid-reply,
 * i.e. while the philosopher is still thinking) becomes its own page.
 * This produces the rolling-latest UX: each page = one round trip.
 */
export function rollExchanges(history: string[]): string[] {
  const out: string[] = [];
  let buf: string[] = [];
  for (const line of history) {
    buf.push(line);
    // A line that doesn't start with "YOU:" is the philosopher closing
    // the current exchange (user turn + reply = one rolled entry).
    if (!line.startsWith("YOU:") && buf.length > 1) {
      out.push(buf.join("\n\n"));
      buf = [];
    }
  }
  if (buf.length > 0) out.push(buf.join("\n\n"));
  return out.length > 0 ? out : [""];
}

/**
 * Word-aware pagination into fixed-char chunks. Prefers splitting at
 * the last space within the window so we never cut mid-word. Used by
 * buildReplyPages for the on-glass scrollable reply view.
 */
function paginateByChars(text: string, maxChars: number): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return [clean];
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < clean.length) {
    let end = Math.min(cursor + maxChars, clean.length);
    if (end < clean.length) {
      // Back off to the last space/newline in the window, but only if
      // it's not way too early (> 60% through the window).
      const window = clean.slice(cursor, end);
      const lastNl = window.lastIndexOf("\n");
      const lastSp = window.lastIndexOf(" ");
      const boundary = lastNl > maxChars * 0.6 ? lastNl
                     : lastSp > maxChars * 0.6 ? lastSp
                     : window.length;
      end = cursor + boundary;
    }
    pages.push(clean.slice(cursor, end).trim());
    cursor = end;
    while (cursor < clean.length && /\s/.test(clean[cursor])) cursor++;
  }
  return pages.length > 0 ? pages : [""];
}

/**
 * Build the page sequence shown in the on-glass response window.
 * Philosopher replies ONLY — your own utterances are hidden here (they
 * live in the Journal tab on the dashboard). Each reply is split into
 * chunks that fit under the firmware's text cap, so a long answer
 * paginates cleanly instead of getting truncated with "...".
 *
 * Page order (pageIndex 0 is the first page the user lands on):
 *   [newest reply chunk 1, newest reply chunk 2, ..., older reply chunk 1, ...]
 *
 * Swipe down = advance (keep reading the current reply; when you run
 * off the end of it, swipe again moves to the previous reply). Swipe
 * up = go backwards toward the newest.
 */
export function buildReplyPages(history: string[]): string[] {
  const replies = history.filter(line => !line.startsWith("YOU:"));
  if (replies.length === 0) return [""];

  // Budget per chunk: leave ~90 chars for the status prefix + page marker
  // ("Listening... (tap to send)  [2/5]\n") + a small safety cushion.
  const CHUNK_CHARS = 780;
  const pages: string[] = [];
  // Walk newest (end of array) → oldest so pageIndex 0 = newest reply's chunk 1.
  for (let i = replies.length - 1; i >= 0; i--) {
    const chunks = paginateByChars(replies[i], CHUNK_CHARS);
    for (const chunk of chunks) pages.push(chunk);
  }
  return pages;
}

/**
 * Turn the running conversation into ~420-char pages, newest last.
 * Messages are separated by a blank line ("\n\n") so the user can
 * visually parse their own turns vs the philosopher's. Page breaks
 * prefer newline boundaries, never mid-word unless a single message
 * exceeds the page size.
 *
 * (Kept for backward compatibility with other call sites; speak-
 * conversation now uses rollExchanges above.)
 */
export function paginateConversation(history: string[]): string[] {
  if (history.length === 0) return [""];
  const joined = history.join("\n\n");
  if (joined.length <= SPEAK_PAGE_CHARS) return [joined];
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < joined.length) {
    let end = Math.min(cursor + SPEAK_PAGE_CHARS, joined.length);
    if (end < joined.length) {
      // Prefer a blank-line boundary, then any newline
      const blank = joined.lastIndexOf("\n\n", end);
      const nl = joined.lastIndexOf("\n", end);
      if (blank > cursor + SPEAK_PAGE_CHARS / 2) end = blank;
      else if (nl > cursor + SPEAK_PAGE_CHARS / 2) end = nl;
    }
    pages.push(joined.slice(cursor, end).trimStart());
    cursor = end;
    // Skip separator characters at the start of the next page
    while (cursor < joined.length && joined[cursor] === "\n") cursor += 1;
  }
  return pages;
}

// ═══ Geometry lookup helpers ═══
type AnyContainer = TextContainerProperty | ListContainerProperty | ImageContainerProperty;
type Geo = { xPosition: number; yPosition: number; width: number; height: number };

function geo(layout: AnyContainer[], containerName: string): Geo {
  const c = layout.find(x => x.containerName === containerName);
  if (!c) throw new Error(`pages.layout: missing container '${containerName}'`);
  return {
    xPosition: c.xPosition ?? 0,
    yPosition: c.yPosition ?? 0,
    width: c.width ?? 0,
    height: c.height ?? 0,
  };
}

// ══════════════════════════════════════════════════════════════════
// S1 — HOME (5 containers)
// ══════════════════════════════════════════════════════════════════

// ═══ Glance line (P2 of docs/TRANSLATION-SYSTEM.md) ═══
// One authored line of cockpit/habit state under the wordmark, e.g.
// "TODAY · 1 BIG: Ship menu · Φ3d". The COMPANION sync writes it to
// bridge.localStorage ('glance_today', { d, line }); the glass only
// reads the cache — it never fetches. Stale days render as nothing.
let glanceLine = "";

export function setGlanceLine(line: string): void { glanceLine = line || ""; }

export async function loadGlanceLine(bridge: EvenAppBridge): Promise<void> {
  try {
    const raw = await bridge.getLocalStorage("glance_today");
    if (!raw) { glanceLine = ""; return; }
    const p = JSON.parse(raw);
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    glanceLine = (p && p.d === today && typeof p.line === "string") ? p.line : "";
  } catch { glanceLine = ""; }
}

function homeContainers() {
  const layout = homeLayout();
  const title = new TextContainerProperty({
    ...geo(layout, "title"),
    containerID: 1, containerName: "title",
    content: "enkiSPEAKS",
    isEventCapture: 0,
  });
  const glance = new TextContainerProperty({
    ...geo(layout, "glance"),
    containerID: 14, containerName: "glance",
    content: glanceLine,
    isEventCapture: 0,
  });
  const traditions = new ListContainerProperty({
    ...geo(layout, "traditions"),
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: HOME_LIST_ITEMS.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...HOME_LIST_ITEMS],
    }),
    isEventCapture: 1,
  });
  const logoTop = new ImageContainerProperty({
    ...geo(layout, "logo top"),
    containerID: 3, containerName: "logo top",
  });
  const logoBottom = new ImageContainerProperty({
    ...geo(layout, "logo bottom"),
    containerID: 10, containerName: "logo bottom",
  });
  return { title, glance, traditions, logoTop, logoBottom };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    containerTotalNum: 5,
    listObject: [c.traditions],
    textObject: [c.title, c.glance],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    containerTotalNum: 5,
    listObject: [c.traditions],
    textObject: [c.title, c.glance],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// S2 — PHILOSOPHER SELECT
// ══════════════════════════════════════════════════════════════════

/** Picks/Browse philosopher-select page.
 * Same navpad pattern as Speak — single TEXT container with capture,
 * `► NAME ◄` cursor on the active philosopher, plain mixed-case for the
 * rest. Filters out empty-quote philosophers (Enki etc.) so the
 * quote-viewer flow doesn't surface them. */
export function buildPhilosopherSelectPage(tradition: Tradition, index: number = 0): RebuildPageContainer {
  const layout = philosopherSelectLayout();
  const philosophers = getQuotePhilosophersByTradition(tradition);
  const total = philosophers.length;
  const idx = Math.max(0, Math.min(index, total - 1));

  // Use renderNavpad: ASCII >  < cursor (G2 LVGL font lacks ► ◄ glyphs),
  // windowed to 7 items so all rendered text fits in the 255px container
  // and the firmware's internal scroll never competes with our textEvent.
  const navText = total === 0
    ? '(no philosophers)'
    : renderNavpad(philosophers.map(p => p.name), idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: tradition, isEventCapture: 0,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "philosophers"),
    containerID: 2, containerName: "philosophers",
    content: navText,
    isEventCapture: 1,
  });
  const portraitTop = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
  });
  const portraitBottom = new ImageContainerProperty({
    ...geo(layout, "portrait-2"),
    containerID: 11, containerName: "portrait-2",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [portraitTop, portraitBottom],
  });
}

/** Public Aphorica — the community feed as a browsable on-glass list.
 * Each item is a one-line preview ("@handle · text…"); ring-swipe scrolls,
 * double-tap goes home. Items are supplied by events.ts from the live feed. */
export function buildAphoricaPage(items: string[], index: number = 0): RebuildPageContainer {
  const layout = philosopherSelectLayout();
  const total = items.length;
  const idx = Math.max(0, Math.min(index, Math.max(0, total - 1)));
  const navText = total === 0 ? '(no aphorisms yet)' : renderNavpad(items, idx, 7);
  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: "Public Aphorica", isEventCapture: 0,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "philosophers"),
    containerID: 2, containerName: "philosophers",
    content: navText, isEventCapture: 1,
  });
  return new RebuildPageContainer({
    containerTotalNum: 2,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// S3 — MINDSTATE BROWSE
// ══════════════════════════════════════════════════════════════════

/** Mindstate filter selection for a philosopher.
 * Same navpad pattern as Picks/Speak — but the item set is rich
 * (Shuffle + emotions + tags + Back). The currently-selected item
 * gets the `► NAME ◄` cursor, and as the user scrolls onto an EMOTION
 * item, the philosopher's sprite shifts to that emotion variant —
 * scrolling becomes a live preview of the philosopher in that mood. */
export function buildMindstatePage(philosopher: Philosopher, index: number = 0): RebuildPageContainer {
  const layout = mindstateLayout();
  const items = mindstateItemLabels(philosopher);
  const total = items.length;
  const idx = Math.max(0, Math.min(index, total - 1));

  // Use renderNavpad: ASCII >  < cursor (G2 LVGL font lacks ► ◄ glyphs),
  // windowed to 7 items so emotion list fits in the 255px container and
  // the firmware's internal scroll never competes with our textEvent —
  // each ring scroll advances the cursor by exactly one item.
  const navText = total === 0
    ? '(no emotions)'
    : renderNavpad(items, idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: philosopher.name, isEventCapture: 0,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "mindstates"),
    containerID: 2, containerName: "mindstates",
    content: navText,
    isEventCapture: 1,
  });
  const portraitTop = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
  });
  const portraitBottom = new ImageContainerProperty({
    ...geo(layout, "portrait-2"),
    containerID: 12, containerName: "portrait-2",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [portraitTop, portraitBottom],
  });
}

/** Mindstate page labels — emotions with quote counts. Matches the simple
 * philosopher-navpad pattern. Click commits, double-click goes back. */
export function mindstateItemLabels(philosopher: Philosopher): string[] {
  const emotions = getEmotionsForPhilosopher(philosopher);
  return emotions.map(e => {
    const count = philosopher.quotes.filter(q => q.emotion === e).length;
    return `${capitalize(e)} (${count})`;
  });
}

/** Render a navpad-style list: cursor on `idx`, windowed so the
 * rendered text always fits in the 255px text container (otherwise
 * the firmware's internal scroll competes with our textEvent handling
 * and the user has to scroll past invisible content before the cursor
 * advances). Windows around the cursor, clamped at list edges. */
function renderNavpad(items: string[], idx: number, windowSize: number = 7): string {
  const total = items.length;
  if (total === 0) return '';
  const win = Math.min(windowSize, total);
  const half = Math.floor(win / 2);
  // Clamp window so cursor stays as centered as possible without going
  // off-list at top or bottom.
  let start = Math.max(0, Math.min(idx - half, total - win));
  let end = start + win;
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    if (i === idx) lines.push(`•  ${items[i].toUpperCase()}  •`);
    else           lines.push(items[i]);
  }
  return lines.join('\n');
}

/** Just emotions now — same simple pattern as the philosopher navpads.
 * Click on the navpad commits the highlighted emotion to the quote
 * filter; double-click goes back. No more shuffle/tags/back items in
 * the list itself. */
export function getMindstateSelections(philosopher: Philosopher): {
  type: "emotion";
  value: string;
}[] {
  return getEmotionsForPhilosopher(philosopher).map(e => ({ type: "emotion" as const, value: e }));
}

// ══════════════════════════════════════════════════════════════════
// S4 — QUOTE VIEW (4 containers, no capturing list — uses sysEvent)
// ══════════════════════════════════════════════════════════════════

export function buildQuoteViewPage(
  philosopher: Philosopher,
  quote: Quote,
  quoteIndex: number,
  totalQuotes: number,
  isFavorite: boolean = false,
  _isShuffleMode: boolean = false,
): RebuildPageContainer {
  const layout = quoteViewLayout();
  const rarity = quote.rarity || getRarity(quote.rating);
  const favMark = isFavorite ? " ♥" : "";
  const titleCase = (s: string) => s.replace(/_/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  const quoteText = new TextContainerProperty({
    ...geo(layout, "quote"),
    containerID: 2, containerName: "quote",
    content: `"${quote.text}"`,
    // Capture: text container receives swipes as textEvent(1/2) and
    // clicks as sysEvent(0/3). Events.ts routes them for this page.
    isEventCapture: 1,
  });

  const sprite = new ImageContainerProperty({
    ...geo(layout, "sprite"),
    containerID: 3, containerName: "sprite",
  });

  const pos = String(quoteIndex + 1).padStart(3, '0');
  const tot = String(totalQuotes).padStart(3, '0');
  const line1 = `${pos}/${tot} - ${capitalize(quote.emotion)}${favMark}`;
  const line2 = `${philosopher.name}, ${quote.source}`;
  const filled = '\u2605'.repeat(quote.rating);
  const outline = '\u2606'.repeat(10 - quote.rating);
  const line3 = `${capitalize(String(rarity))} - ${quote.rating} ${filled}${outline}`;

  const tagParts: string[] = [];
  const used = new Set<string>();
  if (quote.blend) { const b = titleCase(quote.blend); tagParts.push(b); used.add(b.toLowerCase()); }
  if (quote.archetype) { const a = titleCase(quote.archetype); if (!used.has(a.toLowerCase())) { tagParts.push(a); used.add(a.toLowerCase()); } }
  for (const t of quote.tags) {
    const d = titleCase(t);
    if (!used.has(d.toLowerCase())) { tagParts.push(d); used.add(d.toLowerCase()); }
    if (tagParts.length >= 5) break;
  }
  const line4 = tagParts.length > 0 ? '\u00B7 ' + tagParts.join(' \u00B7 ') : '';
  const labelContent = [line1, line2, line3, line4].filter(Boolean).join('\n');

  const infoText = new TextContainerProperty({
    ...geo(layout, "text-3"),
    containerID: 13, containerName: "text-3",
    content: labelContent,
    isEventCapture: 0,
  });

  // No spacer — the SDK only caps at MAX 4 containers per page, it
  // doesn't require 4. Three real containers render cleaner.
  return new RebuildPageContainer({
    containerTotalNum: 3,
    listObject: [],
    textObject: [quoteText, infoText],
    imageObject: [sprite],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — TRADITION SELECT
// ══════════════════════════════════════════════════════════════════

export function buildSpeakTraditionPage(): RebuildPageContainer {
  const layout = speakTraditionLayout();
  const title = new TextContainerProperty({
    ...geo(layout, "title"),
    containerID: 1, containerName: "title",
    content: "enkiRIDION",
    isEventCapture: 0,
  });
  const tradList = new ListContainerProperty({
    ...geo(layout, "traditions"),
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: TRADITIONS.length + 1, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...TRADITIONS, "Back"],
    }),
    isEventCapture: 1,
  });
  const logoTop = new ImageContainerProperty({
    ...geo(layout, "logo top"),
    containerID: 3, containerName: "logo top",
  });
  const logoBottom = new ImageContainerProperty({
    ...geo(layout, "logo bottom"),
    containerID: 10, containerName: "logo bottom",
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [tradList],
    textObject: [title],
    imageObject: [logoTop, logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — PHILOSOPHER SELECT
// ══════════════════════════════════════════════════════════════════

/** Speak — Philosopher Select.
 * Renders the full philosopher list with a cursor (`►`) on the currently-
 * selected one, framed by ↑/↓ glyphs hinting at the swipe gesture. The
 * text container captures swipes (navigate up/down through the list)
 * and clicks (commit selection / double-click to go back).
 * State is owned by events.ts (see speakSelectedIndex). Webapp drives
 * the same state via setSpeakSelectedIndex. */
export function buildSpeakPhilosopherPage(tradition: Tradition, index: number = 0): RebuildPageContainer {
  const layout = speakPhilosopherLayout();
  const philosophers = getPhilosophersByTradition(tradition);
  const total = philosophers.length;
  const idx = Math.max(0, Math.min(index, total - 1));

  // Compose the navpad text via renderNavpad. Shape:
  //
  //      Socrates
  //   >  PLATO  <
  //      Aristotle
  //
  // Selected item gets ASCII `>  NAME  <` cursor + uppercase (G2 LVGL
  // font has no ► ◄ glyphs — they render as tofu boxes). Unselected
  // items stay plain mixed-case. Block is centered both axes (line
  // gravity + container gravity) so it aligns with the sprite at x=400.
  // Windowed to 7 items so the rendered text fits in the 255px container
  // and the firmware's internal scroll never competes with our textEvent.
  const navText = total === 0
    ? '(no philosophers)'
    : renderNavpad(philosophers.map(p => p.name), idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: `Speak: ${tradition}`, isEventCapture: 0,
  });
  // Replaces the previous firmware-managed list. We control the cursor.
  const navpad = new TextContainerProperty({
    ...geo(layout, "navpad"),
    containerID: 2, containerName: "navpad",
    content: navText,
    isEventCapture: 1,
  });
  const portrait = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
  });
  const branding = new TextContainerProperty({
    ...geo(layout, "branding"),
    containerID: 4, containerName: "branding",
    content: "enkiRIDION",
    isEventCapture: 0,
  });
  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, navpad, branding],
    imageObject: [portrait],
  });
}

// ══════════════════════════════════════════════════════════════════
// SPEAK — CONVERSATION (per 2026-04-23 redesign)
//
// Layout (2 containers — editor-stripped 2026-04-23 to a full-screen
// conversation view, no portrait):
//   C2 response  (Text, isEventCapture: 1) — THE page. Swipes paginate,
//                 single-press toggles mic, double-press → goBack().
//   C4 tradition (Text) — tradition label in the bottom-right corner.
//
// Text containers receive swipe gestures as textEvent (1=SCROLL_TOP,
// 2=SCROLL_BOTTOM) and clicks as sysEvent (0=single, 3=double).
// Only one capturing container per page — C2 is it.
//
// If you re-add a portrait in the editor later (container name "portrait"),
// also restore the ImageContainerProperty block below and bump
// containerTotalNum; see `pushEmotionPortrait` in events.ts for how the
// face was driven previously.
// ══════════════════════════════════════════════════════════════════

export function buildSpeakConversationPage(
  philosopherName: string,
  tradition: string,
  responseText: string,
  isListening: boolean = false,
  history: string[] = [],
  pageIndex: number = 0,
  isThinking: boolean = false,
): RebuildPageContainer {
  const layout = speakConversationLayout();

  // C1 — emotion-reactive portrait (100×100 top-left)
  const portrait = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 1, containerName: "portrait",
  });

  // C2 — conversation (text, capturing)
  // REPLY-FOCUSED: only the philosopher's words are shown here. Your
  // own TTS text lives in the Journal tab, not on-glass. Replies are
  // byte-paginated so a long answer becomes [1/3], [2/3], [3/3]
  // instead of getting chopped with "...". pageIndex 0 = newest reply,
  // first chunk (what you land on after thinking completes). Swipe
  // down walks forward through the reply's chunks and then backward
  // through older replies.
  const pages = buildReplyPages(history);
  const clampedIdx = Math.max(0, Math.min(pageIndex, pages.length - 1));
  const shownChunk = pages.length > 0 ? pages[clampedIdx] : `${philosopherName}: ${responseText}`;

  // Status prefix — visual mic states (LVGL font does render these
  // geometric glyphs; our earlier ASCII-only theory was wrong).
  //   ● Listening   — mic open, capturing
  //   ■ Thinking    — request in flight to /api/speak
  //   □ Tap to speak — idle, mic closed, waiting for user
  const status = isThinking
    ? "■ Thinking"
    : (isListening ? "● Listening (tap to send)" : "□ Tap to speak");
  const pageMarker = pages.length > 1 ? `  [${clampedIdx + 1}/${pages.length}]` : "";
  const visibleContent = capForGlass(`${status}${pageMarker}\n${shownChunk}`);

  const responseBox = new TextContainerProperty({
    ...geo(layout, "response"),
    containerID: 2, containerName: "response",
    content: visibleContent,
    isEventCapture: 1, // captures swipes + clicks for this page
  });

  // C4 — philosopher name (e.g. "Socrates")
  const philName = new TextContainerProperty({
    ...geo(layout, "phil-name"),
    containerID: 4, containerName: "phil-name",
    content: philosopherName,
    isEventCapture: 0,
  });

  // C5 — school of philosophy / tradition (e.g. "Greek")
  const philSchool = new TextContainerProperty({
    ...geo(layout, "phil-school"),
    containerID: 5, containerName: "phil-school",
    content: tradition,
    isEventCapture: 0,
  });

  return new RebuildPageContainer({
    containerTotalNum: 4,
    listObject: [],
    textObject: [responseBox, philName, philSchool],
    imageObject: [portrait],
  });
}

/**
 * How many "pages" the speak-conversation page exposes — one per
 * byte-safe chunk of philosopher reply, summed across all prior replies.
 * User turns are NOT counted (they're not shown on-glass — they live
 * in the Journal tab on the dashboard instead).
 */
export function speakConversationPageCount(history: string[]): number {
  return buildReplyPages(history).length;
}

// ══════════════════════════════════════════════════════════════════
// MINDFULNESS MODE — two-state page: BLANK (waiting for next quote)
// and QUOTE (showing for meditation). Pages are hand-coded, not from
// pages.layout.ts — they're system utilities, shouldn't be repositioned.
//
// Flow:
//   BLANK → (timer fires) → QUOTE → (timer fires / click) → BLANK
//   BLANK + click = skip to next quote immediately
//   Double-tap on either = exit mindfulness mode
// ══════════════════════════════════════════════════════════════════

/** Dark, minimal page. Full-screen transparent text container captures clicks. */
export function buildMindfulnessBlankPage(): RebuildPageContainer {
  const shell = new TextContainerProperty({
    xPosition: 0, yPosition: 0, width: 576, height: 288,
    containerID: 1, containerName: "mindful-blank",
    content: "",       // empty = blank/dark screen
    isEventCapture: 1, // the only container, captures ring events
  } as any);
  return new RebuildPageContainer({
    containerTotalNum: 1,
    listObject: [],
    textObject: [shell],
    imageObject: [],
  });
}

// NOTE: the mindfulness QUOTE state reuses buildQuoteViewPage() directly
// from events.ts — same layout as Browse > Quote (sprite + quote + rich
// meta strip). No dedicated builder here; currentPage = "mindful-quote"
// is what distinguishes it for event routing, not the page geometry.

/**
 * Compose ONLY the response-text content that would be rendered in C2.
 * Used by events.ts for textContainerUpgrade on swipe pagination, so
 * we don't rebuild the whole page (which would blank the portrait
 * container and force a sprite re-push).
 *
 * PageIndex 0 = first chunk of the newest reply (what you see right
 * after "Thinking..." resolves). Swipe down keeps reading.
 */
export function composeSpeakResponseContent(
  philosopherName: string,
  _tradition: string,
  responseText: string,
  isListening: boolean = false,
  history: string[] = [],
  pageIndex: number = 0,
  isThinking: boolean = false,
): string {
  const pages = buildReplyPages(history);
  const fallback = `${philosopherName}: ${responseText}`;
  const clampedIdx = Math.max(0, Math.min(pageIndex, Math.max(0, pages.length - 1)));
  const shown = pages.length > 0 ? pages[clampedIdx] : fallback;
  // Visual mic states — same as buildSpeakConversationPage.
  //   ● Listening   ■ Thinking   □ Tap to speak
  const status = isThinking
    ? "■ Thinking"
    : (isListening ? "● Listening (tap to send)" : "□ Tap to speak");
  const marker = pages.length > 1 ? `  [${clampedIdx + 1}/${pages.length}]` : "";
  return capForGlass(`${status}${marker}\n${shown}`);
}
