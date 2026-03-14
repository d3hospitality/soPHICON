// ═══════════════════════════════════════════════════════════════════
// soΦcon — Event Handlers v8
// Speak mode uses list buttons (Speak/Stop + Back) not double-tap.
// Double-tap = back on all pages EXCEPT speak-conversation.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge, EvenHubEvent, OsEventTypeList } from '@evenrealities/even_hub_sdk';
import {
  TRADITIONS, Tradition, Philosopher, Quote,
  getPhilosophersByTradition, getAllQuotes,
  getQuotesByEmotion, getQuotesByTag, capitalize, formatTag,
} from './constants';
import {
  rebuildHomePage, buildPhilosopherSelectPage,
  buildMindstatePage, getMindstateSelections,
  buildQuoteViewPage,
  HOME_LIST_ITEMS, SPEAK_INDEX,
  SPEAK_ACTION_SPEAK,
  buildSpeakTraditionPage, buildSpeakPhilosopherPage,
  buildSpeakConversationPage,
} from './pages';
import { pushLogoToGlasses, pushSpritesSplit, pushSpriteSingle } from './image-utils';
import { isFavorite } from './favorites';
import {
  loadPersonas, setSpeakBridge, startConversation,
  startRecording, stopRecordingAndSend, handleAudioChunk,
  emotionToSprite, endConversation, isCurrentlyRecording,
} from './speak';
import { log } from './ui';

// ═══ STATE ═══
type Page = "home" | "philosophers" | "mindstate" | "quote"
  | "speak-traditions" | "speak-philosophers" | "speak-conversation";

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

let lastSelectedIndex: number = 0;
let navigating = false;
let lastNavigationTime: number = 0;
const NAV_DEBOUNCE_MS = 500;

let bridgeRef: EvenAppBridge | null = null;
let baseUrlRef: string = "";
let lastHoveredPhilIndex: number = -1;

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

// ═══ PUSH EMOTION PORTRAIT (single 100x100 for speak conversation) ═══
async function pushEmotionPortrait(
  bridge: EvenAppBridge, baseUrl: string, philId: string, emotion: string,
): Promise<void> {
  const sprite = emotionToSprite(philId, emotion);
  await pushSpriteSingle(bridge, baseUrl, sprite, 1, "portrait", 100, 100);
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
    await pushSpriteSingle(bridge, baseUrl, quote.sprite, 3, "sprite", 100, 100);
  }
  log(`[${currentQuoteIndex + 1}/${currentQuotes.length}] ${capitalize(quote.emotion)} — "${quote.text.slice(0, 40)}..."`);
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
      endConversation();
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
  finally { navigating = false; }
}

// ═══ HANDLE SPEAK ACTION (Speak/Stop button, container 3) ═══
async function handleSpeakAction(bridge: EvenAppBridge, idx: number, baseUrl: string): Promise<void> {
  if (!speakPhilosopher) return;

  // Speak/Stop is the only item at index 0
  if (idx === SPEAK_ACTION_SPEAK) {
    if (!isCurrentlyRecording()) {
      const ok = await startRecording();
      if (ok) {
        log("[SPEAK] Recording...", "success");
        await bridge.rebuildPageContainer(
          buildSpeakConversationPage(speakPhilosopher.name, speakTradition || "", "", true)
        );
        await pushEmotionPortrait(bridge, baseUrl, speakPhilId, "contemplative");
      }
    } else {
      log("[SPEAK] Processing...");
      await bridge.rebuildPageContainer(
        buildSpeakConversationPage(speakPhilosopher.name, speakTradition || "", "Thinking...", false)
      );

      const result = await stopRecordingAndSend();

      if (!result) {
        lastResponseText = "I didn't catch that. Select Speak to try again.";
        await bridge.rebuildPageContainer(
          buildSpeakConversationPage(speakPhilosopher.name, speakTradition || "", lastResponseText, false)
        );
        return;
      }

      lastResponseText = result.text;
      await bridge.rebuildPageContainer(
        buildSpeakConversationPage(speakPhilosopher.name, speakTradition || "", lastResponseText, false)
      );
      await pushEmotionPortrait(bridge, baseUrl, speakPhilId, result.emotion);
    }
  }
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
        const { opening, emotion } = startConversation(speakPhilId);
        lastResponseText = opening;
        await bridge.rebuildPageContainer(
          buildSpeakConversationPage(speakPhilosopher.name, speakTradition || "", opening, false)
        );
        currentPage = "speak-conversation";
        await pushEmotionPortrait(bridge, baseUrl, speakPhilId, emotion);
        log(`> Speak: ${speakPhilosopher.name}`, "success");
      }
      return;
    }

    // ── SPEAK: CONVERSATION (list actions) ──
    if (currentPage === "speak-conversation") {
      await handleSpeakAction(bridge, idx, baseUrl);
      return;
    }

  } catch (err) { log(`[CLICK] ERROR: ${err}`, "error"); }
  finally { navigating = false; }
}

// ═══ DOUBLE-CLICK — back on all pages, never in speak-conversation ═══
async function handleDoubleClick(bridge: EvenAppBridge, baseUrl: string): Promise<void> {
  log(`[DBLCLICK] page=${currentPage}`);
  // In speak-conversation, double-click also triggers back
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

// ═══ MAIN EVENT HANDLER ═══
async function handleEvent(bridge: EvenAppBridge, event: EvenHubEvent, baseUrl: string): Promise<void> {

  // ── AUDIO EVENTS (only during speak recording) ──
  if (event.audioEvent && currentPage === "speak-conversation") {
    const pcm = event.audioEvent.audioPcm;
    if (pcm) handleAudioChunk(new Uint8Array(pcm));
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

    // Quote scroll
    if (currentPage === "quote") {
      if (type === OsEventTypeList.SCROLL_TOP_EVENT) { await handleQuoteScroll(bridge, baseUrl, "up"); return; }
      if (type === OsEventTypeList.SCROLL_BOTTOM_EVENT) { await handleQuoteScroll(bridge, baseUrl, "down"); return; }
    }

    if (type === OsEventTypeList.SCROLL_TOP_EVENT || type === OsEventTypeList.SCROLL_BOTTOM_EVENT) return;
    if (Date.now() - lastNavigationTime < NAV_DEBOUNCE_MS) return;

    await handleClick(bridge, lastSelectedIndex, baseUrl);
    return;
  }

  // ── SYSTEM EVENTS ──
  if (event.sysEvent) {
    const type = event.sysEvent.eventType;
    if (type === OsEventTypeList.DOUBLE_CLICK_EVENT || type === 3) {
      await handleDoubleClick(bridge, baseUrl);
    }
    // Single click on S4 quote page (no list) reshuffles
    if ((type === OsEventTypeList.SINGLE_CLICK_EVENT || type === 1) && currentPage === "quote") {
      await handleClick(bridge, 0, baseUrl);
    }
  }
}
