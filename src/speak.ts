// ═══════════════════════════════════════════════════════════════════
// soΦcon — Speak module (src/speak.ts) — v3
//
// Voice-conversation pipeline:
//   1. bridge.audioControl(true) opens the on-glass mic
//   2. PCM frames (16 kHz, 16-bit LE, 40 B/frame) arrive as audioEvent
//      in events.ts and are piped here via handleAudioChunk()
//   3. On stop, all chunks are base64-encoded and POSTed to the Vercel
//      proxy /api/transcribe, which wraps them in a 44-byte WAV header
//      and forwards to OpenAI gpt-4o-transcribe
//   4. The transcribed text is sent (with persona + history) to the
//      Vercel /api/speak function, which calls GPT-4o chat completions
//      and returns { text, emotion } parsed from a trailing [EMOTION:tag]
//   5. Both user and assistant turns are appended to conversationHistory
//      and persisted to bridge.setLocalStorage under speak_history_<philId>
//   6. getConversationDisplay() formats the history for the on-glass
//      text window; user messages get a "▌ YOU: " prefix (grayscale
//      "glow" since the G2 panel has no color)
//
// NO API KEYS LIVE IN THIS FILE. The only outbound calls are to the
// Vercel proxy at sophicon-api.vercel.app — OPENAI_API_KEY is read
// server-side from process.env in sophicon-api/api/*.js.
//
// To swap GPT-4o for a different model, change the fetch targets in
// this file and update the Vercel handlers. The SDK/event surface
// stays unchanged.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';
import { log } from './ui';

// ═══ TYPES ═══
export interface Persona {
  name: string;
  tradition: string;
  persona: string;
  tone: string;
  principles: string[];
  approach: string;
  speech_style: string;
  emotions: string[];
  openings: string[];
}

export interface SpeakMessage {
  role: "user" | "assistant";
  content: string;
  ts?: number;            // epoch ms — when this turn happened
  userMood?: string;      // filled on assistant turns: GPT's read of the user's state when they said the prior user turn
  emotion?: string;       // filled on assistant turns: the face the philosopher wore
}

// ═══ CONFIG ═══
const SPEAK_API_URL = "https://sophicon-api.vercel.app/api/speak";
const TRANSCRIBE_API_URL = "https://sophicon-api.vercel.app/api/transcribe";

// ═══ STATE ═══
let personas: Record<string, Persona> = {};
let personasLoaded = false;

let currentPersona: Persona | null = null;
let currentPhilId: string = "";
let conversationHistory: SpeakMessage[] = [];
let isRecording = false;

// Audio
let audioChunks: Uint8Array[] = [];
let bridgeRef: EvenAppBridge | null = null;

// ═══ SET BRIDGE ═══
export function setSpeakBridge(bridge: EvenAppBridge): void {
  bridgeRef = bridge;
}

// ═══ LOAD PERSONAS ═══
export async function loadPersonas(baseUrl: string): Promise<void> {
  if (personasLoaded) return;
  try {
    const resp = await fetch(baseUrl + "personas.json");
    if (!resp.ok) throw new Error(`${resp.status}`);
    personas = await resp.json();
    personasLoaded = true;
    log(`[SPEAK] ${Object.keys(personas).length} personas loaded`);
  } catch (e) {
    console.error("[SPEAK] Failed to load personas:", e);
    log("[SPEAK] Personas load failed", "error");
  }
}

// ═══ GET PERSONA ═══
export function getPersona(philId: string): Persona | null {
  return personas[philId] || null;
}

// ═══ PERSISTENCE ═══
// Two-level storage:
//
//   speak_history_<philId>   — running "current session" buffer, includes
//                              the last up-to-40-turn slice sent to GPT.
//                              Cleared (or at least checkpointed) when
//                              the user exits the conversation.
//
//   speak_journal            — append-only dated journal across ALL
//                              philosophers: [{ date, philId, startTs,
//                              endTs, exchanges: [...] }]. Built up over
//                              time; never truncated here (Supabase ships
//                              it later). This is what the calendar tab
//                              reads from.
//
// Swap either layer for Supabase later without touching callers.
const historyKey = (philId: string) => `speak_history_${philId}`;
const JOURNAL_KEY = "speak_journal";

export interface JournalSession {
  date: string;          // YYYY-MM-DD (local)
  philId: string;
  philName: string;
  tradition: string;
  startTs: number;
  endTs: number;
  exchanges: SpeakMessage[];
}

