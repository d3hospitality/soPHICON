// ═══════════════════════════════════════════════════════════════════
// soΦcon — User Profile module (src/profile.ts)
//
// Single source of truth for "who is this person" — flows through every
// AI endpoint as context-aware guidelines:
//
//   /api/transcribe  — uses .language to lock Whisper (no more
//                      auto-detect drift to Spanish/German/etc.)
//   /api/speak       — injects ABOUT THIS PERSON into the philosopher's
//                      system prompt so replies acknowledge name, role,
//                      current focus, etc. without volunteering them.
//   /api/weekly-overview — uses lifeContext to bias action categories
//                          toward the user's actual life.
//
// Storage: bridge.localStorage key 'user_profile' (single JSON object).
// Default profile is created lazily on first read. Profile is async-only
// so the bridge ref isn't required at module load time.
// ═══════════════════════════════════════════════════════════════════

import { EvenAppBridge } from '@evenrealities/even_hub_sdk';

const PROFILE_KEY = 'user_profile';

export interface UserProfile {
  // Identity
  name: string;
  language: string;          // ISO 639-1, e.g. 'en' — locks Whisper transcription
  languageLabel: string;     // human-readable, e.g. 'English'
  pronouns?: string;

  // Life context (drives ABOUT-THIS-PERSON injection in /api/speak)
  lifeContext: {
    role: string;            // e.g. "founder, hospitality" or "student" or "parent"
    currentFocus: string;    // 1-line: what's on their mind right now
    challenges: string[];    // 0-5 bullets of recurring stressors
    values: string[];        // 0-5 bullets of things they care about
  };

  // Preferences (philosopher tone, advice density)
  preferences: {
    adviceStyle: 'direct' | 'socratic' | 'mixed';
    tone: 'warm' | 'austere' | 'playful' | 'mixed';
    replyLength: 'short' | 'medium' | 'long' | 'mixed';
  };

  // Context-aware guidelines that compound over time as the system learns
  guidelines: string[];      // free-form rules: "never assume I'm religious", etc.

  // Metadata
  createdAt: number;
  updatedAt: number;
  version: number;           // bump when adding fields so older profiles can be migrated
}

const PROFILE_VERSION = 1;

function defaultProfile(): UserProfile {
  const now = Date.now();
  return {
    name: '',
    language: 'en',
    languageLabel: 'English',
    pronouns: '',
    lifeContext: {
      role: '',
      currentFocus: '',
      challenges: [],
      values: [],
    },
    preferences: {
      adviceStyle: 'mixed',
      tone: 'mixed',
      replyLength: 'mixed',
    },
    guidelines: [],
    createdAt: now,
    updatedAt: now,
    version: PROFILE_VERSION,
  };
}

let bridgeRef: EvenAppBridge | null = null;
export function setProfileBridge(b: EvenAppBridge): void { bridgeRef = b; }

let cached: UserProfile | null = null;

export async function loadProfile(): Promise<UserProfile> {
  if (cached) return cached;
  if (!bridgeRef) return (cached = defaultProfile());
  try {
    const raw = await bridgeRef.getLocalStorage(PROFILE_KEY);
    if (!raw) return (cached = defaultProfile());
    const parsed = JSON.parse(raw);
    cached = migrate(parsed);
    return cached;
  } catch {
    return (cached = defaultProfile());
  }
}

function migrate(p: any): UserProfile {
  const def = defaultProfile();
  const out: UserProfile = {
    name: typeof p.name === 'string' ? p.name : def.name,
    language: typeof p.language === 'string' && /^[a-z]{2}$/.test(p.language) ? p.language : def.language,
    languageLabel: typeof p.languageLabel === 'string' ? p.languageLabel : def.languageLabel,
    pronouns: typeof p.pronouns === 'string' ? p.pronouns : '',
    lifeContext: {
      role: p.lifeContext?.role || '',
      currentFocus: p.lifeContext?.currentFocus || '',
      challenges: Array.isArray(p.lifeContext?.challenges) ? p.lifeContext.challenges.slice(0, 5) : [],
      values: Array.isArray(p.lifeContext?.values) ? p.lifeContext.values.slice(0, 5) : [],
    },
    preferences: {
      adviceStyle: ['direct', 'socratic', 'mixed'].includes(p.preferences?.adviceStyle) ? p.preferences.adviceStyle : 'mixed',
      tone: ['warm', 'austere', 'playful', 'mixed'].includes(p.preferences?.tone) ? p.preferences.tone : 'mixed',
      replyLength: ['short', 'medium', 'long', 'mixed'].includes(p.preferences?.replyLength) ? p.preferences.replyLength : 'mixed',
    },
    guidelines: Array.isArray(p.guidelines) ? p.guidelines.slice(0, 20).map(String) : [],
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    updatedAt: Date.now(),
    version: PROFILE_VERSION,
  };
  return out;
}

export async function saveProfile(p: UserProfile): Promise<void> {
  cached = { ...p, updatedAt: Date.now(), version: PROFILE_VERSION };
  if (!bridgeRef) return;
  try { await bridgeRef.setLocalStorage(PROFILE_KEY, JSON.stringify(cached)); }
  catch (e) { console.error('[PROFILE] save failed', e); }
}

export async function patchProfile(patch: Partial<UserProfile>): Promise<UserProfile> {
  const current = await loadProfile();
  const next: UserProfile = { ...current, ...patch, updatedAt: Date.now() };
  // Deep-merge nested objects
  if (patch.lifeContext) next.lifeContext = { ...current.lifeContext, ...patch.lifeContext };
  if (patch.preferences) next.preferences = { ...current.preferences, ...patch.preferences };
  await saveProfile(next);
  return next;
}

export function invalidateProfileCache(): void { cached = null; }

// ═══ Server-payload helpers ═════════════════════════════════════════
/** Compact wire format passed to /api/speak — small, schema-stable. */
export function profileForApi(p: UserProfile): Record<string, any> | null {
  if (!hasMeaningfulProfile(p)) return null;
  return {
    name: p.name || undefined,
    language: p.language,
    pronouns: p.pronouns || undefined,
    role: p.lifeContext.role || undefined,
    currentFocus: p.lifeContext.currentFocus || undefined,
    challenges: p.lifeContext.challenges.length ? p.lifeContext.challenges : undefined,
    values: p.lifeContext.values.length ? p.lifeContext.values : undefined,
    adviceStyle: p.preferences.adviceStyle,
    tone: p.preferences.tone,
    replyLength: p.preferences.replyLength,
    guidelines: p.guidelines.length ? p.guidelines : undefined,
  };
}

function hasMeaningfulProfile(p: UserProfile): boolean {
  return !!(p.name || p.lifeContext.role || p.lifeContext.currentFocus
    || p.lifeContext.challenges.length || p.lifeContext.values.length
    || p.guidelines.length);
}

// ═══ Common languages list (for the Settings dropdown) ══════════════
export const LANGUAGES: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'zh', label: 'Chinese' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ar', label: 'Arabic' },
];
