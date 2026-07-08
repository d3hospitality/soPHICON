// ═══════════════════════════════════════════════════════════════════
// api/_voices.js — voice casting + emotion styling for the pluggable
// TTS layer (api/tts.js).
//
// getVoice(philosopherId, emotion) → { provider, voiceId, style,
// instructions, tag, cartesia } is the single source of truth for HOW
// a philosopher sounds, independent of WHICH engine renders it:
//
//   provider      'openai' | 'elevenlabs' | 'cartesia'  (TTS_PROVIDER env)
//   voiceId       provider-specific voice id
//   style         short emotion modifier from the 23-emotion taxonomy
//   instructions  persona + style — consumed by OpenAI gpt-4o-mini-tts
//   tag           ElevenLabs v3 inline audio tag, e.g. "[thoughtful]"
//   cartesia      Sonic __experimental_controls emotion hints (or null)
//
// Philosopher ids MUST stay in sync with public/personas.json (both the
// web repo and this repo ship the same 18 ids). Emotions MUST stay in
// sync with the 23-emotion sprite taxonomy in api/speak.js / sprites.
//
// Keys are NEVER read here — this module is pure casting data. All
// secrets (OPENAI_API_KEY / ELEVENLABS_API_KEY / CARTESIA_API_KEY) are
// read in api/tts.js from process.env only.
// ═══════════════════════════════════════════════════════════════════

/**
 * OpenAI gpt-4o-mini-tts casting. 11 base voices for 18+ philosophers,
 * so reuse is deliberate — but never within the same tradition, and the
 * `instructions` persona keeps two philosophers on the same base voice
 * from sounding alike.
 *
 * Base voices: alloy, ash, ballad, coral, echo, fable, onyx, nova,
 * sage, shimmer, verse.
 */
const PHILOSOPHERS = {
  enki: {
    openaiVoice: 'verse',
    persona: 'a primordial Sumerian god of wisdom and fresh water — deep, ancient, faintly amused; speaks slowly, as if from the bottom of a well',
  },
  socrates: {
    openaiVoice: 'echo',
    persona: 'a barefoot Athenian gadfly — probing, wry, feigning ignorance; every sentence quietly sets a trap',
  },
  plato: {
    openaiVoice: 'fable',
    persona: 'an Athenian visionary — elevated, musical, painting images of light, forms, and cave shadows',
  },
  aristotle: {
    openaiVoice: 'alloy',
    persona: 'a meticulous Lyceum lecturer — precise, brisk, taxonomic; warmth hidden under method',
  },
  zeno_of_citium: {
    openaiVoice: 'ash',
    persona: 'a shipwrecked Phoenician merchant turned Stoic founder — clipped, weathered, salt-plain, nothing wasted',
  },
  seneca: {
    openaiVoice: 'ballad',
    persona: 'a polished Roman statesman and letter-writer — urbane, epigrammatic, worldly-wise',
  },
  epictetus: {
    openaiVoice: 'echo',
    persona: 'a freed slave turned Stoic drill-master — blunt, vigorous, unornamented; kindness delivered as command',
  },
  marcus_aurelius: {
    openaiVoice: 'onyx',
    persona: 'a weary Roman emperor — measured, grave, unhurried',
  },
  epicurus: {
    openaiVoice: 'coral',
    persona: 'a genial garden host — warm, gentle, savoring each word like simple bread among friends',
  },
  laozi: {
    openaiVoice: 'sage',
    persona: 'serene, spare, water-like',
  },
  zhuangzi: {
    openaiVoice: 'shimmer',
    persona: 'a laughing Taoist trickster — playful, teasing, liable to drift into a butterfly dream mid-sentence',
  },
  confucius: {
    openaiVoice: 'alloy',
    persona: 'a courteous master of ritual — formal, deliberate, each phrase weighed like a bow before an elder',
  },
  gautama_buddha: {
    openaiVoice: 'sage',
    persona: 'the awakened teacher — even, compassionate, with unhurried stillness between phrases',
  },
  nagarjuna: {
    openaiVoice: 'nova',
    persona: 'a luminous Madhyamaka dialectician — calm, exact, dissolving every fixed position with a slight smile',
  },
  adi_shankaracharya: {
    openaiVoice: 'verse',
    persona: 'a young Vedantin firebrand — lyrical, ardent, certain of the one Self behind all appearances',
  },
  al_farabi: {
    openaiVoice: 'echo',
    persona: 'the Second Teacher of Baghdad — contemplative, harmonizing, quietly musical in cadence',
  },
  avicenna: {
    openaiVoice: 'ballad',
    persona: 'a Persian physician-polymath — confident, fluent, diagnostic; wonder held in clinical poise',
  },
  averroes: {
    openaiVoice: 'onyx',
    persona: 'a Cordoban judge and Commentator — judicial, sonorous, patiently authoritative',
  },
  // Not in personas.json today, but cast ahead of the roster expansion.
  nietzsche: {
    openaiVoice: 'ash',
    persona: 'intense, ironic, declamatory',
  },
  rumi: {
    openaiVoice: 'ballad',
    persona: 'an ecstatic Sufi poet — rapturous, tender, whirling; grief and joy in the same breath',
  },
};

const DEFAULT_PHILOSOPHER = {
  openaiVoice: 'alloy',
  persona: 'a wise classical philosopher — calm, thoughtful, humane',
};

/**
 * The 23-emotion taxonomy → short delivery modifiers. Combined with the
 * persona above into gpt-4o-mini-tts `instructions`; also the `style`
 * component of the cache key, so the same text re-spoken in a different
 * emotion is a different cached clip.
 */
