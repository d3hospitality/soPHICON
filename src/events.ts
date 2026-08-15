// ═══════════════════════════════════════════════════════════════════
// soΦcon — Event router (src/events.ts) — v10
//
// One `bridge.onEvenHubEvent` subscription routes every input on
// every page. Event types the SDK delivers:
//   • listEvent    — click on a list container with isEventCapture:1
//   • textEvent    — swipe up/down on a text container with capture
//   • sysEvent     — click/double-click/lifecycle (4/5/6/7)
//   • audioEvent   — PCM chunks while speak mic is open
//
// Key design decisions:
//   • Protobuf zero-value omission: eventType === 0 arrives as undefined.
//     Every read uses `?? 0` — see handle-input skill notes.
//   • speak-conversation uses a TEXT container with capture (not a list)
//     so swipes paginate the conversation history natively; single-press
//     toggles the mic; double-press returns to the philosopher list.
//   • quote page: same pattern — text container captures swipes (→ next
//     quote), single-click reshuffles, double-click goes back.
//   • Lifecycle sysEvents (4/5/6/7) flush conversation history and
//     release the mic so we don't leak state between app sessions.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList, RebuildPageContainer } from '@evenrealities/even_hub_sdk';
import {
  TRADITIONS, Tradition, Philosopher, Quote, PHILOSOPHERS,
  getPhilosophersByTradition, getQuotePhilosophersByTradition, getAllQuotes,
  getQuotesByEmotion, getQuotesByTag, capitalize, formatTag,
} from './constants';
import {
  rebuildHomePage, loadGlanceLine, buildPhilosopherSelectPage,
  buildMindstatePage, getMindstateSelections,
  buildQuoteViewPage,
  homeListItems, BROWSABLE_TRADITIONS, SPEAK_INDEX,
  APHORICA_INDEX, PHILOSOPHIES_INDEX, buildTraditionsPage,
  buildAphoricaPage, buildAphoricaReadPage,
  buildSpeakTraditionPage, buildSpeakPhilosopherPage,
  buildSpeakConversationPage,
  speakConversationPageCount,
  composeSpeakResponseContent,
  buildMindfulnessBlankPage,
  SUPPORT_INDEX, buildSupportPage,
  MENU_LANGUAGE, buildLanguagePage, MENU_MINDFUL_SETUP,
  MENU_HOME, MENU_SURPRISE, MENU_FAVORITE, MENU_SPEAK_THIS,
  MENU_END_CONVO, MENU_REFRESH, MENU_DEV_STORY, MENU_NEW_MINDFUL,
  MENU_TIP_JAR, MENU_RESTART_STORY, mindfulMenu,
  MENU_SHOW_FAVORITES, MENU_SHOW_CALENDAR, MENU_LIKE_POST,
  MENU_LOG_REPLY, MENU_UNFAVORITE, MENU_CAL_TODAY,
  favMenu, buildFavoritesEmptyPage, buildCalendarPage,
  buildCalendarDayPage, MENU_CAL_PREV, MENU_CAL_NEXT,
  setGlanceLine,
} from './pages';
import { MINDFUL_LATCH_KEY, SUPPORT_LATCH_KEY } from './support';
import { pushLogoToGlasses, pushSpritesSplit, pushSpriteSingle, pushSpriteFromUrl, ghostPreset } from './image-utils';
import { isFavorite, toggleFavorite, isFavoriteText, getFavoriteEntries, onFavoritesChange } from './favorites';
import { onWisdomLogChange } from './wisdomlog';
import { addWisdomEntry } from './wisdomlog';
import {
  buildActivityMap, ActivityMap, renderMonthGrid, monthHeaderLine,
  cursorPreviewLine, shiftDayKey, dayPages, dayTitle, dateKey,
} from './glassCalendar';
import { authHeaders, linkedHandle } from './enkiAccount';
import { tGlass, LANGS, setLang } from './i18n';
import { setAccountBridge } from './enkiAccount';
import {
  loadPersonas, setSpeakBridge, startConversation,
  startRecording, stopRecordingAndSend, handleAudioChunk,
  emotionToSprite, endConversation, isCurrentlyRecording,
  getConversationDisplay, flushHistory, checkpointSession,
  normalizeEmotion, userMoodToEmpathySprite, getLastUserMood,
} from './speak';
import { log } from './ui';

// ═══ REBUILD GUARD ═══════════════════════════════════════════════════
/**
 * rebuildPageContainer with its return value actually checked.
 *
 * The SDK validates the whole payload BEFORE the native bridge and
 * returns false on failure (TOO_MANY_MENU_ITEMS, INVALID_MENU_ITEM_NAME,
 * DUPLICATE_MENU_ITEM_ID, INVALID_MENU_POSITION, INVALID_TEXT_BRIGHTNESS,
 * and the zOrderIndex rules). Per the Contextual Menu early-access doc:
 * "Check the return value of every create and rebuild call. A silently
 * ignored invalid looks identical to a firmware problem."
 *
 * Before this, every call site threw the boolean away. A rejected page
 * leaves the PREVIOUS screen on the glasses while app state advances to
 * the new one, so the wearer's next click is routed against a page they
 * cannot see — indistinguishable from a firmware fault. This makes it
 * loud in the log instead.
 */
async function safeRebuild(bridge: EvenAppBridge, page: RebuildPageContainer, what: string): Promise<boolean> {
  const ok = await bridge.rebuildPageContainer(page);
  if (!ok) log(`[PAGE] rebuild REJECTED by SDK validation: ${what}`, "error");
  return ok;
}

// ═══ STATE ═══
type Page = "home" | "traditions" | "philosophers" | "mindstate" | "quote"
  | "favorites" | "calendar" | "calendar-day"
  | "speak-traditions" | "speak-philosophers" | "speak-conversation"
  | "mindful-blank" | "mindful-quote" | "aphorica" | "aphorica-read"
  | "support" | "language";

let currentPage: Page = "home";
/** Cursor into supportStoryPages() while reading the Support story. */
let supportPageIndex = 0;

// ── Favorites page state ──
// Resolved once on open: favorites store texts → (philosopher, quote)
// pairs via corpus lookup. Unresolvable texts (corpus regenerated since
// the save) are kept OUT of the pager rather than shown attribution-less.
let favView: { phil: Philosopher; quote: Quote }[] = [];
let favIndex = 0;

// ── Calendar state ──
let calCursorKey = "";                  // the day under the ■ cursor
let calActivity: ActivityMap = new Map();
let calDayKey = "";                     // the opened day (YYYY-MM-DD)
let calDayPageList: string[] = [];
let calDayPageIdx = 0;

// ── Mindful pick, kept for the menu ──
// showMindfulQuote's pick used to be a local; the mindful menu's "Save
// to favorites" needs it after the function returns.
let lastMindfulPick: { phil: Philosopher; quote: Quote } | null = null;
let currentTradition: Tradition | null = null;

// Public Aphorica (on-glass community) state. Two levels: an author list
// (community members, tagged by status like Seeker/Sage — browsed like
// philosophers) → one member's thoughts, shuffled, with peer reactions.
const APH_FEED_URL = 'https://sophicon-api.vercel.app/api/aphorica/supafeed';
// Same endpoint the phone dashboard uses (dashboard.ts APH_VOTE_URL):
// POST { aphorismId, vote: 1 } with the pairing-token auth header.
const APH_VOTE_URL = 'https://sophicon-api.vercel.app/api/aphorica/vote';
type AphPost = { id: string; text: string; up: number; down: number };
// Profile insight fields mirror enkiridion.com/profile (served by the
// backend via public_profiles → supafeed author object).
type AphAuthor = {
  handle: string; badge: string; sprite: string | null;
  tradition: string | null; role: string | null; about: string | null;
  values: string[]; currentFocus: string | null;
  posts: AphPost[];
};
// Default community avatar (the ENKI mascot) when a member has no sprite.
const APH_DEFAULT_AVATAR = 'sprites/enki/enki-neutral.png';
/** Resolve a member's stored sprite to a source the glasses can fetch:
 * an absolute URL as-is, a bundled relative path via sprites/, else the
 * default ENKI avatar. */
