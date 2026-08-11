// ═══════════════════════════════════════════════════════════════════
// soΦcon — Page Builders v11 (two-file split + glass chrome)
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
//   • zOrderIndex on every container (SDK 0.0.12, all-or-nothing per
//     page, unique values). NO border frames — see "Glass chrome" below.
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
  MenuContainerProperty, MenuItemProperty,
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
import { ghostPreset } from './image-utils';
import { supportEnabled, supportStoryPages } from './support';
import { tGlass, tQuote, tMeta } from './i18n';
import { hostSupports214 } from './host';

// ═══ Constants consumed by events.ts ═══
// Home page lists enkiRIDION first (the entry to voice conversations),
// then ONLY traditions that have at least one quote-philosopher. Primordial
// (Enki's tradition) is filtered out here because Enki has no quotes —
// the home page is the quote-browse entry point. Enki stays reachable via
// Speak → Primordial which uses an unfiltered list.
export const BROWSABLE_TRADITIONS = TRADITIONS.filter(t =>
  getQuotePhilosophersByTradition(t).length > 0
);
// On-glass home list — FOUR destinations, nothing else:
//
//   enkiSPEAKS       voice conversations
//   Public Aphorica  the community feed, a living "school of thought"
//   Philosophies     the quote-browse entry → tradition list
//   Support the dev  the tip jar (hidden when there's nowhere to send)
//
// The eight quote traditions used to sit inline here, which made home a
// scrolling menu you had to walk past to reach anything below it —
// Support in particular was ten rows down. They now live one level
// deeper, behind Philosophies, so home stays a short, stable list where
// every row is visible at once and nothing moves when the corpus grows.
//
// A FUNCTION, not a const: this file is imported before the language
// tables load, so a module-level array would freeze the home list in
// English and never repaint when the user switches language.
export function homeListItems(): string[] {
  return [
    tGlass('g.speak'),
    tGlass('g.aphorica'),
    tGlass('g.philosophies'),
    ...(supportEnabled() ? [`● ${tGlass('g.support')}`] : []),
  ];
}
export const SPEAK_INDEX = 0;
export const APHORICA_INDEX = 1;
export const PHILOSOPHIES_INDEX = 2;
/** Home index of the Support row, or -1 when the surface is gated off —
 *  -1 never matches a real click index, so callers need no extra guard. */
export const SUPPORT_INDEX = supportEnabled() ? 3 : -1;

/** Traditions live on their own page now, indexed from 0 with a trailing
 *  Back row — so no offset math anywhere. */
export function traditionListItems(): string[] {
  return [...BROWSABLE_TRADITIONS.map(t => tMeta(t, true)), tGlass('g.back')];
}

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

// ═══ Contextual menu (SDK 0.0.14, firmware 2.2.9) ═══
// Opens on TAP-AND-HOLD (one fast tap, then hold — not a plain long
// press). Every entry is an action item: the user selects it, events.ts
// receives one menuItemClickEvent carrying itemID, and the interaction
// is over. Verbs only — an action item gives no state feedback.
//
// itemIDs are GLOBAL and stable: one ID means one command on every page
// it appears, so the handler in events.ts is a single switch. Never
// reuse an ID for a different meaning; new commands take new IDs.
export const MENU_HOME = 1;
export const MENU_SURPRISE = 2;
export const MENU_FAVORITE = 3;
export const MENU_SPEAK_THIS = 4;
export const MENU_END_CONVO = 5;
export const MENU_REFRESH = 6;
export const MENU_DEV_STORY = 7;
export const MENU_NEW_MINDFUL = 8;
export const MENU_TIP_JAR = 9;
export const MENU_RESTART_STORY = 10;
export const MENU_SHOW_FAVORITES = 11;
export const MENU_SHOW_CALENDAR = 12;
export const MENU_LIKE_POST = 13;
export const MENU_LOG_REPLY = 14;
export const MENU_UNFAVORITE = 15;
export const MENU_CAL_TODAY = 16;

/** Truncate a menu label to the firmware's 32-UTF-8-byte cap.
 *
 * translate_ui.mjs refuses to ship an over-long translation, so this
 * should never fire — but the SDK rejects the ENTIRE page payload on
 * one bad label (INVALID_MENU_ITEM_NAME), which blanks the glasses.
 * A truncated label is a cosmetic bug; a blank display is an outage. */
function menuLabel(s: string): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= 32) return s;
  let out = s;
  while (out.length > 0 && enc.encode(out).length > 32) out = out.slice(0, -1);
  return out;
}

type MenuSpec = ReadonlyArray<readonly [label: string, itemID: number]>;

/** Build the page's menuObject. position 0 keeps payload order.
 *  Returns undefined on pre-2.2.9 hosts (desktop simulator): an omitted
 *  menuObject is valid on every protocol version, while an unknown
 *  field rejects the whole page. */
function menu(items: MenuSpec): MenuContainerProperty | undefined {
  if (!hostSupports214) return undefined;
  return new MenuContainerProperty({
    menuItems: items.map(([label, itemID]) => new MenuItemProperty({
      itemName: menuLabel(label), itemID, position: 0,
    })),
  });
}

/** Per-page menus. A FUNCTION per page (not consts) so labels re-read
 *  the dictionary on every rebuild — same reason homeListItems() is a
 *  function. Composition per docs/GLASS-PAGES.md. */