export async function loadJournal(): Promise<JournalSession[]> {
  if (!bridgeRef) return [];
  try {
    const raw = await bridgeRef.getLocalStorage(JOURNAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("[SPEAK] loadJournal failed:", e);
    return [];
  }
}

async function saveJournal(all: JournalSession[]): Promise<void> {
  if (!bridgeRef) return;
  try {
    await bridgeRef.setLocalStorage(JOURNAL_KEY, JSON.stringify(all));
  } catch (e) {
    console.error("[SPEAK] saveJournal failed:", e);
  }
}

/**
 * Finalize the current session: snapshot the in-memory history as a
 * JournalSession under today's date and append it to the journal.
 * Called when the user double-taps back out of speak-conversation.
 */
export async function checkpointSession(philName: string, tradition: string): Promise<void> {
  if (!currentPhilId || conversationHistory.length === 0) return;
  const now = Date.now();
  const firstTurn = conversationHistory.find(m => m.ts)?.ts ?? now;
  const today = new Date(firstTurn);
  const date = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
  const session: JournalSession = {
    date,
    philId: currentPhilId,
    philName,
    tradition,
    startTs: firstTurn,
    endTs: now,
    exchanges: [...conversationHistory],   // snapshot
  };
  const all = await loadJournal();
  all.push(session);
  await saveJournal(all);
  log(`[JOURNAL] checkpointed ${session.exchanges.length}-turn session with ${philName}`);
}

async function loadHistory(philId: string): Promise<SpeakMessage[]> {
  if (!bridgeRef) return [];
  try {
    const raw = await bridgeRef.getLocalStorage(historyKey(philId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Sanity filter — keep only well-shaped rows
    return parsed.filter((m: any) =>
      m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
    );
  } catch (e) {
    console.error("[SPEAK] loadHistory failed:", e);
    return [];
  }
}

async function saveHistory(philId: string): Promise<void> {
  if (!bridgeRef || !philId) return;
  try {
    await bridgeRef.setLocalStorage(historyKey(philId), JSON.stringify(conversationHistory));
  } catch (e) {
    console.error("[SPEAK] saveHistory failed:", e);
  }
}

// ═══ START CONVERSATION ═══
// Now async: loads prior history from bridge storage so users resume where
// they left off with each philosopher.
export async function startConversation(philId: string): Promise<{ opening: string; emotion: string }> {
  const p = personas[philId];
  if (!p) return { opening: "...", emotion: "contemplative" };

  currentPersona = p;
  currentPhilId = philId;
  isRecording = false;

  // Restore prior history (if any)
  conversationHistory = await loadHistory(philId);

  // Append a fresh opening so users always get a greeting on entry
  const opening = p.openings[Math.floor(Math.random() * p.openings.length)];
  conversationHistory.push({ role: "assistant", content: opening });
  await saveHistory(philId);

  const emotion = p.emotions[Math.floor(Math.random() * p.emotions.length)];
  log(`[SPEAK] ${p.name}: "${opening.slice(0, 50)}..." (history: ${conversationHistory.length - 1} prior)`);
  return { opening, emotion };
}

// ═══ CONVERSATION DISPLAY HELPERS ═══
// String[] formatted for the sliding text window on the Speak page.
// Newest at the end. Both speakers' names render in ALL-CAPS — the
// closest we get to visual emphasis on a grayscale display with no
// per-line styling. No fancy Unicode prefix characters — the LVGL
// font on-glass doesn't include ▌, ●, ◦, ⋯ etc. so they render as
// empty tofu boxes. ASCII caps alone do the differentiation work.
export function getConversationDisplay(philName: string): string[] {
  const PHIL = philName.toUpperCase();
  return conversationHistory.map(m =>
    m.role === "user"
      ? `YOU: ${m.content}`
      : `${PHIL}: ${m.content}`
  );
}

export function clearConversationHistory(): void {
  // For a "reset chat" affordance later. Does not touch stored history
  // unless followed by saveHistory().
  conversationHistory = [];
}

/**
 * Persist the current conversation immediately. Called from lifecycle
 * handlers (FOREGROUND_EXIT, ABNORMAL_EXIT, SYSTEM_EXIT) to avoid losing
 * a pending exchange if the user backgrounds the app mid-conversation.
 */
export async function flushHistory(): Promise<void> {
  if (currentPhilId) await saveHistory(currentPhilId);
}

// ═══ START RECORDING — opens mic via bridge ═══
export async function startRecording(): Promise<boolean> {
  if (!bridgeRef || isRecording) return false;
  isRecording = true;
  audioChunks = [];

  try {
    await bridgeRef.audioControl(true);
    log("[SPEAK] Mic open");
    return true;
  } catch (e) {
    console.error("[SPEAK] Mic open failed:", e);
    isRecording = false;
    return false;
  }
}

// ═══ HANDLE AUDIO CHUNK — called from event handler ═══
export function handleAudioChunk(pcm: Uint8Array): void {
  if (!isRecording) return;
  audioChunks.push(new Uint8Array(pcm));
}

// ═══ STOP RECORDING — closes mic, transcribes, sends to philosopher ═══
export async function stopRecordingAndSend(): Promise<{ text: string; emotion: string; userMood: string } | null> {
  if (!bridgeRef) { log("[SPEAK] No bridge ref", "error"); return null; }
  
  // Close mic regardless of isRecording state
  const hadChunks = audioChunks.length > 0;
  isRecording = false;

  try {
    await bridgeRef.audioControl(false);
    log("[SPEAK] Mic closed");
  } catch (e) {
    console.error("[SPEAK] Mic close failed:", e);
  }

  if (!hadChunks) {
    log("[SPEAK] No audio captured", "error");
    return null;
  }

  // Combine chunks
  const totalLen = audioChunks.reduce((sum, c) => sum + c.length, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  audioChunks = [];

  log(`[SPEAK] Processing ${totalLen} bytes...`);

  // Encode to base64
  let binary = "";
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  const base64 = btoa(binary);

  // Transcribe via Vercel proxy
  let userText = "";
  try {
    const resp = await fetch(TRANSCRIBE_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: base64 }),
    });
    if (!resp.ok) throw new Error(`Transcribe ${resp.status}`);
    const data = await resp.json();
    userText = data.text?.trim() || "";
  } catch (e) {
    console.error("[SPEAK] Transcribe error:", e);
    log("[SPEAK] Transcribe failed", "error");
    return null;
  }

  if (!userText) {
    log("[SPEAK] No speech detected", "error");
    return null;
  }

  log(`[SPEAK] You: "${userText}"`);

  // Send to philosopher
  return await sendMessage(userText);
}

// ═══ SEND MESSAGE TO PHILOSOPHER ═══
export async function sendMessage(userText: string): Promise<{ text: string; emotion: string; userMood: string }> {
  if (!currentPersona) {
    return { text: "No philosopher selected.", emotion: "contemplation", userMood: "neutral" };
  }

  conversationHistory.push({ role: "user", content: userText, ts: Date.now() });

  try {
    log(`[SPEAK] Calling API...`);
    const body = JSON.stringify({
      persona: currentPersona,
      history: conversationHistory,
      userMessage: userText,
    });
    log(`[SPEAK] Body size: ${body.length} chars`);

    const resp = await fetch(SPEAK_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    log(`[SPEAK] API status: ${resp.status}`);

    if (!resp.ok) {
      const err = await resp.text();
      log(`[SPEAK] API error body: ${err.slice(0, 100)}`, "error");
      throw new Error(`API ${resp.status}: ${err}`);
    }

    const data = await resp.json();
    log(`[SPEAK] Got response: ${JSON.stringify(data).slice(0, 80)}`);
    const text: string = data.text || "...";
    const emotion: string = data.emotion || "contemplation";
    const userMood: string = data.userMood || "neutral";

    // Tag the user message we already pushed with the mood GPT inferred.
    // Walk back to the last user turn and decorate it.
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      if (conversationHistory[i].role === "user") {
        conversationHistory[i].userMood = userMood;
        conversationHistory[i].ts = conversationHistory[i].ts || Date.now();
        break;
      }
    }
    // Assistant turn carries the emotion + a copy of the user mood for easy querying.
    conversationHistory.push({
      role: "assistant",
      content: text,
      ts: Date.now(),
      emotion,
      userMood,
    });

    // Keep sent-to-GPT context manageable (doesn't affect stored history size)
    if (conversationHistory.length > 40) {
      conversationHistory = conversationHistory.slice(-40);
    }

    // Persist after every full exchange
    await saveHistory(currentPhilId);

    log(`[SPEAK] ${currentPersona.name} [${emotion}] (user: ${userMood}): "${text.slice(0, 50)}..."`);
    return { text, emotion, userMood };

  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[SPEAK] API error:", e);
    log(`[SPEAK] FAILED: ${msg.slice(0, 100)}`, "error");
    conversationHistory.pop();
    await saveHistory(currentPhilId);
    return { text: `Error: ${msg.slice(0, 80)}`, emotion: "contemplation", userMood: "neutral" };
  }
}

// ═══ EMOTION → SPRITE ═══
// Canonical emotions that have an actual sprite file in public/sprites/.
// Every philosopher has all 23 emotions, so any canonical name resolves.
const CANONICAL_EMOTIONS = [
  "acceptance", "authority", "awe", "compassion", "contemplation",
  "conviction", "defiance", "devotion", "doubt", "grief",
  "honor", "joy", "liberation", "neutral", "peace",
  "rage", "resolve", "serenity", "sorrow", "teaching",
  "transcendence", "urgency", "wonder",
] as const;
export const EMOTION_LIST: readonly string[] = CANONICAL_EMOTIONS;

// GPT sometimes returns slightly different wording than our sprite names
// (from older prompt lists, common English synonyms, etc). Map those to
// the nearest canonical emotion so the face still updates visibly.
const EMOTION_SYNONYMS: Record<string, typeof CANONICAL_EMOTIONS[number]> = {
  // older 8-emotion prompt list → canonical
  "contemplative": "contemplation",
  "stern":         "conviction",
  "warm":          "compassion",
  "passionate":    "devotion",
  "amused":        "joy",
  "sorrowful":     "sorrow",
  "resolute":      "resolve",
  "mystical":      "transcendence",
  // common GPT synonyms
  "thoughtful":    "contemplation",
  "reflective":    "contemplation",
  "angry":         "rage",
  "happy":         "joy",
  "sad":           "sorrow",
  "calm":          "serenity",
  "peaceful":      "peace",
  "curious":       "wonder",
  "resolved":      "resolve",
  "authoritative": "authority",
  "defiant":       "defiance",
  "urgent":        "urgency",
  "compassionate": "compassion",
  "accepting":     "acceptance",
  "devotional":    "devotion",
  "doubtful":      "doubt",
  "grieving":      "grief",
  "honorable":     "honor",
  "liberated":     "liberation",
  "awed":          "awe",
  "teaching":      "teaching",
  "transcendent":  "transcendence",
};

export function normalizeEmotion(raw: string): string {
  const e = (raw || "").toLowerCase().trim();
  if ((CANONICAL_EMOTIONS as readonly string[]).includes(e)) return e;
  if (EMOTION_SYNONYMS[e]) return EMOTION_SYNONYMS[e];
  return "neutral";
}

export function emotionToSprite(philId: string, emotion: string): string {
  return `${philId}/${philId}-${normalizeEmotion(emotion)}.png`;
}

/**
 * Map the user's inferred mood → the philosopher's empathic RESPONSE
 * face. Not mirroring your mood back (they aren't sad), but showing how
 * they meet you in it. Any mood GPT returns gets routed through here
 * before we pick a sprite file.
 *
 * Three rough empathic registers:
 *   • soft / receiving   (compassion, sorrow) — for grief, pain, shame
 *   • grounding / still  (serenity, peace)    — for anxiety, rage, overwhelm
 *   • orienting / teaching (teaching, authority, contemplation)
 *                        — for confusion, being stuck, seeking
 */
export function userMoodToEmpathySprite(userMood: string): string {
  const m = (userMood || "").toLowerCase().trim();
  const map: Record<string, string> = {
    // soft / receiving (grief family)
    grieving: "compassion", mournful: "compassion", heartbroken: "sorrow",
    sad: "sorrow",           sorrowful: "compassion",
    lonely: "compassion",    lost: "compassion",
    numb: "compassion",      drained: "compassion",
    guilty: "acceptance",    ashamed: "compassion",
    exhausted: "compassion",

    // grounding / still (anxiety family)
    anxious: "serenity",     worried: "peace",      nervous: "serenity",
    restless: "serenity",    overwhelmed: "peace",  panicked: "peace",
    angry: "serenity",       enraged: "peace",      resentful: "compassion",
    frustrated: "acceptance", irritated: "peace",

    // orienting / teaching (cognitive family)
    confused: "teaching",    conflicted: "teaching", stuck: "teaching",
    blocked: "teaching",     unsure: "contemplation", uncertain: "contemplation",
    doubtful: "contemplation", seeking: "teaching",   searching: "wonder",
    questioning: "wonder",

    // bright / open (positive family — philosopher still honors it)
    hopeful: "joy",          inspired: "awe",        curious: "wonder",
    proud: "devotion",       resolved: "authority",  determined: "authority",
    grateful: "joy",         content: "peace",

    // neutral / flat
    neutral: "contemplation", reflective: "contemplation", thoughtful: "contemplation",
  };
  return map[m] || "compassion";  // default: meet unknown moods with compassion, not a blank face
}

/**
 * Walk back through conversationHistory to find the last userMood GPT
 * recorded on a user turn. Used so the LISTENING sprite picks up on
 * the emotional register the user has been in — if they've been grieving
 * for 3 turns, listening-face stays compassionate, doesn't snap back
 * to generic contemplation.
 */
export function getLastUserMood(): string | null {
  for (let i = conversationHistory.length - 1; i >= 0; i--) {
    const m = conversationHistory[i];
    if (m.role === "user" && m.userMood && m.userMood !== "neutral") return m.userMood;
  }
  return null;
}

// ═══ GETTERS ═══
export function isCurrentlyRecording(): boolean { return isRecording; }
export function getConversationLength(): number { return conversationHistory.length; }
export function endConversation(): void {
  currentPersona = null;
  currentPhilId = "";
  conversationHistory = [];
  isRecording = false;
  log("[SPEAK] Conversation ended");
}