function aphSpriteSource(sprite: string | null): string {
  if (!sprite) return APH_DEFAULT_AVATAR;
  if (/^https?:\/\//.test(sprite)) return sprite;
  return `sprites/${sprite.replace(/^\/?sprites\//, '')}`;
}
let aphAuthors: AphAuthor[] = [];
let aphGlassIdx = 0;    // cursor in the author list
let aphAuthorIdx = 0;   // selected author
let aphReadIdx = 0;     // cursor within the selected author's posts

/** Map a Supabase tier to a short on-glass status badge. */
function aphBadge(tier: unknown): string {
  const t = String(tier || '').toLowerCase();
  if (t === 'sage' || t === 'trialing' || t === 'trial' || t === 'active' || t === 'past_due') return 'SAGE';
  if (t === '' || t === 'seeker') return 'SEEKER';
  return t.toUpperCase();
}
function aphShuffle<T>(arr: T[]): T[] {
  const r = arr.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}
/** Author-list labels: "@handle · SAGE (n)". */
function aphAuthorItems(): string[] {
  return aphAuthors.map(a => `@${a.handle} · ${a.badge} (${a.posts.length})`);
}

/** Fetch the community feed (public read), group posts by author, and open
 * the author list on the glasses — each member browsable like a philosopher. */
async function openAphorica(bridge: EvenAppBridge): Promise<void> {
  aphGlassIdx = 0;
  try {
    const resp = await fetch(`${APH_FEED_URL}?sort=hot&limit=100`);
    const data = resp.ok ? await resp.json() : { posts: [] };
    const posts: any[] = Array.isArray(data.posts) ? data.posts : [];
    // Group by author, preserving first-seen (hot) order of members.
    const byHandle = new Map<string, AphAuthor>();
    for (const p of posts) {
      const handle = String(p.author?.handle || 'anon');
      const text = String(p.text || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let a = byHandle.get(handle);
      if (!a) {
        a = {
          handle, badge: aphBadge(p.author?.tier), sprite: p.author?.spritePath || null,
          tradition: p.author?.tradition || null,
          role: p.author?.role || null,
          about: p.author?.about || null,
          values: Array.isArray(p.author?.values) ? p.author.values.map(String) : [],
          currentFocus: p.author?.currentFocus || null,
          posts: [],
        };
        byHandle.set(handle, a);
      }
      a.posts.push({ id: String(p.id || ''), text, up: Number(p.upvotes) || 0, down: Number(p.downvotes) || 0 });
    }
    // Shuffle each member's posts so re-entry reshuffles like a philosopher.
    aphAuthors = [...byHandle.values()].map(a => ({ ...a, posts: aphShuffle(a.posts) }));
  } catch { aphAuthors = []; }
  await safeRebuild(bridge, buildAphoricaPage(aphAuthorItems(), 0), "buildAphoricaPage");
  currentPage = 'aphorica';
}

/** Open one community member's shuffled thoughts as a reading view. */
async function openAphoricaAuthor(bridge: EvenAppBridge, authorIdx: number): Promise<void> {
  if (authorIdx < 0 || authorIdx >= aphAuthors.length) return;
  if (aphAuthors[authorIdx].posts.length === 0) return;
  aphAuthorIdx = authorIdx;
  aphReadIdx = 0;
  await renderAphoricaRead(bridge);
  currentPage = 'aphorica-read';
}

/** Render the current author's current post with peer reactions. */
async function renderAphoricaRead(bridge: EvenAppBridge): Promise<void> {
  const a = aphAuthors[aphAuthorIdx];
  if (!a || a.posts.length === 0) return;
  const n = a.posts.length;
  const idx = ((aphReadIdx % n) + n) % n;
  const post = a.posts[idx];
  await safeRebuild(bridge, 
    buildAphoricaReadPage(`@${a.handle} · ${a.badge}`, post.text, post.up, post.down, idx, n, {
      tradition: a.tradition, role: a.role, about: a.about,
      values: a.values, currentFocus: a.currentFocus,
    }), "buildAphoricaReadPage");
  // Push the member's avatar into the portrait slot (falls back to ENKI).
  await pushSpriteFromUrl(bridge, aphSpriteSource(a.sprite), 3, "sprite", 100, 100);
}
let currentPhilosopher: Philosopher | null = null;
let currentQuotes: Quote[] = [];
let currentQuoteIndex: number = 0;
let currentFilter: string = "all";
let shuffleMode: boolean = false;
/** Surprise mode: the auto-rotate tick redraws from the WHOLE corpus
 *  rather than from one philosopher's quotes. Without this, "Surprise
 *  me" picked a random philosopher once and then rotated inside that
 *  philosopher forever — the 33s tick never left them. */
let surpriseMode: boolean = false;

/** Advance a surprise session to a new philosopher + quote.
 *
 *  EVERY way of asking for "the next one" has to go through this, not
 *  just the auto-rotate tick: the first fix only changed the 33s timer,
 *  so anyone who clicked or swiped — which is what people actually do —
 *  kept getting re-randomised inside whichever philosopher came up
 *  first, and the mode looked broken. Click, swipe and tick now share
 *  this path. Returns false if there is nothing to draw. */
function advanceSurprise(): boolean {
  const pick = drawFromWholeCorpus();
  if (!pick) return false;
  currentTradition = pick.phil.tradition as Tradition;
  currentPhilosopher = pick.phil;
  currentQuotes = pick.phil.quotes;
  currentQuoteIndex = pick.idx;
  return true;
}

/** One uniformly-random (philosopher, quote index) pair over all 2,801
 *  quotes. Weighted by quote count on purpose: drawing a philosopher
 *  first and then a quote would over-represent the thin ones. */
function drawFromWholeCorpus(): { phil: Philosopher; idx: number } | null {
  const pool: { phil: Philosopher; idx: number }[] = [];
  for (const phil of PHILOSOPHERS) {
    for (let i = 0; i < phil.quotes.length; i++) pool.push({ phil, idx: i });
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

let speakTradition: Tradition | null = null;
let speakPhilosopher: Philosopher | null = null;
let speakPhilId: string = "";
// Selected-index for the speak philosopher-select page. We own this state
// since the page is no longer firmware-managed list — it's a TEXT-with-
// capture nav-pad we render. Cycled by ring swipes (textEvent) AND by
// webapp clicks. publishState mirrors it to the dashboard.
let speakSelectedIndex: number = 0;
// Same model for the Picks/Browse philosopher-select page.
let picksSelectedIndex: number = 0;
// Same model for the Mindstate emotion/tag-filter page. As the user
// scrolls, the philosopher's sprite shifts to whichever emotion variant
// matches the current item.
let mindstateSelectedIndex: number = 0;
let lastResponseText: string = "";
// Paginated page index for the speak-conversation text window.
// 0 = first page (oldest visible content); swipe down advances, swipe up reverses.
let speakPageIndex: number = 0;
// True once the speak-conversation page has been rebuilt at least once.
// Flipped false on goBack so the next entry does a fresh rebuild.
let speakIsInitialized: boolean = false;
// Last emotion sprite we pushed — avoids redundant image pushes (each one
// costs 0.5–2s over BLE per the glasses-ui skill).
let lastPushedEmotion: string = "";

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAV_DEBOUNCE_MS = 500;

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredPhilIndex: number = -1;

// Empathy → response sprite transition timer. Held sprite reflects
// the user's mood; after this duration it fades to the philosopher's
// own response emotion. Cancellable so it doesn't fire after user
// taps mic again or leaves the conversation.
const EMPATHY_HOLD_MS = 7000;
let pendingResponseSpriteTimer: ReturnType<typeof setTimeout> | null = null;
function cancelPendingResponseSprite(): void {
  if (pendingResponseSpriteTimer) {
    clearTimeout(pendingResponseSpriteTimer);
    pendingResponseSpriteTimer = null;
  }
}

// ═══ MINDFULNESS MODE ═══
// Dashboard-activated mode that hides the normal UI and cycles one
// philosopher quote every N seconds, holding each for a meditation
// window. Ring events:
//   • Single-click on BLANK = skip the interval, show next quote now
//   • Single-click on QUOTE = reset interval timer, return to BLANK
//   • Double-click (either)  = exit mindfulness mode, back to home
export interface MindfulnessConfig {
  enabled: boolean;
  intervalSec: number;      // 30, 60, 300, 600, 900, 1200, 1500, 1800
  displaySec: number;       // how long each quote stays (default 60)
  philIds: string[];        // empty = all philosophers
  nextAt?: number;          // epoch ms of next scheduled show
}
const MINDFUL_KEY = "mindfulness_config";
let mindfulConfig: MindfulnessConfig = {
  enabled: false, intervalSec: 300, displaySec: 60, philIds: [],
};
let mindfulIntervalTimer: ReturnType<typeof setTimeout> | null = null;
let mindfulDisplayTimer: ReturnType<typeof setTimeout> | null = null;
function cancelMindfulTimers(): void {
  if (mindfulIntervalTimer) { clearTimeout(mindfulIntervalTimer); mindfulIntervalTimer = null; }
  if (mindfulDisplayTimer)  { clearTimeout(mindfulDisplayTimer);  mindfulDisplayTimer  = null; }
}

/** Pick a random quote from the selected philosophers (or all). */
function pickMindfulQuote(): { quote: Quote; phil: Philosopher } | null {
  const pool = mindfulConfig.philIds.length > 0
    ? PHILOSOPHERS.filter(p => mindfulConfig.philIds.includes(p.philId))
    : PHILOSOPHERS;
  if (pool.length === 0) return null;
  const phil = pool[Math.floor(Math.random() * pool.length)];
  if (phil.quotes.length === 0) return null;
  const quote = phil.quotes[Math.floor(Math.random() * phil.quotes.length)];
  return { quote, phil };
}

async function showMindfulBlank(bridge: EvenAppBridge): Promise<void> {
  cancelMindfulTimers();
  await safeRebuild(bridge, buildMindfulnessBlankPage(), "buildMindfulnessBlankPage");
  currentPage = "mindful-blank";
  // Schedule the next quote
  mindfulIntervalTimer = setTimeout(
    () => { showMindfulQuote(bridge).catch(e => log(`[MINDFUL] ${e}`, "error")); },
    mindfulConfig.intervalSec * 1000,
  );
  mindfulConfig.nextAt = Date.now() + mindfulConfig.intervalSec * 1000;
  await persistMindfulConfig();
  publishState();
  log(`[MINDFUL] blank · next quote in ${mindfulConfig.intervalSec}s`);
}

// Session counter — N of M shown so far this mindfulness session. Reset
// on start, bumped on every quote. Used as the [n/total] header line
// so meditations feel like they're progressing, not looping.
let mindfulShownCount = 0;

async function showMindfulQuote(bridge: EvenAppBridge): Promise<void> {
  cancelMindfulTimers();
  const pick = pickMindfulQuote();
  if (!pick) { log("[MINDFUL] no quotes in pool", "error"); return; }

  mindfulShownCount += 1;
  lastMindfulPick = { phil: pick.phil, quote: pick.quote };

  // Reuse the main QuoteView page layout — same sprite + quote + rich
  // meta (emotion / rarity stars / source / tags). Sets currentPage to
  // "mindful-quote" instead of "quote" so ring-click routes to the
  // mindfulness handler (reset → blank), not quote-page reshuffle.
  const fav = isFavorite(pick.quote);
  await safeRebuild(bridge, 
    buildQuoteViewPage(pick.phil, pick.quote, mindfulShownCount - 1, mindfulShownCount, fav, /* shuffle */ true, mindfulMenu())
  , "buildQuoteViewPage");
  currentPage = "mindful-quote";

  // Push the emotion sprite to the QuoteView page's sprite slot
  // (containerID 3, "sprite", 100×100 per pages.layout.ts — must match
  // exactly or the G2 firmware silently rejects the image)
  if (pick.quote.sprite) {
    try { await pushSpriteSingle(bridge, baseUrlRef, pick.quote.sprite, 3, "sprite", 100, 100); }
    catch (e) { console.warn("[MINDFUL] sprite push failed", e); }
  }

  mindfulDisplayTimer = setTimeout(
    () => { showMindfulBlank(bridge).catch(e => log(`[MINDFUL] ${e}`, "error")); },
    mindfulConfig.displaySec * 1000,
  );
  publishState({ spritePath: pick.quote.sprite });
  log(`[MINDFUL] ${pick.phil.name} [${pick.quote.emotion}]: "${pick.quote.text.slice(0, 40)}..."`);
}

async function persistMindfulConfig(): Promise<void> {
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(MINDFUL_KEY, JSON.stringify(mindfulConfig)); }
  catch (e) { console.warn("[MINDFUL] save failed", e); }
}

export async function loadMindfulConfig(): Promise<MindfulnessConfig> {
  if (!bridgeRef) return mindfulConfig;
  try {
    const raw = await bridgeRef.getLocalStorage(MINDFUL_KEY);
    if (raw) mindfulConfig = { ...mindfulConfig, ...JSON.parse(raw), enabled: false };
    // ^ always reset enabled on load — don't auto-resume without user consent
  } catch {}
  return mindfulConfig;
}

export function getMindfulConfig(): MindfulnessConfig { return mindfulConfig; }

export async function startMindfulness(
  config: Partial<MindfulnessConfig>,
): Promise<void> {
  if (!bridgeRef) return;
  mindfulConfig = {
    ...mindfulConfig, ...config,
    enabled: true,
    intervalSec: Math.max(10, config.intervalSec ?? mindfulConfig.intervalSec),
    displaySec:  Math.max(10, config.displaySec  ?? mindfulConfig.displaySec),
    philIds: config.philIds ?? mindfulConfig.philIds,
  };
  await persistMindfulConfig();
  mindfulShownCount = 0; // fresh session counter
  // Enter blank first — quote fires on interval. (Use showMindfulQuote
  // instead if you want an immediate first quote.)
  await showMindfulBlank(bridgeRef);
}

export async function stopMindfulness(bridge?: EvenAppBridge): Promise<void> {
  cancelMindfulTimers();
  mindfulConfig.enabled = false;
  mindfulConfig.nextAt = undefined;
  mindfulShownCount = 0;
  await persistMindfulConfig();
  const b = bridge || bridgeRef;
  if (b) {
    try { await loadGlanceLine(b); } catch { /* render without glance */ }
    await b.rebuildPageContainer(rebuildHomePage());
    currentPage = "home";
    await pushLogoToGlasses(b, baseUrlRef);
  }
  publishState();
  log("[MINDFUL] stopped");
}

// ═══ Glasses-state pub/sub (for the phone-side dashboard) ═══
// Every page transition / state change publishes a GlassesState snapshot
// so the dashboard can mirror what's on-glass in real time.
export interface GlassesState {
  page: Page;
  tradition: string | null;
  philosopher: { name: string; philId: string } | null;
  /** During philosopher-select pages (Picks browse OR Speak): the
   * currently-highlighted philosopher as the user scrolls the ring,
   * BEFORE they commit by clicking. Used by the dashboard to mirror
   * the sprite + name in real time. Clears when leaving the select page. */
  hoveredPhilosopher?: { name: string; philId: string; tradition: string; index: number; total: number } | null;
  filter?: string;
  quoteIndex?: number;
  quoteTotal?: number;
  quoteText?: string;
  spritePath?: string;           // last sprite pushed to the portrait slot
  speakListening?: boolean;
  speakThinking?: boolean;
  speakPageIndex?: number;
  speakPageCount?: number;
}
type GlassesStateListener = (s: GlassesState) => void;
let glassesStateListeners: GlassesStateListener[] = [];
let lastPublishedState: GlassesState | null = null;
export function onGlassesStateChange(cb: GlassesStateListener): () => void {
  glassesStateListeners.push(cb);
  if (lastPublishedState) { try { cb(lastPublishedState); } catch {} }
  return () => { glassesStateListeners = glassesStateListeners.filter(l => l !== cb); };
}
export function getGlassesState(): GlassesState | null { return lastPublishedState; }

/** Returns the philosopher array for the currently-active philosopher-
 * select page (Picks browse OR Speak). Empty if not on a select page.
 * Used by the dashboard to render its mirror UI with the same list the
 * glasses are currently displaying. */
export function getPhilsForCurrentSelectPage(): { tradition: string; phils: { name: string; philId: string }[] } | null {
  if (currentPage === 'philosophers' && currentTradition) {
    const arr = getQuotePhilosophersByTradition(currentTradition);
    return { tradition: currentTradition, phils: arr.map(p => ({ name: p.name, philId: p.philId })) };
  }
  if (currentPage === 'speak-philosophers' && speakTradition) {
    const arr = getPhilosophersByTradition(speakTradition);
    return { tradition: speakTradition, phils: arr.map(p => ({ name: p.name, philId: p.philId })) };
  }
  return null;
}

/** Called from the dashboard when the user clicks a philosopher in the
 * mirror UI. For Speak path, this fully drives our state (rebuilds the
 * page on glasses, sprite + name update, list cursor follows our state).
 * For Picks path, falls back to sprite-only mirror (firmware list there
 * still owns the cursor). */
export async function setHoveredPhilosopherFromDashboard(index: number): Promise<void> {
  if (!bridgeRef) return;
  if (currentPage === 'speak-philosophers' && speakTradition) {
    await setSpeakSelectedIndex(index);
  } else if (currentPage === 'philosophers' && currentTradition) {
    await setPicksSelectedIndex(index);
  }
}

/** Sets the speak-philosopher-select page to a specific index, rebuilds
 * the page on the glasses (so the displayed name + sprite + position
 * indicator all update), and publishes the new state to the dashboard.
 * Single source of truth for "which philosopher is currently highlighted
 * on the speak select page" — driven by ring swipes, ring clicks
 * (committing), and webapp clicks. */
/** Picks/Browse navpad: set the highlighted philosopher, rebuild the
 * page, push the split portrait, publish state. Mirror of
 * setSpeakSelectedIndex but for the quote-browse path. */
async function setPicksSelectedIndex(index: number): Promise<void> {
  if (!bridgeRef || !currentTradition) return;
  const phils = getQuotePhilosophersByTradition(currentTradition);
  if (phils.length === 0) return;
  const wrapped = ((index % phils.length) + phils.length) % phils.length;
  if (wrapped === picksSelectedIndex && lastHoveredPhilIndex === wrapped) return;
  picksSelectedIndex = wrapped;
  lastHoveredPhilIndex = wrapped;
  const phil = phils[wrapped];
  await bridgeRef.rebuildPageContainer(buildPhilosopherSelectPage(currentTradition, wrapped));
  // Picks uses the split 200x200 portrait (top + bottom halves)
  await pushPhilPortrait(bridgeRef, baseUrlRef, phil, 3, "portrait", 11, "portrait-2");
  publishState({
    hoveredPhilosopher: { name: phil.name, philId: phil.philId, tradition: currentTradition, index: wrapped, total: phils.length },
    spritePath: `${phil.philId}/${phil.philId}-neutral.png`,
  });
  log(`[PICKS SELECT] ${phil.name} (${wrapped + 1}/${phils.length})`);
}

/** Picks navpad commit: navigate to the mindstate page for the
 * highlighted philosopher. */
async function commitPicksSelection(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentTradition) return;
  const phils = getQuotePhilosophersByTradition(currentTradition);
  if (phils.length === 0) return;
  const phil = phils[Math.max(0, Math.min(picksSelectedIndex, phils.length - 1))];
  currentPhilosopher = phil;
  mindstateSelectedIndex = 0;
  await safeRebuild(bridge, buildMindstatePage(phil, 0), "buildMindstatePage");
  currentPage = "mindstate";
  lastNavigationTime = Date.now();
  await pushPhilPortrait(bridge, baseUrl, phil, 3, "portrait", 12, "portrait-2");
  log(`> ${phil.name}`, "success");
}

/** Mindstate navpad: set the highlighted item, rebuild the page, push
 * the right philosopher-emotion sprite, publish state. The sprite is
 * the magic: when the cursor sits on an emotion item the sprite swaps
 * to that emotion variant — scrolling becomes a live preview. Tags
 * and shuffle/back fall back to neutral. */
async function setMindstateSelectedIndex(index: number): Promise<void> {
  if (!bridgeRef || !currentPhilosopher) return;
  const selections = getMindstateSelections(currentPhilosopher);
  if (selections.length === 0) return;
  const wrapped = ((index % selections.length) + selections.length) % selections.length;
  if (wrapped === mindstateSelectedIndex) return;
  mindstateSelectedIndex = wrapped;
  const phil = currentPhilosopher;
  const emotion = selections[wrapped].value;
  await bridgeRef.rebuildPageContainer(buildMindstatePage(phil, wrapped));
  // Live preview: scrolling onto an emotion swaps the philosopher's
  // sprite to that emotion variant. Names are canonical (from the
  // curated quote data) so they map straight to sprite filenames.
  await pushSpritesSplit(bridgeRef, baseUrlRef, `${phil.philId}/${phil.philId}-${emotion}.png`,
                         3, "portrait", 12, "portrait-2");
  publishState({ spritePath: `${phil.philId}/${phil.philId}-${emotion}.png` });
  log(`[MINDSTATE] ${phil.name} · ${capitalize(emotion)} (${wrapped + 1}/${selections.length})`);
}

/** Mindstate navpad commit — "Shuffle All" plays the philosopher's whole
 * quote pool in random order; an emotion filters to that emotion. Either
 * way we navigate to the quote viewer. */
async function commitMindstateSelection(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentPhilosopher) return;
  const selections = getMindstateSelections(currentPhilosopher);
  if (selections.length === 0) return;
  const idx = Math.max(0, Math.min(mindstateSelectedIndex, selections.length - 1));
  const sel = selections[idx];
  if (sel.type === "shuffle") {
    // Fisher–Yates over a copy — never mutate the philosopher's pool.
    const pool = [...currentPhilosopher.quotes];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    currentQuotes = pool;
    currentFilter = "Shuffle";
    shuffleMode = true; // single click on the quote page re-randomizes
  } else {
    currentQuotes = getQuotesByEmotion(currentPhilosopher, sel.value);
    currentFilter = capitalize(sel.value);
    shuffleMode = false;
  }
  currentQuoteIndex = 0;
  currentPage = 'quote';
  lastNavigationTime = Date.now();
  await showCurrentQuote(bridge, baseUrl);
  startAutoRotate();
  log(`> ${currentFilter} (${currentQuotes.length} quotes)`, 'success');
}

/** Commit the currently-highlighted speak philosopher: navigate the
 * glasses into the speak-conversation page, start the persona session,
 * push the opening sprite. Called from ring-click on the navpad AND
 * (potentially) webapp commit. */
async function commitSpeakSelection(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!speakTradition) return;
  const phils = getPhilosophersByTradition(speakTradition);
  if (phils.length === 0) return;
  const phil = phils[Math.max(0, Math.min(speakSelectedIndex, phils.length - 1))];
  speakPhilosopher = phil;
  speakPhilId = phil.philId;
  lastNavigationTime = Date.now();
  speakPageIndex = 0;
  speakIsInitialized = false;
  lastPushedEmotion = "";
  const { opening, emotion } = await startConversation(speakPhilId);
  lastResponseText = opening;
  currentPage = "speak-conversation";
  await renderSpeakPage(bridge, opening, false);
  await updateEmotionSprite(bridge, baseUrl, emotion);
  log(`> Speak: ${phil.name}`, "success");
}