function homeMenu()      { return menu([[tGlass('g.menuSurprise'), MENU_SURPRISE], [tGlass('g.menuShowFavorites'), MENU_SHOW_FAVORITES], [tGlass('g.menuShowCalendar'), MENU_SHOW_CALENDAR], [tGlass('g.menuDevStory'), MENU_DEV_STORY]]); }
function browseMenu()    { return menu([[tGlass('g.menuSurprise'), MENU_SURPRISE], [tGlass('g.menuHome'), MENU_HOME]]); }
function quoteMenu()     { return menu([[tGlass('g.menuFavorite'), MENU_FAVORITE], [tGlass('g.menuSpeakThis'), MENU_SPEAK_THIS], [tGlass('g.menuSurprise'), MENU_SURPRISE], [tGlass('g.menuHome'), MENU_HOME]]); }
function transitMenu()   { return menu([[tGlass('g.menuHome'), MENU_HOME]]); }
function convoMenu()     { return menu([[tGlass('g.menuLogReply'), MENU_LOG_REPLY], [tGlass('g.menuEndConvo'), MENU_END_CONVO], [tGlass('g.menuHome'), MENU_HOME]]); }
export function mindfulMenu()   { return menu([[tGlass('g.menuFavorite'), MENU_FAVORITE], [tGlass('g.menuNewMindful'), MENU_NEW_MINDFUL], [tGlass('g.menuHome'), MENU_HOME]]); }
function aphoricaMenu()  { return menu([[tGlass('g.menuRefresh'), MENU_REFRESH], [tGlass('g.menuHome'), MENU_HOME]]); }
function aphoricaReadMenu() { return menu([[tGlass('g.menuLikePost'), MENU_LIKE_POST], [tGlass('g.menuRefresh'), MENU_REFRESH], [tGlass('g.menuHome'), MENU_HOME]]); }
export function favMenu()   { return menu([[tGlass('g.menuSpeakThis'), MENU_SPEAK_THIS], [tGlass('g.menuUnfavorite'), MENU_UNFAVORITE], [tGlass('g.menuHome'), MENU_HOME]]); }
function calMenu()          { return menu([[tGlass('g.menuCalToday'), MENU_CAL_TODAY], [tGlass('g.menuHome'), MENU_HOME]]); }
function supportMenu()   { return menu([[tGlass('g.menuTipJar'), MENU_TIP_JAR], [tGlass('g.menuRestartStory'), MENU_RESTART_STORY], [tGlass('g.menuHome'), MENU_HOME]]); }

// ═══ Glass chrome ═══
// NO BORDER BOXES. Earlier versions drew empty bordered text containers
// behind the quote and the sprite (a "bright" frame on the text, a "dim"
// one on the portrait). They are gone deliberately: on a 576×288
// monochrome HUD every lit pixel competes with the content, and boxing
// a quote makes it read as a UI widget rather than as something someone
// said. Separation on this display comes from whitespace and position,
// not from drawn rules.
//
// The ONE border that stays is the firmware's own list selection
// highlight (`isItemSelectBorderEn: 1`). That is not decoration — it is
// the only thing telling the wearer which row the ring is pointing at.
//
// If a future page feels like it needs a frame, it almost certainly
// needs more margin instead.

/** Thin progress bar from the official G2 character set
 * (design-guidelines#useful-characters): ━ filled, ─ empty. */
function progressBar(current: number, total: number, segments: number): string {
  if (total <= 0) return '─'.repeat(segments);
  const filled = Math.max(1, Math.min(segments, Math.round((current / total) * segments)));
  return '━'.repeat(filled) + '─'.repeat(segments - filled);
}

/** Divide machine-ish words (snake_case, kebab-case, camelCase) into
 * spaced words and capitalize the first letter of each — profile data
 * points render "Seeker Of Balance", never "seeker_of_balance". */
function titleWords(s: string): string {
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Free-text data point: first letter capitalized, truncated with … so a
 * long field stays on one line of the info strip (no surprise wraps). */
function capPoint(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return capped.length <= max ? capped : capped.slice(0, max - 1).trimEnd() + '…';
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
  const homeItems = homeListItems();

  // ── Home layout ────────────────────────────────────────────────────
  // Menu left, mark right, side by side. They do NOT overlap, and that
  // is a firmware constraint rather than taste:
  //
  //   IMAGE CONTAINERS ARE OPAQUE AND PAINT OVER TEXT, regardless of
  //   zOrderIndex. A pass that centred the mark behind the menu (list at
  //   zOrderIndex 7, image at 4) still had the image erase the row text
  //   it covered. A watermark *behind* copy cannot exist on this panel.
  //
  // Given that, side-by-side is what lets the mark stay FULL SIZE
  // (200x200, its native square) instead of being squeezed into a
  // letterboxed sliver above the menu. The menu is four rows now, so it
  // is centred vertically in its column rather than top-anchored.
  const LIST_W = 265, LIST_H = 4 * 40;              // 40px firmware row pitch
  const LIST_X = 62;
  const LIST_Y = Math.round((288 - LIST_H) / 2);    // 64
  // Vertically centred: (288 - 200) / 2 = 44. Horizontally centred in the
  // column right of the menu: 327 + (249 - 200) / 2 = 351.
  const MARK_X = 351, MARK_Y = 44, MARK_W = 200, MARK_H = 100;  // x2 halves = 200x200

  const title = new TextContainerProperty({
    ...geo(layout, "title"),
    xPosition: 351, yPosition: 248, width: 200, height: 34,
    containerID: 1, containerName: "title",
    content: "enkiRIDION",
    isEventCapture: 0,
    zOrderIndex: 5,
  });
  const glance = new TextContainerProperty({
    ...geo(layout, "glance"),
    xPosition: 24, yPosition: 246, width: 310, height: 34,
    containerID: 14, containerName: "glance",
    ...(hostSupports214 ? { textColor: 3 } : {}),
    content: glanceLine,
    isEventCapture: 0,
    zOrderIndex: 6,
  });
  const traditions = new ListContainerProperty({
    ...geo(layout, "traditions"),
    xPosition: LIST_X, yPosition: LIST_Y, width: LIST_W, height: LIST_H,
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: homeItems.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...homeItems],
    }),
    isEventCapture: 1,
    zOrderIndex: 7,
  });
  const logoTop = new ImageContainerProperty({
    ...geo(layout, "logo top"),
    xPosition: MARK_X, yPosition: MARK_Y, width: MARK_W, height: MARK_H,
    containerID: 3, containerName: "logo top",
    zOrderIndex: 3,
  });
  const logoBottom = new ImageContainerProperty({
    ...geo(layout, "logo bottom"),
    xPosition: MARK_X, yPosition: MARK_Y + MARK_H, width: MARK_W, height: MARK_H,
    containerID: 10, containerName: "logo bottom",
    zOrderIndex: 4,
  });
  return { title, glance, traditions, logoTop, logoBottom };
}