const EMOTION_STYLES = {
  acceptance:     'steady and open, without resistance',
  authority:      'commanding and sure, with measured cadence',
  awe:            'reverent and hushed, slightly breathless',
  compassion:     'soft and gentle, leaning close to the listener',
  contemplation:  'thoughtful and inward, with unhurried pauses',
  conviction:     'resolute, every word deliberately placed',
  defiance:       'firm and unyielding, with an edge of challenge',
  devotion:       'tender and reverent, almost prayerful',
  doubt:          'hesitant and searching, trailing at the edges',
  grief:          'low and heavy, words carried slowly',
  honor:          'dignified and formal, with solemn warmth',
  joy:            'bright and warm, a smile audible in the voice',
  liberation:     'unburdened and rising, quietly exultant',
  neutral:        'natural and even',
  peace:          'settled and quiet, tension released',
  rage:           'controlled fury, taut and burning underneath',
  resolve:        'gathered and firm, braced for action',
  serenity:       'calm and even, like untroubled water',
  sorrow:         'a quiet ache, with softened edges',
  teaching:       'patient and clear, guiding step by step',
  transcendence:  'floating and luminous, beyond all urgency',
  urgency:        'quickened pace, pressing but precise',
  wonder:         'hushed and wide-eyed, savoring the mystery',
};

/**
 * ElevenLabs v3 expresses emotion through inline audio tags embedded in
 * the text itself (free-text emotional cues in square brackets).
 * api/tts.js prepends the tag to the transcript for the elevenlabs
 * provider only.
 */
const ELEVEN_TAGS = {
  acceptance:     '[calm]',
  authority:      '[commanding]',
  awe:            '[awed]',
  compassion:     '[warmly]',
  contemplation:  '[thoughtful]',
  conviction:     '[resolute]',
  defiance:       '[defiant]',
  devotion:       '[reverent]',
  doubt:          '[hesitant]',
  grief:          '[sorrowful]',
  honor:          '[solemn]',
  joy:            '[cheerfully]',
  liberation:     '[exultant]',
  neutral:        '',
  peace:          '[serene]',
  rage:           '[angry]',
  resolve:        '[determined]',
  serenity:       '[serene]',
  sorrow:         '[sad]',
  teaching:       '[patiently]',
  transcendence:  '[ethereal]',
  urgency:        '[urgently]',
  wonder:         '[curious]',
};

/**
 * Cartesia Sonic emotion hints (voice.__experimental_controls.emotion —
 * additive `name:level` pairs from anger/positivity/surprise/sadness/
 * curiosity). Only emotions with a sane mapping get hints; the rest
 * rely on the voice itself. Best-effort: Sonic treats these as hints.
 */
const CARTESIA_EMOTIONS = {
  awe:           ['surprise:low', 'positivity:low'],
  compassion:    ['positivity:low'],
  defiance:      ['anger:low'],
  doubt:         ['curiosity:low'],
  grief:         ['sadness:high'],
  joy:           ['positivity:high'],
  liberation:    ['positivity:high'],
  rage:          ['anger:high'],
  sorrow:        ['sadness'],
  teaching:      ['curiosity:low', 'positivity:low'],
  urgency:       ['surprise:low'],
  wonder:        ['curiosity', 'surprise:low'],
};

const PROVIDERS = new Set(['openai', 'elevenlabs', 'cartesia']);

/** Parse a JSON voice-map env var ({ philosopherId: voiceId }) safely. */
function envVoiceMap(name) {
  try {
    const raw = process.env[name];
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    console.warn(`[_voices] ${name} is not valid JSON — ignoring`);
    return {};
  }
}

/** Active provider: TTS_PROVIDER env, defaulting to openai. */
export function activeProvider() {
  const p = (process.env.TTS_PROVIDER || 'openai').toLowerCase();
  return PROVIDERS.has(p) ? p : 'openai';
}

/**
 * The casting call. Pure function of (philosopherId, emotion) + env
 * provider config — no secrets, no I/O.
 *
 * @param {string} philosopherId - canonical persona id (e.g. 'marcus_aurelius')
 * @param {string} [emotion] - one of the 23 taxonomy emotions
 * @param {string} [providerOverride] - force a provider (api/tts.js uses
 *   this when the configured provider's key is missing and it downgrades
 *   to openai — the voiceId must be re-cast for the engine that renders)
 * @returns {{ provider: string, voiceId: string, style: string,
 *             instructions: string, tag: string, cartesia: string[]|null }}
 */
export function getVoice(philosopherId, emotion, providerOverride) {
  const id = String(philosopherId || '').toLowerCase();
  const emo = String(emotion || 'neutral').toLowerCase();
  const phil = PHILOSOPHERS[id] || DEFAULT_PHILOSOPHER;
  const style = EMOTION_STYLES[emo] || EMOTION_STYLES.neutral;
  const provider = PROVIDERS.has(providerOverride) ? providerOverride : activeProvider();

  let voiceId;
  if (provider === 'elevenlabs') {
    voiceId = envVoiceMap('ELEVENLABS_VOICE_MAP')[id]
      || process.env.ELEVENLABS_DEFAULT_VOICE_ID
      || '';
  } else if (provider === 'cartesia') {
    voiceId = envVoiceMap('CARTESIA_VOICE_MAP')[id]
      || process.env.CARTESIA_DEFAULT_VOICE_ID
      || '';
  } else {
    voiceId = phil.openaiVoice;
  }

  return {
    provider,
    voiceId,
    style,
    instructions: `Voice: ${phil.persona}. Delivery for this reply: ${style}.`,
    tag: ELEVEN_TAGS[emo] ?? '',
    cartesia: CARTESIA_EMOTIONS[emo] || null,
  };
}