async function setSpeakSelectedIndex(index: number): Promise<void> {
  if (!bridgeRef || !speakTradition) return;
  const phils = getPhilosophersByTradition(speakTradition);
  if (phils.length === 0) return;
  // Wrap-around — scrolling past the end loops to the beginning
  const wrapped = ((index % phils.length) + phils.length) % phils.length;
  if (wrapped === speakSelectedIndex && lastHoveredPhilIndex === wrapped) return;
  speakSelectedIndex = wrapped;
  lastHoveredPhilIndex = wrapped;
  const phil = phils[wrapped];
  // Rebuild the page so the displayed name + position indicator update.
  // (Cheaper alternatives like updateTextContent could be wired later if
  // ring response feels laggy.)
  await bridgeRef.rebuildPageContainer(buildSpeakPhilosopherPage(speakTradition, wrapped));
  // Push the sprite for the new philosopher
  await pushSpriteSingle(bridgeRef, baseUrlRef, `${phil.philId}/${phil.philId}-neutral.png`, 3, "portrait", 100, 100);
  publishState({
    hoveredPhilosopher: { name: phil.name, philId: phil.philId, tradition: speakTradition, index: wrapped, total: phils.length },
    spritePath: `${phil.philId}/${phil.philId}-neutral.png`,
  });
  log(`[SPEAK SELECT] ${phil.name} (${wrapped + 1}/${phils.length})`);
}
function publishState(extra: Partial<GlassesState> = {}): void {
  // hoveredPhilosopher only makes sense while on a philosopher-select page;
  // anywhere else, force-clear it so the dashboard's mirror UI knows to
  // hide the live hover indicator.
  const onSelectPage = currentPage === "philosophers" || currentPage === "speak-philosophers";
  // Pick the *active* tradition based on which page we're on. Speak path
  // uses speakTradition; everything else uses currentTradition. Without
  // this, the dashboard's mirror-card tradition-change detection broke
  // when navigating to Speak → Greek (s.tradition was null because
  // currentTradition is null on the speak path) and the list never
  // re-rendered.
  const activeTradition =
    (currentPage === "speak-philosophers" || currentPage === "speak-conversation" ||
     currentPage === "speak-traditions")
      ? speakTradition
      : currentTradition;
  const s: GlassesState = {
    page: currentPage,
    tradition: activeTradition,
    philosopher: currentPhilosopher ? { name: currentPhilosopher.name, philId: currentPhilosopher.philId } : null,
    hoveredPhilosopher: onSelectPage ? (extra.hoveredPhilosopher ?? lastPublishedState?.hoveredPhilosopher ?? null) : null,
    filter: currentFilter,
    quoteIndex: currentQuoteIndex,
    quoteTotal: currentQuotes.length,
    quoteText: currentQuotes[currentQuoteIndex]?.text,
    speakListening: isCurrentlyRecording(),
    speakPageIndex,
    ...extra,
  };
  // If caller didn't override and we just left a select page, ensure cleared
  if (!onSelectPage && !('hoveredPhilosopher' in extra)) s.hoveredPhilosopher = null;
  lastPublishedState = s;
  for (const cb of glassesStateListeners) { try { cb(s); } catch (e) { console.error("[state cb]", e); } }
}

let autoRotateTimer: ReturnType<typeof setInterval> | null = null;
const AUTO_ROTATE_MS = 33000;

// ═══ HELPERS ═══
function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ═══ REGISTER ═══
/** Cross-surface freshness: the phone and the glass share one store in
 *  one webview. When the phone stars/un-stars or captures while a glass
 *  page is SHOWING, re-resolve and repaint it — without this, favView
 *  cycles ghosts and the calendar grid shows a stale month (review
 *  finding). The navigating guard skips repaints the glass's own
 *  handlers are already doing. */
function wireStoreListeners(bridge: EvenAppBridge, baseUrl: string): void {
  onFavoritesChange(() => {
    if (navigating) return;
    if (currentPage === "favorites") {
      const keep = favView[favIndex]?.quote.text;
      favView = resolveFavorites();
      const idx = keep ? favView.findIndex(f => f.quote.text === keep) : -1;
      favIndex = idx >= 0 ? idx : 0;
      showFavorite(bridge, baseUrl).catch(() => {});
    }
  });
  onWisdomLogChange(() => {
    if (navigating) return;
    if (currentPage === "calendar") {
      buildActivityMap().then(async (map) => {
        calActivity = map;
        if (currentPage === "calendar") await renderCalendar(bridge);
      }).catch(() => {});
    }
  });
}