export function buildHomePage(): CreateStartUpPageContainer {
  const c = homeContainers();
  return new CreateStartUpPageContainer({
    menuObject: homeMenu(),
    containerTotalNum: 5,
    listObject: [c.traditions],
    textObject: [c.title, c.glance],
    imageObject: [c.logoTop, c.logoBottom],
  });
}

export function rebuildHomePage(): RebuildPageContainer {
  const c = homeContainers();
  return new RebuildPageContainer({
    menuObject: homeMenu(),
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
 * `▶ NAME ◀` cursor on the active philosopher, plain mixed-case for the
 * rest. Filters out empty-quote philosophers (Enki etc.) so the
 * quote-viewer flow doesn't surface them. */
export function buildPhilosopherSelectPage(tradition: Tradition, index: number = 0): RebuildPageContainer {
  const layout = philosopherSelectLayout();
  const philosophers = getQuotePhilosophersByTradition(tradition);
  const total = philosophers.length;
  const idx = Math.max(0, Math.min(index, total - 1));

  // Use renderNavpad: ▶ NAME ◀ cursor (official useful-characters set),
  // windowed to 7 items so all rendered text fits in the 255px container
  // and the firmware's internal scroll never competes with our textEvent.
  const navText = total === 0
    ? tGlass('g.noPhilosophers')
    : renderNavpad(philosophers.map(p => tMeta(p.name, true)), idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: tradition, isEventCapture: 0,
    zOrderIndex: 5,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "philosophers"),
    containerID: 2, containerName: "philosophers",
    content: navText,
    isEventCapture: 1,
    zOrderIndex: 6,
  });
  const portraitTop = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
    zOrderIndex: 3,
  });
  const portraitBottom = new ImageContainerProperty({
    ...geo(layout, "portrait-2"),
    containerID: 11, containerName: "portrait-2",
    zOrderIndex: 4,
  });
  return new RebuildPageContainer({
    menuObject: browseMenu(),
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [portraitTop, portraitBottom],
  });
}

/** Public Aphorica — LEVEL 1: browse community members like philosophers.
 * Each item is one author ("@handle · SAGE (n)") tagged by their status;
 * ring-swipe scrolls, click opens that author's thoughts, double-tap goes
 * home. Items are supplied by events.ts from the live feed. */
export function buildAphoricaPage(items: string[], index: number = 0): RebuildPageContainer {
  const layout = philosopherSelectLayout();
  const total = items.length;
  const idx = Math.max(0, Math.min(index, Math.max(0, total - 1)));
  const navText = total === 0 ? '(no members yet)' : renderNavpad(items, idx, 7);
  // No portrait here (unlike philosopher-select), so reclaim the full 576px
  // width for the member list — long/weird handles get room to breathe — and
  // move the title to a top strip so a full 7-item column never runs under it.
  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    xPosition: 40, yPosition: 6, width: 496, height: 24,
    containerID: 1, containerName: "header",
    content: tGlass('g.aphorica'), isEventCapture: 0,
    zOrderIndex: 2,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "philosophers"),
    xPosition: 24, yPosition: 36, width: 528, height: 244,
    containerID: 2, containerName: "philosophers",
    content: navText, isEventCapture: 1,
    zOrderIndex: 3,
  });
  return new RebuildPageContainer({
    menuObject: aphoricaMenu(),
    containerTotalNum: 2,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [],
  });
}

/** Public Aphorica — LEVEL 2: read one community member's thoughts, shuffled
 * like a philosopher's quotes. Framed like the quote page (bright box on the
 * post, dim box on the avatar), plus a PROFILE INSIGHT strip mirroring
 * enkiridion.com/profile: Tradition · Role, About, Values, Current focus.
 * Every data point is word-divided (snake_case/camelCase → spaced) and
 * first-letter-capitalized via titleWords/capPoint. Missing fields drop
 * their line. Swipe cycles posts, click reshuffles, double-tap goes back. */
