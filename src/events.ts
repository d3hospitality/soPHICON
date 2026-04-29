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

import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  TRADITIONS, Tradition, Philosopher, Quote, PHILOSOPHERS,
  getPhilosophersByTradition, getAllQuotes,
  getQuotesByEmotion, getQuotesByTag, capitalize, formatTag,
} from './constants';
import {
  rebuildHomePage, buildPhilosopherSelectPage,
  buildMindstatePage, getMindstateSelections,
  buildQuoteViewPage,
  HOME_LIST_ITEMS, SPEAK_INDEX,
  buildSpeakTraditionPage, buildSpeakPhilosopherPage,
  buildSpeakConversationPage,
  speakConversationPageCount,
  composeSpeakResponseContent,
  buildMindfulnessBlankPage,
} from './pages';
import { pushLogoToGlasses, pushSpritesSplit, pushSpriteSingle } from './image-utils';
import { isFavorite } from './favorites';
import {
  loadPersonas, setSpeakBridge, startConversation,
  startRecording, stopRecordingAndSend, handleAudioChunk,
  emotionToSprite, endConversation, isCurrentlyRecording,
  getConversationDisplay, flushHistory, checkpointSession,
  normalizeEmotion, userMoodToEmpathySprite, getLastUserMood,
} from './speak';
import { log } from './ui';

// ═══ STATE ═══
type Page = "home" | "philosophers" | "mindstate" | "quote"
  | "speak-traditions" | "speak-philosophers" | "speak-conversation"
  | "mindful-blank" | "mindful-quote";

let currentPage: Page = "home";
let currentTradition: Tradition | null = null;
let currentPhilosopher: Philosopher | null = null;
let currentQuotes: Quote[] = [];
let currentQuoteIndex: number = 0;
let currentFilter: string = "all";
let shuffleMode: boolean = false;