export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
  wireStoreListeners(bridge, baseUrl);
  bridgeRef = bridge;
  baseUrlRef = baseUrl;
  setSpeakBridge(bridge);
  setAccountBridge(bridge);
  loadPersonas(baseUrl);

  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, baseUrl);
  });
}

// ═══ AUTO-ROTATE ═══
function startAutoRotate() {
  stopAutoRotate();
  autoRotateTimer = setInterval(() => {
    if (currentPage !== "quote" || !bridgeRef) return;
    if (surpriseMode) {
      if (advanceSurprise()) showCurrentQuote(bridgeRef, baseUrlRef);
      return;
    }
    if (currentQuotes.length > 1) {
      currentQuoteIndex = Math.floor(Math.random() * currentQuotes.length);
      showCurrentQuote(bridgeRef, baseUrlRef);
    }
  }, AUTO_ROTATE_MS);
}
function stopAutoRotate() {
  if (autoRotateTimer) { clearInterval(autoRotateTimer); autoRotateTimer = null; }
}

// ═══ PUSH PORTRAIT (split 200x200 → two 200x100) ═══
async function pushPhilPortrait(
  bridge: EvenAppBridge, baseUrl: string, phil: Philosopher,
  topID: number, topName: string, botID: number, botName: string
): Promise<void> {
  await pushSpritesSplit(bridge, baseUrl, `${phil.philId}/${phil.philId}-neutral.png`, topID, topName, botID, botName);
}

// ═══ PUSH EMOTION PORTRAIT (single 100x100 for speak conversation) ═══
// Container size MUST match pages.layout.ts buildSpeakConversationPage —
// containerID 1 'portrait' is declared 100×100. If we push a different
// size the G2 firmware silently rejects it (simulator is more permissive).
//
// GHOST MOOD LAYER: the same emotion sprite also lands behind the reply
// text as a 200×200 halftone backdrop split across containers 21/22
// ('ghost-top'/'ghost-bottom', zOrderIndex 1–2) — the proven portrait-
// halves push path. Depth styling (dot coverage/brightness/blur and the
// occlusion x-offset) comes from ghostPreset() — override per run with
// ?ghost=faint|dense|soft|occlude on the app URL. Pushes are SERIAL —
// never concurrent on the same bridge. Dedupe comes for free:
// updateEmotionSprite only calls this when the normalized emotion changes.
async function pushEmotionPortrait(
  bridge: EvenAppBridge, baseUrl: string, philId: string, emotion: string,
): Promise<void> {
  const sprite = emotionToSprite(philId, emotion);
  const preset = ghostPreset();
  await pushSpriteSingle(bridge, baseUrl, sprite, 1, "portrait", 100, 100);
  await pushSpritesSplit(bridge, baseUrl, sprite, 21, "ghost-top", 22, "ghost-bottom", preset.style);
  if (preset.echo) {
    // Third depth plane (?ghost=jumble) — serial after the ghost halves.
    await pushSpriteSingle(bridge, baseUrl, sprite, 23, "ghost-echo",
      preset.echo.size, preset.echo.size, preset.echo.style);
  }
}

// ═══ SHOW CURRENT QUOTE ═══
async function showCurrentQuote(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentPhilosopher || currentQuotes.length === 0) return;
  const quote = currentQuotes[currentQuoteIndex];
  const fav = isFavorite(quote);
  await safeRebuild(bridge, 
    buildQuoteViewPage(currentPhilosopher, quote, currentQuoteIndex, currentQuotes.length, fav, shuffleMode)
  , "buildQuoteViewPage");
  if (quote.sprite) {
    // QuoteView container 3 'sprite' is 100×100 (pages.layout.ts) — push must match
    await pushSpriteSingle(bridge, baseUrl, quote.sprite, 3, "sprite", 100, 100);
  }
  log(`[${currentQuoteIndex + 1}/${currentQuotes.length}] ${capitalize(quote.emotion)} — "${quote.text.slice(0, 40)}..."`);
  publishState({ spritePath: quote.sprite });
}

// ═══ REACTIVE PORTRAIT SWAP ═══
async function updatePhilosopherPortrait(
  bridge: EvenAppBridge, baseUrl: string, tradition: Tradition, index: number
): Promise<void> {
  // Match the array used by the displayed list: Picks/browse uses the
  // quote-only filter (Enki etc. excluded), Speak uses the full list.
  const phils = currentPage === "philosophers"
    ? getQuotePhilosophersByTradition(tradition)
    : getPhilosophersByTradition(tradition);
  if (index < 0 || index >= phils.length) return;
  if (index === lastHoveredPhilIndex) return;
  lastHoveredPhilIndex = index;
  const phil = phils[index];
  if (currentPage === "philosophers") {
    // Browse: split 200x200 portrait
    await pushPhilPortrait(bridge, baseUrl, phil, 3, "portrait", 11, "portrait-2");
  } else if (currentPage === "speak-philosophers") {
    // Speak: single 100x100 neutral
    await pushSpriteSingle(bridge, baseUrl, `${phil.philId}/${phil.philId}-neutral.png`, 3, "portrait", 100, 100);
  }
  log(`[HOVER] ${phil.name}`);

  // Mirror the hover to the dashboard so the webapp can show the same
  // philosopher (sprite + name) being highlighted on the glasses in
  // real time. spritePath uses the per-philosopher neutral so the
  // dashboard can render it via the same relative-path pipeline.
  publishState({
    hoveredPhilosopher: {
      name: phil.name, philId: phil.philId, tradition,
      index, total: phils.length,
    },
    spritePath: `${phil.philId}/${phil.philId}-neutral.png`,
  });
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    if (currentPage === "quote") {
      stopAutoRotate(); shuffleMode = false; surpriseMode = false;
      if (currentPhilosopher) {
        await safeRebuild(bridge, buildMindstatePage(currentPhilosopher), "buildMindstatePage");
        currentPage = "mindstate";
        await pushPhilPortrait(bridge, baseUrl, currentPhilosopher, 3, "portrait", 12, "portrait-2");
      }
      lastNavigationTime = Date.now();
      log("< Back to mindstates", "success");
    }
    else if (currentPage === "mindstate") {
      if (currentTradition) {
        await safeRebuild(bridge, buildPhilosopherSelectPage(currentTradition), "buildPhilosopherSelectPage");
        currentPage = "philosophers"; lastHoveredPhilIndex = -1; currentPhilosopher = null;
        const phils = getQuotePhilosophersByTradition(currentTradition);
        if (phils.length > 0) { await pushPhilPortrait(bridge, baseUrl, phils[0], 3, "portrait", 11, "portrait-2"); lastHoveredPhilIndex = 0; }
      }
      lastNavigationTime = Date.now();
      log("< Back to philosophers", "success");
    }
    else if (currentPage === "philosophers") {
      // Up one level to the tradition list, not all the way home — the
      // traditions moved off the home page, so home is no longer the
      // parent of a philosopher-select screen.
      await safeRebuild(bridge, buildTraditionsPage(), "buildTraditionsPage");
      currentPage = "traditions"; currentTradition = null; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Philosophies", "success");
    }
    else if (currentPage === "traditions") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; currentTradition = null; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "speak-conversation") {
      // Cancel any pending empathy → response sprite transition so it
      // doesn't fire after we've already left the page.
      cancelPendingResponseSprite();
      // Checkpoint the session into the dated journal BEFORE clearing
      // in-memory history, so the calendar tab can see today's entry.
      if (speakPhilosopher && speakTradition) {
        try { await checkpointSession(speakPhilosopher.name, speakTradition); }
        catch (e) { console.error("[speak checkpoint]", e); }
      }
      endConversation();
      // Reset speak render state so the next entry does a fresh rebuild
      // and re-pushes the portrait sprite
      speakIsInitialized = false;
      lastPushedEmotion = "";
      speakPageIndex = 0;
      if (speakTradition) {
        // Restore prior selection on the navpad when coming back from a
        // conversation; if user came from a different tradition, reset to 0.
        const phils = getPhilosophersByTradition(speakTradition);
        const idxToShow = Math.max(0, Math.min(speakSelectedIndex, phils.length - 1));
        speakSelectedIndex = idxToShow;
        await safeRebuild(bridge, buildSpeakPhilosopherPage(speakTradition, idxToShow), "buildSpeakPhilosopherPage");
        currentPage = "speak-philosophers"; lastHoveredPhilIndex = idxToShow;
        if (phils.length > 0) {
          const phil = phils[idxToShow];
          await pushSpriteSingle(bridge, baseUrl, `${phil.philId}/${phil.philId}-neutral.png`, 3, "portrait", 100, 100);
          publishState({
            hoveredPhilosopher: { name: phil.name, philId: phil.philId, tradition: speakTradition, index: idxToShow, total: phils.length },
            spritePath: `${phil.philId}/${phil.philId}-neutral.png`,
          });
        }
      }
      lastNavigationTime = Date.now();
      log("< Back to speak philosophers", "success");
    }
    else if (currentPage === "speak-philosophers") {
      await safeRebuild(bridge, buildSpeakTraditionPage(), "buildSpeakTraditionPage");
      currentPage = "speak-traditions"; speakTradition = null; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to speak traditions", "success");
    }
    else if (currentPage === "speak-traditions") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "favorites") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "calendar") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "calendar-day") {
      await renderCalendar(bridge);
      currentPage = "calendar";
      lastNavigationTime = Date.now();
      log("< Back to calendar", "success");
    }
    else if (currentPage === "aphorica-read") {
      // Reading a member's thoughts → back to the member list.
      await safeRebuild(bridge, buildAphoricaPage(aphAuthorItems(), aphGlassIdx), "buildAphoricaPage");
      currentPage = "aphorica";
      lastNavigationTime = Date.now();
      log("< Back to Public Aphorica", "success");
    }
    else if (currentPage === "aphorica") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
    else if (currentPage === "support") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      currentPage = "home"; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to Home", "success");
    }
  } catch (err) { log(`[BACK] ERROR: ${err}`, "error"); }
  finally { navigating = false; publishState(); }
}

// ═══ RENDER SPEAK PAGE ═══
// Two-mode render:
//   • Fresh entry (speakIsInitialized=false): full rebuildPageContainer.
//     Creates the portrait + response + tradition containers. After this,
//     the CALLER is expected to push the emotion sprite.
//   • Within-page (speakIsInitialized=true): textContainerUpgrade only
//     on the response container. Preserves the portrait (so the sprite
//     stays visible across swipe-pagination) and skips ~300–500ms of
//     BLE round-trip vs a full rebuild.
async function renderSpeakPage(
  bridge: EvenAppBridge,
  responseText: string,
  isListening: boolean,
  isThinking: boolean = false,
): Promise<void> {
  if (!speakPhilosopher) return;
  const history = getConversationDisplay(speakPhilosopher.name);
  const seed = history.length > 0
    ? history
    : [`${speakPhilosopher.name}: ${responseText}`];
  const maxIdx = Math.max(0, speakConversationPageCount(seed) - 1);
  if (speakPageIndex > maxIdx) speakPageIndex = maxIdx;
  if (speakPageIndex < 0) speakPageIndex = 0;

  if (!speakIsInitialized) {
    await safeRebuild(bridge, 
      buildSpeakConversationPage(
        speakPhilosopher.name,
        speakTradition || "",
        responseText,
        isListening,
        history,
        speakPageIndex,
        isThinking,
      )
    , "buildSpeakConversationPage");
    speakIsInitialized = true;
    // Portrait container is a fresh placeholder after rebuild —
    // callers should follow up with pushEmotionPortrait.
    return;
  }

  // Fast path: update just the response text in-place.
  const content = composeSpeakResponseContent(
    speakPhilosopher.name,
    speakTradition || "",
    responseText,
    isListening,
    history,
    speakPageIndex,
    isThinking,
  );
  try {
    await bridge.textContainerUpgrade({
      containerID: 2,
      containerName: "response",
      content,
    } as any);
  } catch (e) {
    // If the upgrade fails for any reason (e.g. firmware rejects it),
    // fall back to a full rebuild so we don't get stuck showing stale text.
    console.warn("[SPEAK] textContainerUpgrade failed, falling back to rebuild:", e);
    speakIsInitialized = false;
    await renderSpeakPage(bridge, responseText, isListening, isThinking);
  }
}