export function buildAphoricaReadPage(
  authorLabel: string,
  text: string,
  up: number,
  down: number,
  index: number,
  total: number,
  profile?: {
    tradition?: string | null;
    role?: string | null;
    about?: string | null;
    values?: string[];
    currentFocus?: string | null;
  },
): RebuildPageContainer {
  const layout = quoteViewLayout();
  const body = new TextContainerProperty({
    ...geo(layout, "quote"),
    containerID: 2, containerName: "quote",
    content: `"${text}"`,
    isEventCapture: 1,
    zOrderIndex: 5,
  });
  const pos = String(index + 1).padStart(2, '0');
  const tot = String(Math.max(1, total)).padStart(2, '0');
  const line1 = `${pos}/${tot} ${progressBar(index + 1, Math.max(1, total), 6)}  ${authorLabel}`;
  const line2 = `♥ ${up} likes · ${down} dislikes`;
  // Profile insight — Tradition · Role on one line, then About / Values /
  // Focus, each capped to one line so the strip never overflows.
  const identity = [profile?.tradition, profile?.role]
    .filter((s): s is string => !!s && !!s.trim())
    .map(titleWords)
    .join(' · ');
  const aboutLine = profile?.about?.trim() ? `About · ${capPoint(profile.about, 44)}` : '';
  const valuesLine = (profile?.values && profile.values.length > 0)
    ? capPoint(`Values · ${profile.values.map(titleWords).join(' · ')}`, 48)
    : '';
  const focusLine = profile?.currentFocus?.trim() ? `Focus · ${capPoint(profile.currentFocus, 44)}` : '';
  const infoContent = [line1, line2, identity, aboutLine, valuesLine, focusLine]
    .filter(Boolean).join('\n');
  const info = new TextContainerProperty({
    ...geo(layout, "text-3"),
    // Up to 6 lines (~26px each) with a full profile — start flush under
    // the frames (their bottom border row is 127) and run to the canvas
    // edge: rows 128..286 = 158px, enough for 6 lines without clipping.
    yPosition: 128,
    height: 158,
    containerID: 13, containerName: "text-3",
    content: infoContent,
    isEventCapture: 0,
    zOrderIndex: 4,
  });
  // The member's avatar (100×100, same slot as the philosopher portrait).
  // events.ts pushes the pixels after this rebuild.
  const avatar = new ImageContainerProperty({
    ...geo(layout, "sprite"),
    containerID: 3, containerName: "sprite",
    zOrderIndex: 3,
  });
  return new RebuildPageContainer({
    menuObject: aphoricaReadMenu(),
    containerTotalNum: 3,
    listObject: [],
    textObject: [body, info],
    imageObject: [avatar],
  });
}

// ══════════════════════════════════════════════════════════════════
// S3 — MINDSTATE BROWSE
// ══════════════════════════════════════════════════════════════════

/** Mindstate filter selection for a philosopher.
 * Same navpad pattern as Picks/Speak — but the item set is rich
 * (Shuffle + emotions + tags + Back). The currently-selected item
 * gets the `▶ NAME ◀` cursor, and as the user scrolls onto an EMOTION
 * item, the philosopher's sprite shifts to that emotion variant —
 * scrolling becomes a live preview of the philosopher in that mood. */
export function buildMindstatePage(philosopher: Philosopher, index: number = 0): RebuildPageContainer {
  const layout = mindstateLayout();
  const items = mindstateItemLabels(philosopher);
  const total = items.length;
  const idx = Math.max(0, Math.min(index, total - 1));

  // Use renderNavpad: ▶ NAME ◀ cursor (official useful-characters set),
  // windowed to 7 items so emotion list fits in the 255px container and
  // the firmware's internal scroll never competes with our textEvent —
  // each ring scroll advances the cursor by exactly one item.
  const navText = total === 0
    ? '(no emotions)'
    : renderNavpad(items, idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: tMeta(philosopher.name, true), isEventCapture: 0,
    zOrderIndex: 5,
  });
  const navpad = new TextContainerProperty({
    ...geo(layout, "mindstates"),
    containerID: 2, containerName: "mindstates",
    content: navText,
    isEventCapture: 1,
    zOrderIndex: 6,
  });
  const portraitTop = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
    zOrderIndex: 3,
  });
  const portraitBottom = new ImageContainerProperty({
    ...geo(layout, "portrait-2"),
    containerID: 12, containerName: "portrait-2",
    zOrderIndex: 4,
  });
  return new RebuildPageContainer({
    menuObject: browseMenu(),
    containerTotalNum: 4,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [portraitTop, portraitBottom],
  });
}

/** Mindstate page labels — "Shuffle All" first, then emotions with quote
 * counts. Matches the simple philosopher-navpad pattern. Click commits,
 * double-click goes back. MUST stay index-aligned with
 * getMindstateSelections below. */
export function mindstateItemLabels(philosopher: Philosopher): string[] {
  const emotions = getEmotionsForPhilosopher(philosopher);
  // Emotion names come from the metadata corpus (tMeta), the same source
  // the quote page's info strip uses, so the picker and the quote agree.
  // These were raw English literals until 1.5.4, which meant a Chinese
  // reader got Chinese quotes and then an English emotion picker.
  return [
    `${tGlass('g.shuffleAll')} (${philosopher.quotes.length})`,
    ...emotions.map(e => {
      const count = philosopher.quotes.filter(q => q.emotion === e).length;
      return `${tMeta(capitalize(e), true)} (${count})`;
    }),
  ];
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
    // Cursor glyphs: ▶ ◀ (U+25B6/U+25C0) are on the official useful-
    // characters list (design-guidelines#useful-characters) and are
    // DIFFERENT codepoints from ► ◄ (U+25BA/U+25C4), which the LVGL
    // font lacks (tofu — see 2026-04 notes). Verified in simulator.
    if (i === idx) lines.push(`▶ ${items[i].toUpperCase()} ◀`);
    else           lines.push(items[i]);
  }
  return lines.join('\n');
}