let speakTradition: Tradition | null = null;
let speakPhilosopher: Philosopher | null = null;
let speakPhilId: string = "";
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
  await bridge.rebuildPageContainer(buildMindfulnessBlankPage());
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

  // Reuse the main QuoteView page layout — same sprite + quote + rich
  // meta (emotion / rarity stars / source / tags). Sets currentPage to
  // "mindful-quote" instead of "quote" so ring-click routes to the
  // mindfulness handler (reset → blank), not quote-page reshuffle.
  const fav = isFavorite(pick.quote);
  await bridge.rebuildPageContainer(
    buildQuoteViewPage(pick.phil, pick.quote, mindfulShownCount - 1, mindfulShownCount, fav, /* shuffle */ true)
  );
  currentPage = "mindful-quote";

  // Push the emotion sprite to the QuoteView page's sprite slot
  // (containerID 3, "sprite", 120×120 per pages.layout.ts:191 — must match
  // exactly or the G2 firmware silently rejects the image)
  if (pick.quote.sprite) {
    try { await pushSpriteSingle(bridge, baseUrlRef, pick.quote.sprite, 3, "sprite", 120, 120); }
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
function publishState(extra: Partial<GlassesState> = {}): void {
  const s: GlassesState = {
    page: currentPage,
    tradition: currentTradition,
    philosopher: currentPhilosopher ? { name: currentPhilosopher.name, philId: currentPhilosopher.philId } : null,
    filter: currentFilter,
    quoteIndex: currentQuoteIndex,
    quoteTotal: currentQuotes.length,
    quoteText: currentQuotes[currentQuoteIndex]?.text,
    speakListening: isCurrentlyRecording(),
    speakPageIndex,
    ...extra,
  };
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
export function registerEventHandlers(bridge: EvenAppBridge, baseUrl: string): () => void {
  bridgeRef = bridge;
  baseUrlRef = baseUrl;
  setSpeakBridge(bridge);
  loadPersonas(baseUrl);

  return bridge.onEvenHubEvent((event: EvenHubEvent) => {
    handleEvent(bridge, event, baseUrl);
  });
}

// ═══ AUTO-ROTATE ═══
function startAutoRotate() {
  stopAutoRotate();
  autoRotateTimer = setInterval(() => {
    if (currentPage === "quote" && bridgeRef && currentQuotes.length > 1) {
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

// ═══ PUSH EMOTION PORTRAIT (single 120x120 for speak conversation) ═══
// Container size MUST match pages.layout.ts buildSpeakConversationPage —
// containerID 1 'portrait' is declared 120×120. If we push a 100×100 PNG
// the G2 firmware silently rejects it (simulator is more permissive).
async function pushEmotionPortrait(
  bridge: EvenAppBridge, baseUrl: string, philId: string, emotion: string,
): Promise<void> {
  const sprite = emotionToSprite(philId, emotion);
  await pushSpriteSingle(bridge, baseUrl, sprite, 1, "portrait", 120, 120);
}

// ═══ SHOW CURRENT QUOTE ═══
async function showCurrentQuote(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (!currentPhilosopher || currentQuotes.length === 0) return;
  const quote = currentQuotes[currentQuoteIndex];
  const fav = isFavorite(quote);
  await bridge.rebuildPageContainer(
    buildQuoteViewPage(currentPhilosopher, quote, currentQuoteIndex, currentQuotes.length, fav, shuffleMode)
  );
  if (quote.sprite) {
    // QuoteView container 3 'sprite' is 120×120 (pages.layout.ts:191) — push must match
    await pushSpriteSingle(bridge, baseUrl, quote.sprite, 3, "sprite", 120, 120);
  }
  log(`[${currentQuoteIndex + 1}/${currentQuotes.length}] ${capitalize(quote.emotion)} — "${quote.text.slice(0, 40)}..."`);
  publishState({ spritePath: quote.sprite });
}

// ═══ REACTIVE PORTRAIT SWAP ═══
async function updatePhilosopherPortrait(
  bridge: EvenAppBridge, baseUrl: string, tradition: Tradition, index: number
): Promise<void> {
  const phils = getPhilosophersByTradition(tradition);
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
}

// ═══ GO BACK ═══
async function goBack(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    if (currentPage === "quote") {
      stopAutoRotate(); shuffleMode = false;
      if (currentPhilosopher) {
        await bridge.rebuildPageContainer(buildMindstatePage(currentPhilosopher));
        currentPage = "mindstate";
        await pushPhilPortrait(bridge, baseUrl, currentPhilosopher, 3, "portrait", 12, "portrait-2");
      }
      lastNavigationTime = Date.now();
      log("< Back to mindstates", "success");
    }
    else if (currentPage === "mindstate") {
      if (currentTradition) {
        await bridge.rebuildPageContainer(buildPhilosopherSelectPage(currentTradition));
        currentPage = "philosophers"; lastHoveredPhilIndex = -1; currentPhilosopher = null;
        const phils = getPhilosophersByTradition(currentTradition);
        if (phils.length > 0) { await pushPhilPortrait(bridge, baseUrl, phils[0], 3, "portrait", 11, "portrait-2"); lastHoveredPhilIndex = 0; }
      }
      lastNavigationTime = Date.now();
      log("< Back to philosophers", "success");
    }
    else if (currentPage === "philosophers") {
      await bridge.rebuildPageContainer(rebuildHomePage());
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
        await bridge.rebuildPageContainer(buildSpeakPhilosopherPage(speakTradition));
        currentPage = "speak-philosophers"; lastHoveredPhilIndex = -1;
        const phils = getPhilosophersByTradition(speakTradition);
        if (phils.length > 0) { await pushSpriteSingle(bridge, baseUrl, `${phils[0].philId}/${phils[0].philId}-neutral.png`, 3, "portrait", 100, 100); lastHoveredPhilIndex = 0; }
      }
      lastNavigationTime = Date.now();
      log("< Back to speak philosophers", "success");
    }
    else if (currentPage === "speak-philosophers") {
      await bridge.rebuildPageContainer(buildSpeakTraditionPage());
      currentPage = "speak-traditions"; speakTradition = null; lastHoveredPhilIndex = -1;
      lastNavigationTime = Date.now();
      await pushLogoToGlasses(bridge, baseUrl);
      log("< Back to speak traditions", "success");
    }
    else if (currentPage === "speak-traditions") {
      await bridge.rebuildPageContainer(rebuildHomePage());
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
    await bridge.rebuildPageContainer(
      buildSpeakConversationPage(
        speakPhilosopher.name,
        speakTradition || "",
        responseText,
        isListening,
        history,
        speakPageIndex,
        isThinking,
      )
    );
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

// ═══ HANDLE CLICK ═══
async function handleClick(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (navigating) return;
  navigating = true;
  try {
    log(`[CLICK] page=${currentPage} idx=${idx}`);

    // ── HOME ──
    if (currentPage === "home") {
      if (idx === SPEAK_INDEX) {
        await bridge.rebuildPageContainer(buildSpeakTraditionPage());
        currentPage = "speak-traditions";
        lastNavigationTime = Date.now();
        await pushLogoToGlasses(bridge, baseUrl);
        log("> soPHICON Speaks", "success");
      } else {
        const tradIdx = idx - 1;
        if (tradIdx >= 0 && tradIdx < TRADITIONS.length) {
          currentTradition = TRADITIONS[tradIdx];
          await bridge.rebuildPageContainer(buildPhilosopherSelectPage(currentTradition));
          currentPage = "philosophers"; lastHoveredPhilIndex = -1;
          lastNavigationTime = Date.now();
          const phils = getPhilosophersByTradition(currentTradition);
          if (phils.length > 0) { await pushPhilPortrait(bridge, baseUrl, phils[0], 3, "portrait", 11, "portrait-2"); lastHoveredPhilIndex = 0; }
          log(`> ${currentTradition}`, "success");
        }
      }
      return;
    }

    // ── PHILOSOPHERS (quote browse) ──
    if (currentPage === "philosophers" && currentTradition) {
      const phils = getPhilosophersByTradition(currentTradition);
      if (idx === phils.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < phils.length) {
        currentPhilosopher = phils[idx];
        await bridge.rebuildPageContainer(buildMindstatePage(currentPhilosopher));
        currentPage = "mindstate"; lastNavigationTime = Date.now();
        await pushPhilPortrait(bridge, baseUrl, currentPhilosopher, 3, "portrait", 12, "portrait-2");
        log(`> ${currentPhilosopher.name}`, "success");
      }
      return;
    }

    // ── MINDSTATE ──
    if (currentPage === "mindstate" && currentPhilosopher) {
      const selections = getMindstateSelections(currentPhilosopher);
      if (idx < 0 || idx >= selections.length) return;
      const sel = selections[idx];
      if (sel.type === "back") { navigating = false; await goBack(bridge, baseUrl); return; }
      if (sel.type === "shuffle") { currentQuotes = shuffleArray(getAllQuotes(currentPhilosopher)); currentFilter = "Shuffle"; shuffleMode = true; }
      else if (sel.type === "emotion") { currentQuotes = getQuotesByEmotion(currentPhilosopher, sel.value); currentFilter = capitalize(sel.value); shuffleMode = false; }
      else if (sel.type === "tag") { currentQuotes = getQuotesByTag(currentPhilosopher, sel.value); currentFilter = formatTag(sel.value); shuffleMode = false; }
      currentQuoteIndex = 0; currentPage = "quote"; lastNavigationTime = Date.now();
      await showCurrentQuote(bridge, baseUrl); startAutoRotate();
      log(`> ${currentFilter} (${currentQuotes.length} quotes)`, "success");
      return;
    }

    // ── QUOTE: click = reshuffle ──
    if (currentPage === "quote" && currentPhilosopher && currentQuotes.length > 0) {
      currentQuoteIndex = Math.floor(Math.random() * currentQuotes.length);
      startAutoRotate(); await showCurrentQuote(bridge, baseUrl);
      log("Click > new quote", "success");
      return;
    }

    // ── SPEAK: TRADITION SELECT ──
    if (currentPage === "speak-traditions") {
      if (idx === TRADITIONS.length) { navigating = false; await goBack(bridge, baseUrl); return; }
      if (idx >= 0 && idx < TRADITIONS.length) {
        speakTradition = TRADITIONS[idx];
        await bridge.rebuildPageContainer(buildSpeakPhilosopherPage(speakTradition));
        currentPage = "speak-philosophers"; lastHoveredPhilIndex = -1; lastNavigationTime = Date.now();
        const phils = getPhilosophersByTradition(speakTradition);
        if (phils.length > 0) { await pushSpriteSingle(bridge, baseUrl, `${phils[0].philId}/${phils[0].philId}-neutral.png`, 3, "portrait", 100, 100); lastHoveredPhilIndex = 0; }
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
  if (currentPage === "speak-conversation") {
    await goBack(bridge, baseUrl);
    return;
  }
  await goBack(bridge, baseUrl);
}

// ═══ QUOTE SCROLL ═══
async function handleQuoteScroll(bridge: EvenAppBridge, baseUrl: string, dir: "up" | "down"): Promise<void> {
  if (!currentPhilosopher || currentQuotes.length === 0) return;
  if (shuffleMode) { currentQuoteIndex = Math.floor(Math.random() * currentQuotes.length); }
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
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

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

    if (currentPage === "quote") {
      if (up)   { await handleQuoteScroll(bridge, baseUrl, "up"); return; }
      if (down) { await handleQuoteScroll(bridge, baseUrl, "down"); return; }
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
      await handleDoubleClick(bridge, baseUrl);
      return;
    }

    // Single click (eventType 0, which arrives as undefined → ?? 0)
    if (type === OsEventTypeList.CLICK_EVENT) { // 0
      if (currentPage === "quote")              { await handleClick(bridge, 0, baseUrl); return; }
      if (currentPage === "speak-conversation") { await toggleMic(bridge, baseUrl); return; }
      // Mindfulness mode clicks
      if (currentPage === "mindful-blank")      { await showMindfulQuote(bridge); return; }
      if (currentPage === "mindful-quote")      { await showMindfulBlank(bridge); return; }
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