// Push emotion sprite. Dedupe on the NORMALIZED sprite name (not the
// raw GPT tag), so "contemplative" → "contemplation" doesn't fire twice.
// Pass force=true to guarantee a push even when the normalized emotion
// matches — used on response arrival so the user always sees a fresh
// sprite even if the philosopher's reply emotion matches their
// listening state.
async function updateEmotionSprite(
  bridge: EvenAppBridge, baseUrl: string, emotion: string, force: boolean = false,
): Promise<void> {
  const normalized = normalizeEmotion(emotion);
  if (!force && normalized === lastPushedEmotion) return;
  await pushEmotionPortrait(bridge, baseUrl, speakPhilId, normalized);
  lastPushedEmotion = normalized;
  const sprite = `${speakPhilId}/${speakPhilId}-${normalized}.png`;
  publishState({ spritePath: sprite, speakThinking: false });
}

// ═══ TOGGLE MIC (single press on speak-conversation) ═══
// Portrait container (ID 1) is back on this page, so the emotion-reactive
// face is pushed again — contemplative while listening, then the GPT-
// parsed emotion on the response.
// Four-phase context-aware sprite cycle per turn:
//
//   1. LISTENING  — context-aware: if we already know the user's mood
//                    from prior turns, the face reflects empathic
//                    receiving for that mood; otherwise default
//                    "contemplation" (warm, leaning in).
//
//   2. THINKING   — same empathic frame as listening (don't break the
//                    register between phases). Keeps the face held in
//                    the user's emotional context while the reply is
//                    computed.
//
//   3. EMPATHY    — once GPT returns { userMood, emotion }, we push an
//                    empathy sprite for the user's CURRENT utterance's
//                    mood, held for ~800ms so the user sees the
//                    philosopher acknowledge what was said before
//                    answering.
//
//   4. RESPONSE   — the philosopher's response face (force=true so it
//                    always pushes, even if same as the empathy sprite).
//
// Empathic map — see userMoodToEmpathySprite() in speak.ts for details.
async function toggleMic(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!speakPhilosopher) return;

  if (!isCurrentlyRecording()) {
    // Phase 1: LISTENING — context-aware from prior-turn mood
    // Any pending empathy→response transition is cancelled because the
    // listening sprite is about to take over anyway.
    cancelPendingResponseSprite();
    const ok = await startRecording();
    if (ok) {
      log("[SPEAK] Recording...", "success");
      speakPageIndex = 0; // snap back to newest while speaking
      await renderSpeakPage(bridge, "", true);
      const priorMood = getLastUserMood();
      const listenSprite = priorMood
        ? userMoodToEmpathySprite(priorMood)
        : "contemplation";
      await updateEmotionSprite(bridge, baseUrl, listenSprite);
    }
    return;
  }

  // Phase 2: THINKING — hold the empathic frame (don't snap to wonder,
  // that reads as "confused / surprised" during heavy moments)
  cancelPendingResponseSprite();
  log("[SPEAK] Processing...");
  speakPageIndex = 0;
  await renderSpeakPage(bridge, "Thinking...", false, true);
  const priorMood = getLastUserMood();
  const thinkSprite = priorMood
    ? userMoodToEmpathySprite(priorMood)
    : "contemplation";
  await updateEmotionSprite(bridge, baseUrl, thinkSprite);

  const result = await stopRecordingAndSend();

  if (!result) {
    lastResponseText = "I didn't catch that. Tap again.";
    await renderSpeakPage(bridge, lastResponseText, false);
    await updateEmotionSprite(bridge, baseUrl, "doubt", true);
    return;
  }

  lastResponseText = result.text;
  if (result.userMood) log(`[MOOD] user: ${result.userMood}`);
  await renderSpeakPage(bridge, lastResponseText, false);

  // Phase 3: EMPATHY HOLD — the face tethers to what YOU just said and
  // is held for ~7 s so you have time to read the philosopher's reply
  // while seeing them acknowledge the weight of your words. The
  // transition to the philosopher's OWN response emotion fires later
  // via a cancellable timer — if you tap mic again before the 7s are
  // up, the timer is cancelled and listening takes over cleanly.
  const empathy = (result.userMood && result.userMood !== "neutral")
    ? userMoodToEmpathySprite(result.userMood)
    : null;

  if (empathy) {
    await updateEmotionSprite(bridge, baseUrl, empathy, /* force */ true);
    log(`[SPRITE] empathy → ${empathy} (user: ${result.userMood}) · holding ${EMPATHY_HOLD_MS/1000}s`);
  } else {
    // No user mood detected (or neutral) — go straight to response emotion
    await updateEmotionSprite(bridge, baseUrl, result.emotion, /* force */ true);
    return;
  }

  // Phase 4: RESPONSE EMOTION (deferred). Scheduled, not awaited —
  // the sprite stays held until the timer fires, and is cancellable
  // by the next mic tap or by leaving the conversation.
  const philId = speakPhilId;
  const respEmotion = result.emotion;
  pendingResponseSpriteTimer = setTimeout(async () => {
    pendingResponseSpriteTimer = null;
    // Sanity: only push if we're still on speak-conversation with the
    // same philosopher (user may have back'd out in those 7 seconds).
    if (currentPage !== "speak-conversation") return;
    if (speakPhilId !== philId) return;
    try {
      await updateEmotionSprite(bridge, baseUrl, respEmotion, /* force */ true);
      log(`[SPRITE] ${philId} → ${respEmotion} (their reply face)`);
    } catch (e) {
      console.warn("[SPRITE] deferred response-emotion push failed:", e);
    }
  }, EMPATHY_HOLD_MS);
}

// ═══ SUPPORT ═══
/** Open the on-glass Support excerpt AND set the phone latch.
 *
 * Nothing on the glasses can foreground the phone app — there's no SDK
 * call for it, and the webview is backgrounded while the wearer is on
 * glass. So this does both halves: the glass page opens now, and the
 * latch gets consumed by the dashboard on its next refresh — opening
 * straight away if the phone is in hand, waiting quietly if it's in a
 * pocket. The latch stores a timestamp so the dashboard can ignore one
 * that's gone stale rather than ambushing someone days later. */
/** Open the on-glass language picker (home contextual menu). */
export async function openLanguagePage(bridge: EvenAppBridge): Promise<void> {
  await safeRebuild(bridge, buildLanguagePage(), "buildLanguagePage");
  currentPage = "language";
  lastNavigationTime = Date.now();
  log("> Language", "success");
}

/** Commit a language choice made on the glasses.
 *
 * setLang persists to the SAME bridge key the phone picker uses
 * (enki_lang) and fires the listener list, so the dashboard repaints
 * itself — the two surfaces cannot disagree about the current language.
 * Home is rebuilt directly rather than via repaintGlassForLanguage,
 * because currentPage is still "language" here and that helper only
 * repaints the page you are already on. */
async function commitLanguage(bridge: EvenAppBridge, baseUrl: string, idx: number): Promise<void> {
  const def = LANGS[idx];
  if (!def) return;
  await setLang(def.code, bridge);
  try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
  await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
  currentPage = "home";
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  log(`> Language: ${def.native}`, "success");
  publishState();
}

async function openSupport(bridge: EvenAppBridge): Promise<void> {
  supportPageIndex = 0;
  await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage");
  currentPage = "support";
  // Best-effort: a storage failure must never cost the wearer the page
  // they actually asked for.
  try { await bridge.setLocalStorage(SUPPORT_LATCH_KEY, String(Date.now())); }
  catch (e) { console.warn("[SUPPORT] latch write failed:", e); }
}

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME ──
    if (currentPage === "home") {
      if (idx === SPEAK_INDEX) {
        await safeRebuild(bridge, buildSpeakTraditionPage(), "buildSpeakTraditionPage");
        currentPage = "speak-traditions";
        lastNavigationTime = Date.now();
        await pushLogoToGlasses(bridge, baseUrl);
        log("> enkiSPEAKS", "success");
      } else if (idx === APHORICA_INDEX) {
        await openAphorica(bridge);
        lastNavigationTime = Date.now();
        log("> Public Aphorica", "success");
      } else if (idx === PHILOSOPHIES_INDEX) {
        await safeRebuild(bridge, buildTraditionsPage(), "buildTraditionsPage");
        currentPage = "traditions";
        lastNavigationTime = Date.now();
        await pushLogoToGlasses(bridge, baseUrl);
        log("> Philosophies", "success");
      } else if (idx === SUPPORT_INDEX) {
        await openSupport(bridge);
        lastNavigationTime = Date.now();
        log("> Support the dev", "success");
      }
      return;
    }

    // ── PHILOSOPHIES (tradition list) ──
    // Indexed straight into BROWSABLE_TRADITIONS — no offset, because
    // this page holds nothing but traditions plus a trailing Back row.
    if (currentPage === "traditions") {
      if (idx === BROWSABLE_TRADITIONS.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < BROWSABLE_TRADITIONS.length) {
        currentTradition = BROWSABLE_TRADITIONS[idx];
        picksSelectedIndex = 0;
        await safeRebuild(bridge, buildPhilosopherSelectPage(currentTradition, 0), "buildPhilosopherSelectPage");
        currentPage = "philosophers"; lastHoveredPhilIndex = 0;
        lastNavigationTime = Date.now();
        const phils = getQuotePhilosophersByTradition(currentTradition);
        if (phils.length > 0) {
          await pushPhilPortrait(bridge, baseUrl, phils[0], 3, "portrait", 11, "portrait-2");
          // Publish initial hover so the dashboard mirror lights up immediately.
          publishState({
            hoveredPhilosopher: { name: phils[0].name, philId: phils[0].philId, tradition: currentTradition, index: 0, total: phils.length },
            spritePath: `${phils[0].philId}/${phils[0].philId}-neutral.png`,
          });
        }
        log(`> ${currentTradition}`, "success");
      }
      return;
    }

    // ── LANGUAGE PICKER ──
    if (currentPage === "language") {
      const n = LANGS.length;
      if (idx === n) { navigating = false; await goBack(bridge, baseUrl); return; }   // Back row
      if (idx >= 0 && idx < n) await commitLanguage(bridge, baseUrl, idx);
      return;
    }

    // ── PHILOSOPHERS (quote browse) ──
    if (currentPage === "philosophers" && currentTradition) {
      const phils = getQuotePhilosophersByTradition(currentTradition);
      if (idx === phils.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < phils.length) {
        currentPhilosopher = phils[idx];
        await safeRebuild(bridge, buildMindstatePage(currentPhilosopher), "buildMindstatePage");
        currentPage = "mindstate"; lastNavigationTime = Date.now();
        await pushPhilPortrait(bridge, baseUrl, currentPhilosopher, 3, "portrait", 12, "portrait-2");
        log(`> ${currentPhilosopher.name}`, "success");
      }
      return;
    }

    // ── MINDSTATE ──
    // Mindstate now uses the navpad pattern (text-with-capture). Clicks
    // arrive via sysEvent and are handled by commitMindstateSelection.
    // The old listEvent click handler is dead code on this page.

    // ── QUOTE: click = reshuffle ──
    if (currentPage === "quote" && currentPhilosopher && currentQuotes.length > 0) {
      // In a surprise session a click means "somebody else", not
      // "another quote from this one".
      if (surpriseMode) advanceSurprise();
      else currentQuoteIndex = Math.floor(Math.random() * currentQuotes.length);
      startAutoRotate(); await showCurrentQuote(bridge, baseUrl);
      log(surpriseMode ? `Click > surprise: ${currentPhilosopher.name}` : "Click > new quote", "success");
      return;
    }

    // ── SPEAK: TRADITION SELECT ──
    if (currentPage === "speak-traditions") {
      if (idx === TRADITIONS.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < TRADITIONS.length) {
        speakTradition = TRADITIONS[idx];
        speakSelectedIndex = 0;
        await safeRebuild(bridge, buildSpeakPhilosopherPage(speakTradition, 0), "buildSpeakPhilosopherPage");
        currentPage = "speak-philosophers"; lastHoveredPhilIndex = 0; lastNavigationTime = Date.now();
        const phils = getPhilosophersByTradition(speakTradition);
        if (phils.length > 0) {
          await pushSpriteSingle(bridge, baseUrl, `${phils[0].philId}/${phils[0].philId}-neutral.png`, 3, "portrait", 100, 100);
          // Publish initial hover so the dashboard mirror lights up immediately.
          publishState({
            hoveredPhilosopher: { name: phils[0].name, philId: phils[0].philId, tradition: speakTradition, index: 0, total: phils.length },
            spritePath: `${phils[0].philId}/${phils[0].philId}-neutral.png`,
          });
        }
        log(`> Speak: ${speakTradition}`, "success");
      }
      return;
    }

    // ── SPEAK: PHILOSOPHER SELECT ──
    if (currentPage === "speak-philosophers" && speakTradition) {
      const phils = getPhilosophersByTradition(speakTradition);
      if (idx === phils.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < phils.length) {
        speakPhilosopher = phils[idx];
        speakPhilId = speakPhilosopher.philId;
        lastNavigationTime = Date.now();
        speakPageIndex = 0;
        // Reset init flag so next renderSpeakPage does a full rebuild
        // (creates the portrait container before we push the sprite)
        speakIsInitialized = false;
        lastPushedEmotion = "";
        // Load prior history + fresh opening (await: persistence restore)
        const { opening, emotion } = await startConversation(speakPhilId);
        lastResponseText = opening;
        currentPage = "speak-conversation";
        await renderSpeakPage(bridge, opening, false);
        await updateEmotionSprite(bridge, baseUrl, emotion);
        log(`> Speak: ${speakPhilosopher.name}`, "success");
      }
      return;
    }

    // ── SPEAK: CONVERSATION ──
    // No list on this page (C2 text captures). Single-press arrives via
    // sysEvent, not list click — see handleEvent's sysEvent branch.

  } catch (err) { log(`[CLICK] ERROR: ${err}`, "error"); }
  finally { navigating = false; publishState(); }
}