/** "Shuffle All" first (plays the philosopher's ENTIRE quote pool,
 * shuffled), then emotions. Click on the navpad commits the highlighted
 * item; double-click goes back. Shuffle carries value "neutral" so the
 * scroll-preview sprite falls back to the neutral face — index-aligned
 * with mindstateItemLabels above. */
export function getMindstateSelections(philosopher: Philosopher): {
  type: "emotion" | "shuffle";
  value: string;
}[] {
  return [
    { type: "shuffle" as const, value: "neutral" },
    ...getEmotionsForPhilosopher(philosopher).map(e => ({ type: "emotion" as const, value: e })),
  ];
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
  /** Menu override: the mindful-quote state reuses this layout but must
   *  carry the mindful menu — its handler state (the pick) is not the
   *  quote-browse state the quote menu's commands read. */
  menuOverride?: MenuContainerProperty,
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
    content: `"${tQuote(quote.text, true)}"`,
    // Capture: text container receives swipes as textEvent(1/2) and
    // clicks as sysEvent(0/3). Events.ts routes them for this page.
    isEventCapture: 1,
    zOrderIndex: 5,
  });

  const sprite = new ImageContainerProperty({
    ...geo(layout, "sprite"),
    containerID: 3, containerName: "sprite",
    zOrderIndex: 3,
  });

  const pos = String(quoteIndex + 1).padStart(3, '0');
  const tot = String(totalQuotes).padStart(3, '0');
  const line1 = `${pos}/${tot} ${progressBar(quoteIndex + 1, totalQuotes, 8)} ${tMeta(capitalize(quote.emotion), true)}${favMark}`;
  const line2 = `${tMeta(philosopher.name, true)}, ${tMeta(quote.source, true)}`;
  const filled = '\u2605'.repeat(quote.rating);
  const outline = '\u2606'.repeat(10 - quote.rating);
  const line3 = `${tMeta(capitalize(String(rarity)), true)} - ${quote.rating} ${filled}${outline}`;

  const tagParts: string[] = [];
  const used = new Set<string>();
  if (quote.blend) { const b = tMeta(titleCase(quote.blend), true); tagParts.push(b); used.add(b.toLowerCase()); }
  if (quote.archetype) { const a = tMeta(titleCase(quote.archetype), true); if (!used.has(a.toLowerCase())) { tagParts.push(a); used.add(a.toLowerCase()); } }
  for (const t of quote.tags) {
    const d = tMeta(titleCase(t), true);
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
    zOrderIndex: 4,
  });

  // Chrome: bright frame around the quote card (input target), dim frame
  // around the sprite slot (images can't take border props). Rects stay
  // clear of the info strip (y ≥ 130) and of each other, and the frame's
  // right border (cols 572–573) clears the quote text (cols ≤ 569). The
  // quote text container itself keeps its exact geometry — no padding —
  // so long quotes never overflow into the firmware's internal scroll
  // (which would compete with swipe navigation).
  return new RebuildPageContainer({
    menuObject: menuOverride ?? quoteMenu(),
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
    zOrderIndex: 5,
  });
  const tradList = new ListContainerProperty({
    ...geo(layout, "traditions"),
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: TRADITIONS.length + 1, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: [...TRADITIONS, "Back"],
    }),
    isEventCapture: 1,
    zOrderIndex: 6,
  });
  const logoTop = new ImageContainerProperty({
    ...geo(layout, "logo top"),
    containerID: 3, containerName: "logo top",
    zOrderIndex: 3,
  });
  const logoBottom = new ImageContainerProperty({
    ...geo(layout, "logo bottom"),
    containerID: 10, containerName: "logo bottom",
    zOrderIndex: 4,
  });
  return new RebuildPageContainer({
    menuObject: transitMenu(),
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
 * Renders the full philosopher list with a cursor (`▶`) on the currently-
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
  //   ▶ PLATO ◀
  //      Aristotle
  //
  // Selected item gets a `▶ NAME ◀` cursor + uppercase. ▶ ◀ (U+25B6/
  // U+25C0) are on the official useful-characters list — NOT the same
  // codepoints as ► ◄ (U+25BA/U+25C4), which the LVGL font lacks.
  // Unselected items stay plain mixed-case. Block is centered both axes
  // (line gravity + container gravity) so it aligns with the sprite at
  // x=400. Windowed to 7 items so the rendered text fits in the 255px
  // container and the firmware's internal scroll never competes with our
  // textEvent.
  const navText = total === 0
    ? tGlass('g.noPhilosophers')
    : renderNavpad(philosophers.map(p => tMeta(p.name, true)), idx, 7);

  const header = new TextContainerProperty({
    ...geo(layout, "header"),
    containerID: 1, containerName: "header",
    content: `Speak: ${tradition}`, isEventCapture: 0,
    zOrderIndex: 4,
  });
  // Replaces the previous firmware-managed list. We control the cursor.
  const navpad = new TextContainerProperty({
    ...geo(layout, "navpad"),
    containerID: 2, containerName: "navpad",
    content: navText,
    isEventCapture: 1,
    zOrderIndex: 6,
  });
  const portrait = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 3, containerName: "portrait",
    zOrderIndex: 3,
  });
  const branding = new TextContainerProperty({
    ...geo(layout, "branding"),
    containerID: 4, containerName: "branding",
    content: "enkiRIDION",
    isEventCapture: 0,
    zOrderIndex: 5,
  });
  return new RebuildPageContainer({
    menuObject: transitMenu(),
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

  // C1 — emotion-reactive portrait (100×100 top-left), front-most layer
  const portrait = new ImageContainerProperty({
    ...geo(layout, "portrait"),
    containerID: 1, containerName: "portrait",
    zOrderIndex: 6,
  });

  // C21/C22 — GHOST MOOD LAYER: the same emotion sprite as a 200×200
  // halftone-dithered backdrop BEHIND the reply text, split into two
  // 200×100 halves — the EXACT image size + push path the portrait
  // halves use, proven on real G2 hardware. Image containers must never
  // overlap each other (the occlusion experiment died on-glass).
  // C23 — optional "echo" plane (?ghost=jumble): a small sharper copy of
  // the emotion at its own z-depth between the far ghost and the text —
  // three image planes at three depths. events.ts pushes the pixels via
  // pushSpritesSplit / pushSpriteSingle with the same preset's styles.
  const preset = ghostPreset();
  const ghostTop = new ImageContainerProperty({
    xPosition: 250, yPosition: 44, width: 200, height: 100,
    containerID: 21, containerName: "ghost-top",
    zOrderIndex: 1,
  });
  const ghostBottom = new ImageContainerProperty({
    xPosition: 250, yPosition: 144, width: 200, height: 100,
    containerID: 22, containerName: "ghost-bottom",
    zOrderIndex: 2,
  });
  const echo = preset.echo
    ? new ImageContainerProperty({
        xPosition: preset.echo.x, yPosition: preset.echo.y,
        width: preset.echo.size, height: preset.echo.size,
        containerID: 23, containerName: "ghost-echo",
        zOrderIndex: 7, // nearest image plane — in front of the text
      })
    : null;

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
  const pageMarker = pages.length > 1
    ? `  [${clampedIdx + 1}/${pages.length}] ${progressBar(clampedIdx + 1, pages.length, 4)}`
    : "";
  const visibleContent = capForGlass(`${status}${pageMarker}\n${shownChunk}`);

  // Reply text (z5) renders ABOVE the ghost halves (z1–2) — no bounding
  // box on this page (design decision 2026-07-14): the words float
  // directly over the halftone face. Black container backgrounds are
  // transparent on glass. Content still changes in-place via the fast
  // textContainerUpgrade path; the ghost only re-pushes on emotion change.
  const responseBox = new TextContainerProperty({
    ...geo(layout, "response"),
    containerID: 2, containerName: "response",
    content: visibleContent,
    isEventCapture: 1, // captures swipes + clicks for this page
    zOrderIndex: 5,
  });

  // C4 — philosopher name (e.g. "Socrates")
  const philName = new TextContainerProperty({
    ...geo(layout, "phil-name"),
    containerID: 4, containerName: "phil-name",
    content: philosopherName,
    isEventCapture: 0,
    zOrderIndex: 4,
  });

  // C5 — school of philosophy / tradition (e.g. "Greek")
  const philSchool = new TextContainerProperty({
    ...geo(layout, "phil-school"),
    containerID: 5, containerName: "phil-school",
    content: tradition,
    isEventCapture: 0,
    zOrderIndex: 3,
  });

  return new RebuildPageContainer({
    menuObject: convoMenu(),
    containerTotalNum: echo ? 7 : 6,
    listObject: [],
    textObject: [responseBox, philName, philSchool],
    imageObject: echo
      ? [portrait, ghostTop, ghostBottom, echo] // 4 = image-container max
      : [portrait, ghostTop, ghostBottom],
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
    zOrderIndex: 1,    // deliberately chrome-free — this page IS the dark
  } as any);           // screen; no frame, meditation stays blank
  return new RebuildPageContainer({
    menuObject: mindfulMenu(),
    containerTotalNum: 1,
    listObject: [],
    textObject: [shell],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// PHILOSOPHIES — the tradition list, one level under Home
// ══════════════════════════════════════════════════════════════════

/** Browse traditions. Same furniture as the home page (list + wordmark +
 *  split logo) so stepping into it reads as a level change, not a
 *  different app. Reuses the home layout's geometry rather than adding a
 *  page to pages.layout.ts, which the D3 Container Editor rewrites
 *  wholesale on every Save and would drop an entry it doesn't know. */
export function buildTraditionsPage(): RebuildPageContainer {
  const layout = homeLayout();
  const items = traditionListItems();
  // Same furniture and the same geometry as Home, so stepping into this
  // level reads as a level change rather than a different screen. The
  // list is taller here (traditions + Back), so it is top-anchored
  // instead of centred; height stays a whole multiple of the 40px pitch.
  const LIST_H = Math.min(items.length, 6) * 40;
  const title = new TextContainerProperty({
    ...geo(layout, "title"),
    xPosition: 351, yPosition: 248, width: 200, height: 34,
    containerID: 1, containerName: "title",
    content: tGlass('g.philosophies'),
    isEventCapture: 0,
    zOrderIndex: 5,
  });
  const list = new ListContainerProperty({
    ...geo(layout, "traditions"),
    xPosition: 62, yPosition: Math.round((288 - LIST_H) / 2), width: 265, height: LIST_H,
    containerID: 2, containerName: "traditions",
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length, itemWidth: 0, isItemSelectBorderEn: 1,
      itemName: items,
    }),
    isEventCapture: 1,
    zOrderIndex: 7,
  });
  const logoTop = new ImageContainerProperty({
    ...geo(layout, "logo top"),
    xPosition: 350, yPosition: 40, width: 200, height: 100,
    containerID: 3, containerName: "logo top",
    zOrderIndex: 3,
  });
  const logoBottom = new ImageContainerProperty({
    ...geo(layout, "logo bottom"),
    xPosition: 350, yPosition: 140, width: 200, height: 100,
    containerID: 10, containerName: "logo bottom",
    zOrderIndex: 4,
  });
  return new RebuildPageContainer({
    menuObject: browseMenu(),
    containerTotalNum: 4,
    listObject: [list],
    textObject: [title],
    imageObject: [logoTop, logoBottom],
  });
}

// ══════════════════════════════════════════════════════════════════
// SUPPORT — the on-glass excerpt
// ══════════════════════════════════════════════════════════════════

/** Support page: one page of the story, with a pager.
 *
 * NAVIGATION. The firmware allows exactly ONE isEventCapture container
 * per page, and its lists are vertical-only, so a horizontal row of
 * Back/Next buttons is not buildable: three list rows would eat 120px
 * of a 288px screen and leave four lines for the story. Instead the
 * BODY captures, and navigation uses the same grammar as every other
 * page in this app:
 *
 *     click        next page (wraps to the first at the end)
 *     swipe up     previous page
 *     swipe down   next page
 *     double-tap   back to Home
 *
 * The footer states that in words, so it is discoverable rather than
 * folklore, and shows the position so the reader knows how much is left.
 *
 * Body height 210px = 7 lines at the firmware's 27px line height,
 * ending at 248 so it clears the pager at 250 (an earlier 216 overlapped
 * it by 2px). The
 * paginator (supportStoryPages) budgets characters per language to keep
 * within it, because overflow here is silently cut, never clipped or
 * errored. capForGlass is the final guard against the 999-byte
 * container limit, which CJK and Cyrillic approach faster than Latin. */
export function buildSupportPage(pageIndex: number = 0): RebuildPageContainer {
  const pages = supportStoryPages();
  const total = pages.length;
  const idx = ((pageIndex % total) + total) % total;   // wrap both ways

  const header = new TextContainerProperty({
    xPosition: 24, yPosition: 2, width: 528, height: 34,
    containerID: 1, containerName: "support-header",
    content: `${tGlass("g.supportHeader")}    ${idx + 1}/${total}`,
    isEventCapture: 0,
    zOrderIndex: 2,
  });
  const body = new TextContainerProperty({
    xPosition: 24, yPosition: 38, width: 528, height: 210,
    containerID: 2, containerName: "support-body",
    content: capForGlass(pages[idx]),
    isEventCapture: 1,   // the page's single capture container
    zOrderIndex: 3,
  });
  // Brightness 2 (SDK 0.0.14 textColor): the pager is chrome, not
  // content — dimming it is the monochrome equivalent of a caption.
  // Dim rather than shrink: legibility on glass falls off much faster
  // with size than with brightness (early-access doc).
  const pager = new TextContainerProperty({
    xPosition: 24, yPosition: 250, width: 528, height: 34,
    containerID: 3, containerName: "support-pager",
    ...(hostSupports214 ? { textColor: 2 } : {}),
    content: idx === total - 1
      ? `◀ ${tGlass('g.pagePrev')}   ·   ${tGlass('g.pageEnd')}`
      : `◀ ${tGlass('g.pagePrev')}   ·   ${tGlass('g.pageNext')} ▶`,
    isEventCapture: 0,
    zOrderIndex: 4,
  });
  return new RebuildPageContainer({
    menuObject: supportMenu(),
    containerTotalNum: 3,
    listObject: [],
    textObject: [header, body, pager],
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
  // Marker + mini progress bar — MUST stay identical to
  // buildSpeakConversationPage's pageMarker so the textContainerUpgrade
  // fast path and the full-rebuild path render the same first line.
  const marker = pages.length > 1
    ? `  [${clampedIdx + 1}/${pages.length}] ${progressBar(clampedIdx + 1, pages.length, 4)}`
    : "";
  return capForGlass(`${status}${marker}\n${shown}`);
}

// ══════════════════════════════════════════════════════════════════
// FAVORITES — empty state (the populated state reuses buildQuoteViewPage
// with favMenu + a position line; see showFavorite in events.ts)
// ══════════════════════════════════════════════════════════════════

/** Shown when the wearer opens Favorites with nothing saved. Hand-coded
 *  geometry (system utility, same rationale as support/mindful pages —
 *  pages.layout.ts is editor-owned and rewritten wholesale on Save). */
export function buildFavoritesEmptyPage(): RebuildPageContainer {
  const header = new TextContainerProperty({
    xPosition: 24, yPosition: 2, width: 528, height: 34,
    containerID: 1, containerName: "fav-header",
    content: `enkiRIDION · ${tGlass('g.favTitle')}`,
    isEventCapture: 0,
    zOrderIndex: 2,
  });
  const body = new TextContainerProperty({
    xPosition: 24, yPosition: 96, width: 528, height: 108,
    containerID: 2, containerName: "fav-empty",
    content: capForGlass(tGlass('g.favEmpty')),
    isEventCapture: 1,   // the page's single capture container
    zOrderIndex: 3,
  });
  return new RebuildPageContainer({
    menuObject: menu([[tGlass('g.menuHome'), MENU_HOME]]),
    containerTotalNum: 2,
    listObject: [],
    textObject: [header, body],
    imageObject: [],
  });
}

// ══════════════════════════════════════════════════════════════════
// CALENDAR — month overview · day list · day detail
// All firmware text, zero image cost: the grid is one glyph per day
// (7 lines for a 6-week month), which no drawn canvas could beat for
// BLE economy. Hand-coded geometry, same as the other system pages.
// ══════════════════════════════════════════════════════════════════

/** Month overview. The GRID is the capture container: swipes page
 *  months (up = previous, down = next), click opens the day list,
 *  double-tap goes home. Header carries month + active days + streak;
 *  legend is dimmed chrome (brightness 2 on 2.2.9 hosts). */
export function buildCalendarPage(
  year: number, month0: number,
  headerLine: string, gridText: string, hasActivity: boolean,
): RebuildPageContainer {
  const header = new TextContainerProperty({
    xPosition: 24, yPosition: 2, width: 528, height: 34,
    containerID: 1, containerName: "cal-header",
    content: capForGlass(headerLine),
    isEventCapture: 0,
    zOrderIndex: 2,
  });
  // 8 lines max (weekday header + 6 weeks) at 27px = 216px.
  const grid = new TextContainerProperty({
    xPosition: 168, yPosition: 38, width: 384, height: 216,
    containerID: 2, containerName: "cal-grid",
    content: capForGlass(gridText),
    isEventCapture: 1,
    zOrderIndex: 3,
  });
  const legend = new TextContainerProperty({
    xPosition: 24, yPosition: 250, width: 528, height: 34,
    containerID: 3, containerName: "cal-legend",
    // Empty month: the no-activity line takes the legend slot (1 line)
    // rather than being appended under the grid, which overflowed the
    // 216px container in every language and silently ate the message.
    content: hasActivity ? tGlass('g.calLegend') : tGlass('g.calNoActivity'),
    isEventCapture: 0,
    zOrderIndex: 4,
    ...(hostSupports214 ? { textColor: 2 } : {}),
  });
  return new RebuildPageContainer({
    menuObject: calMenu(),
    containerTotalNum: 3,
    listObject: [],
    textObject: [header, grid, legend],
    imageObject: [],
  });
}

/** Day list for one month — the firmware-native selection surface.
 *  Rows come from activeDaysOfMonth ("11 · 2▶ 1♥"); navpad pattern with
 *  events.ts owning the cursor, exactly like philosopher select. */
export function buildCalendarDaysPage(
  monthName: string, rows: string[], index: number,
): RebuildPageContainer {
  const total = rows.length;
  const idx = Math.max(0, Math.min(index, Math.max(0, total - 1)));
  const navText = total === 0 ? tGlass('g.calNoActivity') : renderNavpad(rows, idx, 7);
  const header = new TextContainerProperty({
    xPosition: 40, yPosition: 6, width: 496, height: 34,
    containerID: 1, containerName: "cal-days-header",
    content: capForGlass(monthName),
    isEventCapture: 0,
    zOrderIndex: 2,
  });
  const navpad = new TextContainerProperty({
    xPosition: 24, yPosition: 40, width: 528, height: 240,
    containerID: 2, containerName: "cal-days",
    content: navText, isEventCapture: 1,
    zOrderIndex: 3,
  });
  return new RebuildPageContainer({
    menuObject: calMenu(),
    containerTotalNum: 2,
    listObject: [],
    textObject: [header, navpad],
    imageObject: [],
  });
}

/** One day's captures, paged like the support story (same budget math
 *  in glassCalendar.dayPages). Click = next page, swipe = both ways,
 *  double-tap = back to the day list. */
export function buildCalendarDayPage(
  title: string, pages: string[], pageIndex: number,
): RebuildPageContainer {
  const total = Math.max(1, pages.length);
  const idx = ((pageIndex % total) + total) % total;
  const header = new TextContainerProperty({
    xPosition: 24, yPosition: 2, width: 528, height: 34,
    containerID: 1, containerName: "cal-day-header",
    content: capForGlass(`${title}    ${idx + 1}/${total}`),
    isEventCapture: 0,
    zOrderIndex: 2,
  });
  const body = new TextContainerProperty({
    xPosition: 24, yPosition: 38, width: 528, height: 210,
    containerID: 2, containerName: "cal-day-body",
    content: capForGlass(pages[idx] ?? ''),
    isEventCapture: 1,
    zOrderIndex: 3,
  });
  const pager = new TextContainerProperty({
    xPosition: 24, yPosition: 250, width: 528, height: 34,
    containerID: 3, containerName: "cal-day-pager",
    content: total > 1 ? `◀ ${tGlass('g.pagePrev')}   ·   ${tGlass('g.pageNext')} ▶` : '',
    isEventCapture: 0,
    zOrderIndex: 4,
    ...(hostSupports214 ? { textColor: 2 } : {}),
  });
  return new RebuildPageContainer({
    menuObject: calMenu(),
    containerTotalNum: 3,
    listObject: [],
    textObject: [header, body, pager],
    imageObject: [],
  });
}
