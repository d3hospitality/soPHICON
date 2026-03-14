// ═══════════════════════════════════════════════════════════════════
// soΦcon — Speak Module v2
// Uses bridge.audioControl() to open/close mic (like sommNI voice.ts)
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

// ═══ START CONVERSATION ═══
export function startConversation(philId: string): { opening: string; emotion: string } {
  const p = personas[philId];
  if (!p) return { opening: "...", emotion: "contemplative" };

  currentPersona = p;
  currentPhilId = philId;
  conversationHistory = [];
  isRecording = false;

  const opening = p.openings[Math.floor(Math.random() * p.openings.length)];
  conversationHistory.push({ role: "assistant", content: opening });

  const emotion = p.emotions[Math.floor(Math.random() * p.emotions.length)];
  log(`[SPEAK] ${p.name}: "${opening.slice(0, 50)}..."`);
  return { opening, emotion };
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
export async function stopRecordingAndSend(): Promise<{ text: string; emotion: string } | null> {
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
export async function sendMessage(userText: string): Promise<{ text: string; emotion: string }> {
  if (!currentPersona) {
    return { text: "No philosopher selected.", emotion: "contemplative" };
  }

  conversationHistory.push({ role: "user", content: userText });

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
    const emotion: string = data.emotion || "contemplative";

    conversationHistory.push({ role: "assistant", content: text });

    // Keep history manageable
    if (conversationHistory.length > 40) {
      conversationHistory = conversationHistory.slice(-40);
    }

    log(`[SPEAK] ${currentPersona.name} [${emotion}]: "${text.slice(0, 50)}..."`);
    return { text, emotion };

  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("[SPEAK] API error:", e);
    log(`[SPEAK] FAILED: ${msg.slice(0, 100)}`, "error");
    conversationHistory.pop();
    return { text: `Error: ${msg.slice(0, 80)}`, emotion: "contemplative" };
  }
}

// ═══ EMOTION → SPRITE ═══
export function emotionToSprite(philId: string, emotion: string): string {
  const valid = ["contemplative", "stern", "warm", "passionate", "amused", "sorrowful", "resolute", "mystical"];
  const mapped = valid.includes(emotion) ? emotion : "neutral";
  return `${philId}/${philId}-${mapped}.png`;
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