// ═══ DOUBLE-CLICK — back on all pages ═══
async function handleDoubleClick(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  log(`[DBLCLICK] page=${currentPage}`);
  // Mindfulness mode: double-tap exits and returns to home
  if (currentPage === "mindful-blank" || currentPage === "mindful-quote") {
    await stopMindfulness(bridge);
    return;
  }
  // Root home page: double-tap is the EXIT gesture. goBack has no "home"
  // branch, so without this the tap is swallowed and the plugin never
  // exits (Even review: "double-tapping to exit yields no response").
  // Run cooperative teardown, then shut the page container down so the OS
  // closes the plugin.
  if (currentPage === "home") {
    // Raise the system exit confirmation dialog. Do NOT tear down here — if
    // the user cancels, the app must stay live and listening. Cleanup runs
    // in the SYSTEM_EXIT / ABNORMAL_EXIT handlers only after real exit.
    log("[DBLCLICK] home → system exit dialog");
    try { await bridge.shutDownPageContainer(1); }
    catch (e) { log(`[DBLCLICK] shutDownPageContainer failed: ${e}`, "error"); }
    return;
  }
  if (currentPage === "speak-conversation") {
    await goBack(bridge, baseUrl);
    return;
  }
  await goBack(bridge, baseUrl);
}

// ═══ QUOTE SCROLL ═══
async function handleQuoteScroll(bridge: EvenAppBridge, baseUrl: string, dir: "up" | "down"): Promise<void> {
  if (!currentPhilosopher || currentQuotes.length === 0) return;
  // Surprise takes precedence: a swipe is still "next", and next in a
  // surprise session means a different philosopher.
  if (surpriseMode) { advanceSurprise(); }
  else if (shuffleMode) { currentQuoteIndex = Math.floor(Math.random() * currentQuotes.length); }
  else { currentQuoteIndex = dir === "down" ? (currentQuoteIndex + 1) % currentQuotes.length : (currentQuoteIndex - 1 + currentQuotes.length) % currentQuotes.length; }
  startAutoRotate(); await showCurrentQuote(bridge, baseUrl);
}

// ═══ LIFECYCLE CLEANUP (wired from sysEvent 5/6/7) ═══
//
// CRITICAL: any time we exit a Speak conversation we MUST checkpoint
// the session into the dated journal (speak_journal). Without this, only
// explicit "double-tap-back" exits get journaled — backgrounding the app,
// abnormal exits, system kills, glasses powering off all leave the
// conversation stranded in the per-philosopher running buffer and the
// journal never sees it. checkpointSession is idempotent (guarded by
// currentSessionCheckpointed) so calling it from multiple paths is safe.
async function onAppBackgrounded(): Promise<void> {
  cancelPendingResponseSprite();
  cancelMindfulTimers();
  if (speakPhilosopher && speakTradition) {
    try { await checkpointSession(speakPhilosopher.name, speakTradition); }
    catch (e) { console.error("[LIFECYCLE] checkpoint failed", e); }
  }
  try { await flushHistory(); } catch (e) { console.error("[LIFECYCLE] flush failed", e); }
  stopAutoRotate();
}

async function onAppExiting(bridge: EvenAppBridge): Promise<void> {
  cancelPendingResponseSprite();
  cancelMindfulTimers();
  try { if (isCurrentlyRecording()) await bridge.audioControl(false); } catch {}
  if (speakPhilosopher && speakTradition) {
    try { await checkpointSession(speakPhilosopher.name, speakTradition); }
    catch (e) { console.error("[LIFECYCLE] checkpoint failed", e); }
  }
  try { await flushHistory(); } catch {}
  stopAutoRotate();
  // NOTE: cleanup only — do NOT call shutDownPageContainer here. The exit
  // dialog is raised from the home double-tap handler; this runs after the
  // user has already confirmed exit (SYSTEM_EXIT / ABNORMAL_EXIT).
}

// ═══ MAIN EVENT HANDLER ═══
// Per @evenrealities/even_hub_sdk 0.0.7 (confirmed via handle-input skill):
//   • Protobuf zero-value omission: eventType === 0 arrives as `undefined`.
//     Always resolve with `?? 0`.
//   • Text containers with isEventCapture:1 receive:
//       textEvent(1/2) for swipe up/down, sysEvent(0) for click, sysEvent(3) for dbl-click.
//   • List containers with isEventCapture:1 receive:
//       listEvent for clicks (swipes are handled by the firmware, no event).
//   • Image containers cannot capture.
// ═══ FAVORITES PAGE ═══
// The populated state reuses the quote-view layout (same reasoning as
// mindful-quote): the wearer is looking at a quote, so it should look
// like a quote. favMenu replaces quoteMenu because the handler state is
// favView/favIndex, not the browse state.

function resolveFavorites(): { phil: Philosopher; quote: Quote }[] {
  const out: { phil: Philosopher; quote: Quote }[] = [];
  for (const entry of getFavoriteEntries()) {
    for (const phil of PHILOSOPHERS) {
      const q = phil.quotes.find(qq => qq.text === entry.t);
      if (q) { out.push({ phil, quote: q }); break; }
    }
  }
  return out;
}

export async function openFavoritesPage(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  favView = resolveFavorites();
  favIndex = 0;
  if (favView.length === 0) {
    await safeRebuild(bridge, buildFavoritesEmptyPage(), "buildFavoritesEmptyPage");
    currentPage = "favorites";
    lastNavigationTime = Date.now();
    log("> Favorites (empty)");
    return;
  }
  currentPage = "favorites";
  lastNavigationTime = Date.now();
  await showFavorite(bridge, baseUrl);
  log(`> Favorites (${favView.length})`, "success");
}

async function showFavorite(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (favView.length === 0) {
    await safeRebuild(bridge, buildFavoritesEmptyPage(), "buildFavoritesEmptyPage");
    return;
  }
  const n = favView.length;
  favIndex = ((favIndex % n) + n) % n;
  const { phil, quote } = favView[favIndex];
  await safeRebuild(bridge, 
    buildQuoteViewPage(phil, quote, favIndex, n, true, false, favMenu())
  , "buildQuoteViewPage");
  if (quote.sprite) {
    try { await pushSpriteSingle(bridge, baseUrl, quote.sprite, 3, "sprite", 100, 100); }
    catch (e) { console.warn("[FAV] sprite push failed", e); }
  }
  publishState({ spritePath: quote.sprite });
}

// ═══ CALENDAR PAGES ═══

export async function openCalendarPage(bridge: EvenAppBridge, toToday: boolean = true): Promise<void> {
  calActivity = await buildActivityMap();
  if (toToday || !calCursorKey) calCursorKey = dateKey(new Date());
  await renderCalendar(bridge);
  currentPage = "calendar";
  lastNavigationTime = Date.now();
  log("> Calendar", "success");
}

async function renderCalendar(bridge: EvenAppBridge): Promise<void> {
  const [y, m] = calCursorKey.split("-").map(Number);
  const header = monthHeaderLine(y, m - 1, calActivity);
  const grid = renderMonthGrid(y, m - 1, calActivity, calCursorKey);
  const footer = cursorPreviewLine(calCursorKey, calActivity);
  await safeRebuild(bridge, buildCalendarPage(y, m - 1, header, grid, footer), "buildCalendarPage");
}

/** Move the day cursor ±n days. Crossing a month edge flips the month
 *  implicitly (TEMPO's grammar: "a day move and a month flip cost the
 *  same thing"). The future is clamped at today — there is nothing to
 *  review there. */
function stepCalendarCursor(delta: number): void {
  const next = shiftDayKey(calCursorKey, delta);
  if (next > dateKey(new Date())) return;
  calCursorKey = next;
}

/** Month jump for the menu verbs: land on day 1, clamped to today. */
function jumpCalendarMonth(delta: number): void {
  const [y, m] = calCursorKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  const key = dateKey(d);
  calCursorKey = key > dateKey(new Date()) ? dateKey(new Date()) : key;
}

async function openCalendarDay(bridge: EvenAppBridge): Promise<void> {
  calDayKey = calCursorKey;
  calDayPageList = dayPages(calDayKey, calActivity);
  calDayPageIdx = 0;
  await safeRebuild(bridge, 
    buildCalendarDayPage(dayTitle(calDayKey), calDayPageList, calDayPageIdx)
  , "buildCalendarDayPage");
  currentPage = "calendar-day";
  lastNavigationTime = Date.now();
}

// ═══ CONTEXTUAL MENU (SDK 0.0.14, firmware 2.2.9) ═══
// One menuItemClickEvent per selection, carrying itemID and nothing
// else. itemIDs are global (see pages.ts registry): one ID = one
// command everywhere, so this is a single switch with page-state guards
// rather than per-page tables. The glasses hold no state — anything a
// command changes must be repainted by us afterwards.

/** Leave any page for home, running that page's teardown first. Mirrors
 *  the goBack home branches, but from ANY depth in one hop — the menu's
 *  "Go home" is O(1) escape, which chained double-taps never were. */
async function goHomeFromMenu(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  // Per-page teardown, same order the goBack branches do it.
  if (currentPage === "quote") { stopAutoRotate(); shuffleMode = false; surpriseMode = false; }
  if (currentPage === "mindful-blank" || currentPage === "mindful-quote") cancelMindfulTimers();
  if (currentPage === "speak-conversation") {
    cancelPendingResponseSprite();
    // Checkpoint BEFORE clearing history — same contract as double-tap:
    // a conversation that reached the glasses must reach the journal.
    if (speakPhilosopher && speakTradition) {
      try { await checkpointSession(speakPhilosopher.name, speakTradition); }
      catch (e) { console.error("[menu checkpoint]", e); }
    }
    endConversation();
    speakIsInitialized = false;
    lastPushedEmotion = "";
    speakPageIndex = 0;
  }
  try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
  await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
  currentPage = "home"; currentTradition = null; lastHoveredPhilIndex = -1;
  lastNavigationTime = Date.now();
  await pushLogoToGlasses(bridge, baseUrl);
  publishState();
  log("[MENU] > Home", "success");
}

/** Random quote from the whole corpus → quote view, with browse state
 *  set so scroll/reshuffle/back all behave as if the user had walked
 *  there: tradition and philosopher come from the drawn quote. */
/** QA-only entry to the Surprise path. The contextual menu is stripped
 *  on desktop hosts, so ?glass=surprise is the only way to exercise this
 *  code without real glasses. */
export async function surpriseFromQA(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  await surpriseMe(bridge, baseUrl);
}

async function surpriseMe(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (currentPage === "mindful-blank" || currentPage === "mindful-quote") cancelMindfulTimers();
  const pick = drawFromWholeCorpus();
  if (!pick) return;
  currentTradition = pick.phil.tradition as Tradition;
  currentPhilosopher = pick.phil;
  currentQuotes = pick.phil.quotes;
  currentQuoteIndex = pick.idx;
  shuffleMode = false;
  surpriseMode = true;          // keep wandering on every tick
  currentPage = "quote";
  lastNavigationTime = Date.now();
  startAutoRotate();
  await showCurrentQuote(bridge, baseUrl);
  log(`[MENU] Surprise: ${pick.phil.name}`, "success");
}

async function handleMenuClick(bridge: EvenAppBridge, itemID: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    log(`[MENU] itemID=${itemID} page=${currentPage}`);
    switch (itemID) {
      case MENU_HOME:
        await goHomeFromMenu(bridge, baseUrl);
        return;

      case MENU_SURPRISE:
        await surpriseMe(bridge, baseUrl);
        return;

      case MENU_FAVORITE: {
        // Quote page uses browse state; mindful-quote uses the stored
        // pick (its builder passes mindfulMenu precisely so this case
        // can tell them apart by currentPage).
        if (currentPage === "mindful-quote" && lastMindfulPick) {
          const pick = lastMindfulPick;
          const added = await toggleFavorite(pick.quote);
          if (added) await addWisdomEntry("fav", pick.quote.text, pick.phil.name, pick.phil.tradition);
          // Repaint so the ♥ actually changes where the wearer is
          // looking (the mark is baked into the page text), then
          // restore the sprite the rebuild blanked.
          await safeRebuild(bridge, 
            buildQuoteViewPage(pick.phil, pick.quote, mindfulShownCount - 1, mindfulShownCount, isFavorite(pick.quote), true, mindfulMenu())
          , "buildQuoteViewPage");
          if (pick.quote.sprite) {
            try { await pushSpriteSingle(bridge, baseUrl, pick.quote.sprite, 3, "sprite", 100, 100); } catch { /* sprite is decoration */ }
          }
          log(`[MENU] mindful ${added ? "♥ saved" : "♥ removed"}`, "success");
          return;
        }
        if (currentPage !== "quote" || currentQuotes.length === 0) return;
        const q = currentQuotes[currentQuoteIndex];
        const added = await toggleFavorite(q);
        if (added && currentPhilosopher) await addWisdomEntry("fav", q.text, currentPhilosopher.name, currentTradition || undefined);
        // The menu shows nothing — repaint the info strip so the ♥
        // appears/disappears where the wearer is already looking.
        await showCurrentQuote(bridge, baseUrl);
        log(`[MENU] ${added ? "♥ saved" : "♥ removed"}`, "success");
        return;
      }

      case MENU_SPEAK_THIS: {
        // The cross-mode jump: reading a philosopher → talking to them.
        // Works from the quote page (browse state) AND the favorites
        // page (favView state) — same command, same meaning.
        let jumpPhil: Philosopher | null = null;
        if (currentPage === "quote" && currentPhilosopher) {
          stopAutoRotate(); shuffleMode = false; surpriseMode = false;
          jumpPhil = currentPhilosopher;
        } else if (currentPage === "favorites" && favView.length > 0) {
          jumpPhil = favView[favIndex]?.phil ?? null;
        }
        if (!jumpPhil) return;
        const trad = jumpPhil.tradition as Tradition;
        const phils = getPhilosophersByTradition(trad);
        const jumpId = jumpPhil.philId;
        const idx = phils.findIndex(ph => ph.philId === jumpId);
        if (idx < 0) return;   // not speakable (should not happen)
        speakTradition = trad;
        speakSelectedIndex = idx;
        await commitSpeakSelection(bridge, baseUrl);
        return;
      }

      case MENU_END_CONVO:
        // Same contract as double-tap on the conversation page: the
        // existing goBack branch checkpoints, ends, and restores the
        // philosopher select. Reuse it rather than fork it.
        if (currentPage !== "speak-conversation") return;
        navigating = false;   // goBack takes its own navigating guard
        await goBack(bridge, baseUrl);
        return;

      case MENU_REFRESH:
        if (currentPage !== "aphorica" && currentPage !== "aphorica-read") return;
        // Re-fetch and land on the member list. From the read page this
        // drops the author cursor — the feed may have reordered or the
        // author may be gone, so the list is the only honest landing.
        await openAphorica(bridge);
        lastNavigationTime = Date.now();
        log("[MENU] Aphorica refreshed", "success");
        return;

      case MENU_DEV_STORY:
        if (currentPage !== "home") return;
        await openSupport(bridge);
        lastNavigationTime = Date.now();
        return;

      case MENU_NEW_MINDFUL:
        if (currentPage !== "mindful-blank" && currentPage !== "mindful-quote") return;
        await showMindfulQuote(bridge);
        return;

      case MENU_TIP_JAR:
        // Re-arm the phone latch on demand. The glass never takes money;
        // this just carries intent across the gap again if the phone
        // consumed the entry-time latch while the wearer kept reading.
        if (currentPage !== "support") return;
        try { await bridge.setLocalStorage(SUPPORT_LATCH_KEY, String(Date.now())); }
        catch (e) { console.warn("[MENU] latch failed:", e); }
        log("[MENU] tip jar armed on phone", "success");
        return;

      case MENU_RESTART_STORY:
        if (currentPage !== "support") return;
        supportPageIndex = 0;
        await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage");
        return;

      case MENU_SHOW_FAVORITES:
        if (currentPage !== "home") return;
        await openFavoritesPage(bridge, baseUrl);
        return;

      case MENU_LANGUAGE:
        if (currentPage === "home") await openLanguagePage(bridge);
        return;

      case MENU_MINDFUL_SETUP:
        // Configuration lives on the phone: picking philosophers and
        // dialling intervals is list-and-slider work the glasses have no
        // input grammar for. Set the latch and tell the wearer where it
        // went, so nothing looks like it silently failed.
        try { await bridge.setLocalStorage(MINDFUL_LATCH_KEY, String(Date.now())); } catch { /* best effort */ }
        setGlanceLine(tGlass('g.mindfulOnPhone'));
        await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
        await pushLogoToGlasses(bridge, baseUrl);
        log("[MENU] mindfulness setup → phone latch", "success");
        return;
      case MENU_SHOW_CALENDAR:
        if (currentPage !== "home") return;
        await openCalendarPage(bridge, true);
        return;

      case MENU_UNFAVORITE: {
        if (currentPage !== "favorites" || favView.length === 0) return;
        const removed = favView[favIndex];
        // REMOVE, never toggle: if the phone un-starred this quote while
        // the pager was open, a toggle would silently RE-ADD it with a
        // fresh timestamp. Only touch the store when it still has it.
        if (isFavoriteText(removed.quote.text)) {
          await toggleFavorite(removed.quote);
          log("[MENU] ♥ removed", "success");
        } else {
          log("[MENU] already removed on the phone");
        }
        favView.splice(favIndex, 1);                  // view
        if (favIndex >= favView.length) favIndex = 0;
        await showFavorite(bridge, baseUrl);          // next entry or empty state
        return;
      }

      case MENU_LOG_REPLY: {
        // Capture the philosopher's latest reply into the wisdom log.
        if (currentPage !== "speak-conversation" || !speakPhilosopher) return;
        const reply = lastResponseText.trim();
        if (!reply) return;
        const philName = speakPhilosopher.name;
        await addWisdomEntry("reply", reply, philName, speakTradition || undefined);
        // Feedback on the page itself (the menu shows nothing): flash
        // the phil-name line — container 4 IS "phil-name" on this page
        // (a first draft aimed at a "status" container that exists
        // nowhere; the flash silently missed) — then restore the name.
        try {
          await bridge.textContainerUpgrade({
            containerID: 4, containerName: "phil-name",
            content: tGlass("g.replyLogged"),
          } as any);
          setTimeout(async () => {
            if (currentPage !== "speak-conversation") return;
            try {
              await bridge.textContainerUpgrade({
                containerID: 4, containerName: "phil-name",
                content: philName,
              } as any);
            } catch { /* cosmetic */ }
          }, 2200);
        } catch { /* cosmetic */ }
        log("[MENU] reply logged", "success");
        return;
      }

      case MENU_LIKE_POST: {
        if (currentPage !== "aphorica-read") return;
        const author = aphAuthors[aphAuthorIdx];
        const post = author?.posts[aphReadIdx];
        if (!author || !post || !post.id) return;
        const handle = await linkedHandle();
        if (!handle) {
          // Unlinked: the server would 401 — say so where the wearer is
          // looking instead of failing silently. Container 13 is the
          // read page's info strip.
          try {
            await bridge.textContainerUpgrade({
              containerID: 13, containerName: "text-3",
              content: tGlass("g.likeLinkFirst"),
            } as any);
          } catch { /* cosmetic */ }
          return;
        }
        // The vote request gets its own try: once the server has
        // recorded the vote, a failure in the REPAINT must not tell the
        // wearer the like failed (the review caught exactly that).
        let liked = false;
        try {
          const resp = await fetch(APH_VOTE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(await authHeaders()) },
            body: JSON.stringify({ aphorismId: post.id, vote: 1 }),
          });
          if (resp.status === 401) {
            // Token present but dead (revoked/expired) — "try again"
            // would be a lie; re-linking is the actual fix.
            try {
              await bridge.textContainerUpgrade({
                containerID: 13, containerName: "text-3",
                content: tGlass("g.likeLinkFirst"),
              } as any);
            } catch { /* cosmetic */ }
            return;
          }
          if (!resp.ok) throw new Error(`${resp.status}`);
          // Number() never returns null, so `?? fallback` after it is
          // dead code (review finding): validate with isFinite instead.
          try {
            const counts = await resp.json();
            const up = Number(counts?.upvotes);
            post.up = Number.isFinite(up) ? up : post.up + 1;
          } catch { post.up += 1; }
          liked = true;
        } catch (e) {
          console.warn("[MENU] like failed:", e);
          try {
            await bridge.textContainerUpgrade({
              containerID: 13, containerName: "text-3",
              content: tGlass("g.likeFailed"),
            } as any);
          } catch { /* cosmetic */ }
          return;
        }
        if (liked) {
          try { await renderAphoricaRead(bridge); } catch { /* count shows on next repaint */ }
          try { await addWisdomEntry("like", post.text, author.handle); } catch { /* log is best-effort */ }
          log(`[MENU] ♥ liked @${author.handle}`, "success");
        }
        return;
      }

      case MENU_CAL_TODAY:
        if (currentPage !== "calendar" && currentPage !== "calendar-day") return;
        await openCalendarPage(bridge, true);
        return;

      case MENU_CAL_PREV:
      case MENU_CAL_NEXT:
        if (currentPage !== "calendar") return;
        jumpCalendarMonth(itemID === MENU_CAL_PREV ? -1 : +1);
        await renderCalendar(bridge);
        return;
    }
  } finally {
    navigating = false;
    publishState();
  }
}

async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

  // ── CONTEXTUAL MENU (action item selected on the glasses) ──
  if (event.menuItemClickEvent) {
    const id = event.menuItemClickEvent.itemID ?? 0;
    if (id > 0) await handleMenuClick(bridge, id, baseUrl);
    return;
  }

  // ── AUDIO (only during speak recording) ──
  if (event.audioEvent && currentPage === "speak-conversation") {
    const pcm = event.audioEvent.audioPcm;
    if (pcm) handleAudioChunk(new Uint8Array(pcm));
    return;
  }

  // ── TEXT EVENTS (swipes on a text container with isEventCapture:1) ──
  if (event.textEvent) {
    const type = event.textEvent.eventType ?? 0;
    const up = type === OsEventTypeList.SCROLL_TOP_EVENT;     // 1
    const down = type === OsEventTypeList.SCROLL_BOTTOM_EVENT; // 2

    // Favorites: swipe = previous/next saved quote, same wrap grammar
    // as the quote page it visually is.
    if (currentPage === "favorites" && favView.length > 0) {
      if (up)   { favIndex -= 1; await showFavorite(bridge, baseUrl); return; }
      if (down) { favIndex += 1; await showFavorite(bridge, baseUrl); return; }
    }

    // Calendar: swipes move the DAY CURSOR (TEMPO grammar) — one day at
    // a time, month flips implicit at the edges, future clamped.
    if (currentPage === "calendar") {
      if (up)   { stepCalendarCursor(-1); await renderCalendar(bridge); return; }
      if (down) { stepCalendarCursor(+1); await renderCalendar(bridge); return; }
    }

    // Calendar day detail: swipe pages entries, same grammar as support.
    if (currentPage === "calendar-day" && calDayPageList.length > 0) {
      if (up)   { calDayPageIdx -= 1; await safeRebuild(bridge, buildCalendarDayPage(dayTitle(calDayKey), calDayPageList, calDayPageIdx), "buildCalendarDayPage"); return; }
      if (down) { calDayPageIdx += 1; await safeRebuild(bridge, buildCalendarDayPage(dayTitle(calDayKey), calDayPageList, calDayPageIdx), "buildCalendarDayPage"); return; }
    }

    // Support story: swipe pages the letter both ways. Same grammar as
    // the quote page, so nothing new to learn.
    if (currentPage === "language") {
    await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
    currentPage = "home";
    await pushLogoToGlasses(bridge, baseUrl);
    log("< Back to Home", "success");
    return;
  }
  if (currentPage === "support") {
      if (up)   { supportPageIndex -= 1; await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage"); return; }
      if (down) { supportPageIndex += 1; await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage"); return; }
    }

    if (currentPage === "quote") {
      if (up)   { await handleQuoteScroll(bridge, baseUrl, "up"); return; }
      if (down) { await handleQuoteScroll(bridge, baseUrl, "down"); return; }
    }

    // Speak philosopher-select: swipe up/down cycles our selectedIndex
    // (we own this state). Wrap-around handled inside setSpeakSelectedIndex.
    if (currentPage === "speak-philosophers" && speakTradition) {
      if (up)   { await setSpeakSelectedIndex(speakSelectedIndex - 1); return; }
      if (down) { await setSpeakSelectedIndex(speakSelectedIndex + 1); return; }
    }
    // Picks/browse philosopher-select: same treatment.
    if (currentPage === "philosophers" && currentTradition) {
      if (up)   { await setPicksSelectedIndex(picksSelectedIndex - 1); return; }
      if (down) { await setPicksSelectedIndex(picksSelectedIndex + 1); return; }
    }
    // Mindstate emotion/tag-filter: scroll cycles + live-previews the
    // philosopher's emotion sprite when on an emotion item.
    if (currentPage === "mindstate" && currentPhilosopher) {
      if (up)   { await setMindstateSelectedIndex(mindstateSelectedIndex - 1); return; }
      if (down) { await setMindstateSelectedIndex(mindstateSelectedIndex + 1); return; }
    }
    // Public Aphorica: swipe scrolls the member list.
    if (currentPage === "aphorica") {
      const n = aphAuthors.length;
      if (n === 0) return;
      if (up)   { aphGlassIdx = (aphGlassIdx - 1 + n) % n; await safeRebuild(bridge, buildAphoricaPage(aphAuthorItems(), aphGlassIdx), "buildAphoricaPage"); return; }
      if (down) { aphGlassIdx = (aphGlassIdx + 1) % n; await safeRebuild(bridge, buildAphoricaPage(aphAuthorItems(), aphGlassIdx), "buildAphoricaPage"); return; }
    }
    // Aphorica reading: swipe cycles the selected member's thoughts.
    if (currentPage === "aphorica-read") {
      const a = aphAuthors[aphAuthorIdx];
      const n = a ? a.posts.length : 0;
      if (n === 0) return;
      if (up)   { aphReadIdx = (aphReadIdx - 1 + n) % n; await renderAphoricaRead(bridge); return; }
      if (down) { aphReadIdx = (aphReadIdx + 1) % n; await renderAphoricaRead(bridge); return; }
    }

    if (currentPage === "speak-conversation") {
      // Natural reading order: swipe down = next page, swipe up = previous.
      // Clamp hard at both ends so swiping past a boundary does nothing
      // (no wrap-around, no phantom page counter building up off-screen).
      if (!speakPhilosopher) return;

      const history = getConversationDisplay(speakPhilosopher.name);
      const seed = history.length > 0
        ? history
        : [`${speakPhilosopher.name}: ${lastResponseText}`];
      const maxIdx = Math.max(0, speakConversationPageCount(seed) - 1);

      if (down) {
        if (speakPageIndex >= maxIdx) return; // already at last page
        speakPageIndex = Math.min(speakPageIndex + 1, maxIdx);
        await renderSpeakPage(bridge, lastResponseText, isCurrentlyRecording());
        return;
      }
      if (up) {
        if (speakPageIndex <= 0) return;       // already at first page
        speakPageIndex -= 1;
        await renderSpeakPage(bridge, lastResponseText, isCurrentlyRecording());
        return;
      }
    }
    return;
  }

  // ── LIST EVENTS ──
  if (event.listEvent) {
    const le = event.listEvent;
    const idx = le.currentSelectItemIndex;
    const type = le.eventType;
    if (idx != null) lastSelectedIndex = idx; else lastSelectedIndex = 0;

    // Reactive portrait on philosopher pages (browse + speak)
    if ((currentPage === "philosophers" || currentPage === "speak-philosophers") && (currentTradition || speakTradition)) {
      const trad = currentPage === "philosophers" ? currentTradition! : speakTradition!;
      if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) {
        await updatePhilosopherPortrait(bridge, baseUrl, trad, lastSelectedIndex);
        return;
      }
      await updatePhilosopherPortrait(bridge, baseUrl, trad, lastSelectedIndex);
    }

    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    await handleClick(bridge, lastSelectedIndex, baseUrl);
    return;
  }

  // ── SYSTEM EVENTS (clicks + lifecycle) ──
  if (event.sysEvent) {
    const type = event.sysEvent.eventType ?? 0;

    // Double-click → back (every page handles it in goBack)
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT) { // 3
      navigating = false; // force-clear so double-tap always registers, even mid-nav
      await handleDoubleClick(bridge, baseUrl);
      return;
    }

    // Single click (eventType 0, which arrives as undefined → ?? 0)
    if (type === OsEventTypeList.CLICK_EVENT) { // 0
      if (currentPage === "support") {
        supportPageIndex += 1;                       // buildSupportPage wraps
        await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage");
        return;
      }
      // handleEvent is fire-and-forget (the subscription does not await
      // it), so fast double-inputs interleave — the navigating flag is
      // the same re-entrancy guard handleClick and handleMenuClick use.
      if (currentPage === "favorites") {
        if (navigating) return;
        if (favView.length > 0) { favIndex += 1; await showFavorite(bridge, baseUrl); }
        return;
      }
      if (currentPage === "calendar")      { if (navigating) return; await openCalendarDay(bridge); return; }
      if (currentPage === "calendar-day") {
        if (navigating) return;
        calDayPageIdx += 1;                          // builder wraps
        await safeRebuild(bridge, buildCalendarDayPage(dayTitle(calDayKey), calDayPageList, calDayPageIdx), "buildCalendarDayPage");
        return;
      }
      if (currentPage === "quote")              { await handleClick(bridge, 0, baseUrl); return; }
      if (currentPage === "speak-conversation") { await toggleMic(bridge, baseUrl); return; }
      // Public Aphorica member list: click opens that member's thoughts.
      if (currentPage === "aphorica")           { await openAphoricaAuthor(bridge, aphGlassIdx); return; }
      // Reading a member: click reshuffles to another of their thoughts.
      if (currentPage === "aphorica-read") {
        const a = aphAuthors[aphAuthorIdx];
        if (a && a.posts.length) { aphReadIdx = Math.floor(Math.random() * a.posts.length); await renderAphoricaRead(bridge); }
        return;
      }
      // Mindfulness mode clicks
      if (currentPage === "mindful-blank")      { await showMindfulQuote(bridge); return; }
      if (currentPage === "mindful-quote")      { await showMindfulBlank(bridge); return; }
      // Speak philosopher-select: text container captures clicks here.
      // Click commits whatever speakSelectedIndex points to.
      if (currentPage === "speak-philosophers" && speakTradition) {
        await commitSpeakSelection(bridge, baseUrl);
        return;
      }
      // Picks/browse philosopher-select: same — click commits to mindstate.
      if (currentPage === "philosophers" && currentTradition) {
        await commitPicksSelection(bridge, baseUrl);
        return;
      }
      // Mindstate filter: click commits the highlighted filter and
      // navigates to the quote viewer.
      if (currentPage === "mindstate" && currentPhilosopher) {
        await commitMindstateSelection(bridge, baseUrl);
        return;
      }
      return;
    }

    // Lifecycle — flush state, release hardware
    if (type === OsEventTypeList.FOREGROUND_ENTER_EVENT) { // 4
      log("[LIFECYCLE] foreground enter");
      return;
    }
    if (type === OsEventTypeList.FOREGROUND_EXIT_EVENT) {  // 5
      log("[LIFECYCLE] foreground exit — flushing");
      await onAppBackgrounded();
      return;
    }
    if (type === OsEventTypeList.ABNORMAL_EXIT_EVENT) {    // 6
      log("[LIFECYCLE] abnormal exit — cleaning up", "error");
      await onAppExiting(bridge);
      return;
    }
    // SYSTEM_EXIT_EVENT = 7 (not in v0.0.7 enum but sent by newer firmware)
    if ((type as number) === 7) {
      log("[LIFECYCLE] system exit — cleaning up");
      await onAppExiting(bridge);
      return;
    }
  }
}

// ═══ LANGUAGE REPAINT ═══════════════════════════════════════════════
/** Repaint the glass after a language switch made on the phone.
 *
 * Only the two list-driven pages are rebuilt: Home, and Support if the
 * wearer is sitting on it. Deeper pages (a live conversation, a quote
 * mid-rotation) are deliberately left alone — yanking a page out from
 * under someone mid-thought to restyle it is worse than letting the new
 * language apply on their next navigation. */
export async function repaintGlassForLanguage(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  try {
    if (currentPage === "home") {
      try { await loadGlanceLine(bridge); } catch { /* render without glance */ }
      await safeRebuild(bridge, rebuildHomePage(), "rebuildHomePage");
      await pushLogoToGlasses(bridge, baseUrl);
      log("[LANG] home repainted", "success");
    } else if (currentPage === "traditions") {
      await safeRebuild(bridge, buildTraditionsPage(), "buildTraditionsPage");
      await pushLogoToGlasses(bridge, baseUrl);
      log("[LANG] philosophies repainted", "success");
    } else if (currentPage === "favorites") {
      await showFavorite(bridge, baseUrlRef);
      log("[LANG] favorites repainted", "success");
    } else if (currentPage === "calendar") {
      await renderCalendar(bridge);
      log("[LANG] calendar repainted", "success");
    } else if (currentPage === "language") {
      await safeRebuild(bridge, buildLanguagePage(), "buildLanguagePage");
      log("[LANG] picker repainted", "success");
    } else if (currentPage === "support") {
      // Page boundaries differ per language, so an index from the old
      // language points nowhere sensible in the new one.
      supportPageIndex = 0;
      await safeRebuild(bridge, buildSupportPage(supportPageIndex), "buildSupportPage");
      log("[LANG] support repainted", "success");
    }
  } catch (e) {
    console.warn("[LANG] glass repaint failed:", e);
  }
}
