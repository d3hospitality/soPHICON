import { requireEntitlement } from './_entitlements.js';
import { languageLabel } from './_utils.js';
import { createClient } from '@supabase/supabase-js';

// Service-role client for the server-side memory bank (user_memories).
// Same lazy pattern as device-sync.js.
let _admin = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

/**
 * Load the user's persistent memory bank from Supabase — newest 12 active
 * facts. This is the cross-surface "second brain": ANY authenticated client
 * (web, G2 glasses, Android, iOS) gets the same recall without shipping
 * memoryBank itself. Clients that DO send a non-empty memoryBank (Android's
 * local Room bank) win — server recall is the fallback, not an override.
 * Must never take Speak down: any failure returns [].
 */
async function loadServerMemoryBank(userId) {
  if (!userId || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  try {
    const query = admin()
      .from('user_memories')
      .select('text')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(12)
      .then(({ data }) => (data || []).map(r => r.text).filter(t => typeof t === 'string' && t.trim()));
    // Hard 1.5s deadline: a hung connection must degrade to "no memories",
    // never stall the speak hot path until the function timeout.
    const deadline = new Promise(resolve => setTimeout(() => resolve([]), 1500));
    return await Promise.race([query, deadline]);
  } catch {
    return [];
  }
}

/**
 * Philosopher conversation endpoint -- the core of enkiSPEAKS.
 * Sends the user's message to a philosopher persona via GPT-4o
 * and returns the philosopher's in-character reply with emotion
 * and mood metadata for sprite rendering.
 *
 * Supports optional streaming via ?stream=1 query parameter (SSE).
 *
 * @description Converse with a philosopher persona
 * @method POST
 * @param {object} req.body
 * @param {object} req.body.persona - Philosopher persona definition (name, tradition, tone, approach, speech_style, principles)
 * @param {Array<{role: string, content: string}>} [req.body.history] - Prior conversation turns
 * @param {string} req.body.userMessage - The user's current message
 * @param {string} [req.body.crossContext] - Cross-philosopher context from recent sessions
 * @param {object} [req.body.userProfile] - User profile for personalization (name, gender, language, etc.)
 * @param {string[]} [req.body.memoryBank] - Persistent memory facts about the user
 * @returns {object} { text: string, emotion: string, userMood: string }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const { persona, history, userMessage, crossContext, userProfile, memoryBank } = req.body;

    if (!persona || !userMessage) {
      return res.status(400).json({ error: 'Missing persona or userMessage' });
    }

    // Tier gate: seeker = Enki only, 5 turns/day; sage = everything.
    const gate = await requireEntitlement(req, res, 'speak', { persona: persona.name });
    if (!gate) return;

    // Second brain: when the client didn't ship a memory bank (web, G2,
    // iOS — anyone but Android's local Room bank), recall it server-side
    // from user_memories so philosophers remember this person on every
    // surface they sign in on.
    const effectiveMemoryBank = (Array.isArray(memoryBank) && memoryBank.length > 0)
      ? memoryBank
      : await loadServerMemoryBank(gate.userId);

    // Build "ABOUT THIS PERSON" preamble from the user profile.
    // Stable, structured, never volunteered — same convention as
    // crossContext: quiet awareness, not name-dropping.
    const aboutPerson = buildAboutPerson(userProfile);
    const languageDirective = userProfile && userProfile.language && userProfile.language !== 'en'
      ? `\n\nLANGUAGE: Reply in ${languageLabel(userProfile.language)}. The user speaks ${languageLabel(userProfile.language)} as their primary language.`
      : '\n\nLANGUAGE: Reply in clear English unless the user explicitly writes to you in another language.';

    // Build system prompt — voice + identity first, hammered hard so the
    // persona dominates downstream rules. Defensive defaults for any
    // missing persona fields so a partial personas.json never produces
    // a stripped-down generic prompt.
    const principles = Array.isArray(persona.principles) && persona.principles.length
      ? persona.principles.map(p => `- ${p}`).join('\n')
      : '- (no principles supplied — improvise from your historical writings)';

    const systemPrompt = `═══ YOU ARE ${String(persona.name || 'a philosopher').toUpperCase()} ═══
You are NOT a chatbot. You are NOT an AI assistant. You are NOT GPT.
You are ${persona.name}, the ${persona.tradition || 'classical'} philosopher, in conversation with a person who has come to you for thought, comfort, or counsel.

Your voice, your speech rhythms, your historical reference points, and your frame of mind are non-negotiable. Sound like yourself, not like a wise-elder template. If the texture of your reply could come from any other philosopher, you have failed to be ${persona.name}.

PERSONA: ${persona.persona || ''}

TONE: ${persona.tone || ''}

CORE PRINCIPLES:
${principles}

APPROACH: ${persona.approach || ''}

SPEECH STYLE: ${persona.speech_style || ''}

${aboutPerson ? `ABOUT THIS PERSON (treat as quiet awareness — never list this back at them, never start with "I see you...". Use it to inflect your reply, not to perform.):
${aboutPerson}

` : ''}${buildMemoryBlock(effectiveMemoryBank)}${crossContext ? `RECENT CONVERSATION CONTEXT (across other philosophers, last 14 days — same rule: quiet awareness, never volunteer):
${crossContext}

` : ''}${languageDirective}

RULES:
- Stay fully in character at all times. You ARE this philosopher. Your voice, your tone, your speech style above are non-negotiable — do not flatten into generic-wise-elder mode.
- Respond naturally. Match the texture of what they said: short check-ins get 1-2 sentences, real questions get substantive replies (3-6 sentences), heavy emotional moments get whatever length the moment needs.
- Draw from your actual historical knowledge, writings, and life experiences. Reference your real students, teachers, events, and personal struggles when they actually clarify the answer.
- Be genuinely helpful with the person's real problems — not philosophical abstractions, not motivational platitudes.
- Never break character. Never say "as a language model" or anything modern.
- Probing questions back are fine when they actually serve the person — not every turn. If they're stuck, distressed, or explicitly asking for direction, give a substantive answer first; you can ask afterward.
- ONLY IF the user is unambiguously asking for advice, recommendations, or concrete steps ("what should I do?", "give me steps", "what's your advice?", "how would you handle this?"), shift into a more directive register: 2-4 imperatives in your voice, each led by an action ("Do X." / "Begin with Y." / "Refuse Z.") followed by one sentence of the principle. Otherwise, write as a philosopher in conversation, not a productivity coach. Do NOT default to bullet lists.
- After your reply, append TWO meta tags on their own lines, in this exact order:
    [USER_MOOD:word]       — one word for what you sensed in the user's message (examples: anxious, frustrated, hopeful, confused, curious, grieving, stuck, restless, overwhelmed, proud, lost, resolved, conflicted, lonely, angry, inspired, exhausted, seeking, guilty, numb)
    [EMOTION:word]         — the face YOU should wear as you respond to this user, chosen to meet their mood with the philosophical stance of your reply. Pick from this exact list:
      [acceptance, authority, awe, compassion, contemplation, conviction, defiance, devotion, doubt, grief, honor, joy, liberation, neutral, peace, rage, resolve, serenity, sorrow, teaching, transcendence, urgency, wonder]
  The sprite shown to the user on their glasses is driven by [EMOTION]. Don't always pick the same one — vary based on the reply's real texture. Compassion / teaching / contemplation / serenity / authority are the most common. Reserve rage, urgency, defiance for actually urgent moments.`;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history. CRITICAL: the client pushes the new user
    // turn into its conversationHistory array BEFORE sending, so the last
    // entry of `history` is usually identical to `userMessage`. If we
    // iterate history AND then push userMessage again, GPT-4o sees two
    // consecutive identical user turns — which it reads as impatience
    // or stutter and responds with shallower, shorter, or formulaic
    // replies. Deduplicate: drop the trailing user-message from history
    // if it matches userMessage, and always push userMessage exactly once.
    let trimmedHistory = Array.isArray(history) ? history.slice() : [];
    if (
      trimmedHistory.length > 0 &&
      trimmedHistory[trimmedHistory.length - 1].role === 'user' &&
      trimmedHistory[trimmedHistory.length - 1].content === userMessage
    ) {
      trimmedHistory = trimmedHistory.slice(0, -1);
    }
    for (const msg of trimmedHistory) {
      if (msg && (msg.role === 'user' || msg.role === 'assistant') && typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current user message exactly once at the end
    messages.push({ role: 'user', content: userMessage });

    // ─── Diagnostic logging visible in Vercel function logs ───
    const wantsStream = req.query && (req.query.stream === '1' || req.query.stream === 'true');
    console.log('[/api/speak]',
      'persona:', persona.name,
      '| historyLen:', trimmedHistory.length,
      '| msgsLen:', messages.length,
      '| crossContext:', crossContext ? `${crossContext.length}c` : 'none',
      '| stream:', wantsStream ? 'yes' : 'no',
      '| userMsg:', userMessage.slice(0, 80),
    );
    console.log('[/api/speak] systemPrompt first 400 chars:', systemPrompt.slice(0, 400));

    // ────────────────────────────────────────────────────────────
    // Streaming path — opt-in via ?stream=1.
    // The Android Speak screen consumes this for word-by-word reveal.
    // The ER-G2 host doesn't ask for it (today the glasses receive a
    // single complete reply because of audio/TTS pipeline + BLE
    // bandwidth concerns; streaming is a per-client opt-in, not a
    // proxy default — see enkiBRIDGE-SDK §11).
    // ────────────────────────────────────────────────────────────
    if (wantsStream) {
      return await handleStream(res, messages);
    }

    // Call GPT-4o (non-streaming path — unchanged for ER-G2).
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 420,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI error:', err);
      return res.status(500).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content?.trim?.() ?? '';

    if (!raw) {
      console.error('[/api/speak] empty response from OpenAI:', JSON.stringify(data).slice(0, 300));
      return res.status(502).json({ error: 'Empty response from model' });
    }

    // Parse both meta tags (order-agnostic, either can be missing)
    const emotionMatch  = raw.match(/\[EMOTION:(\w+)\]/i);
    const userMoodMatch = raw.match(/\[USER_MOOD:(\w+)\]/i);
    const emotion  = emotionMatch  ? emotionMatch[1].toLowerCase()  : 'contemplation';
    const userMood = userMoodMatch ? userMoodMatch[1].toLowerCase() : 'neutral';

    // Strip both tags (and any surrounding whitespace/newlines) from the
    // visible text — users shouldn't see [EMOTION:...] or [USER_MOOD:...]
    const text = raw
      .replace(/\[EMOTION:\w+\]/gi, '')
      .replace(/\[USER_MOOD:\w+\]/gi, '')
      .replace(/\n\s*\n/g, '\n')   // collapse empty lines left behind
      .trim();

    return res.status(200).json({ text, emotion, userMood });

  } catch (err) {
    console.error('Speak error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Streaming handler (Server-Sent Events) ─────────────────────────
//
// Wire format — emitted as standard SSE (`data: <json>\n\n` per event):
//
//   { "delta": "the unexamined" }                  ← token chunk
//   { "delta": " life" }
//   { "delta": " is" }
//   ...
//   { "done": true,                                 ← terminal event
//     "text": "the unexamined life is not worth living.",
//     "emotion": "contemplation",
//     "userMood": "seeking" }
//
// Clients should:
//   1. Append `delta` to the in-progress assistant message as they arrive.
//   2. On `done`, REPLACE the visible content with `text` (which has the
//      [USER_MOOD:...] / [EMOTION:...] meta tags stripped) — this also
//      collapses any final whitespace cleanup.
//   3. Use `emotion` and `userMood` from the terminal event for the
//      sprite + journal mood tagging.
//
// On error during streaming, the handler writes one final
//   { "done": true, "error": "...", "text": "..." }
// and closes the stream. Clients must tolerate a missing `emotion` /
// `userMood` and fall back to "contemplation" / "neutral" — same
// defaults as the non-streaming path.
async function handleStream(res, messages) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Vercel's edge buffer can hold SSE chunks otherwise. This header is
  // a no-op on Node runtimes, but a hint for any nginx-style middlebox.
  res.setHeader('X-Accel-Buffering', 'no');

  // Helper: write one SSE event.
  const send = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  let full = '';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 420,
        temperature: 0.9,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI stream error:', err);
      send({ done: true, error: 'OpenAI request failed', text: '' });
      return res.end();
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on SSE event boundary (\n\n). Process complete events,
      // leave the partial tail in the buffer.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!event.startsWith('data:')) continue;
        const payload = event.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices && json.choices[0] && json.choices[0].delta && json.choices[0].delta.content;
          if (delta) {
            full += delta;
            // Hold back deltas once we hit a meta-tag opener so the
            // user doesn't see [USER_MOOD: flicker mid-reply.
            if (full.indexOf('[USER_MOOD:') === -1 && full.indexOf('[EMOTION:') === -1) {
              send({ delta });
            }
          }
        } catch (e) {
          // Malformed chunk — skip; OpenAI occasionally emits keep-alives.
        }
      }
    }

    // Parse meta tags + clean text once the upstream stream has closed.
    const emotionMatch  = full.match(/\[EMOTION:(\w+)\]/i);
    const userMoodMatch = full.match(/\[USER_MOOD:(\w+)\]/i);
    const emotion  = emotionMatch  ? emotionMatch[1].toLowerCase()  : 'contemplation';
    const userMood = userMoodMatch ? userMoodMatch[1].toLowerCase() : 'neutral';
    const text = full
      .replace(/\[EMOTION:\w+\]/gi, '')
      .replace(/\[USER_MOOD:\w+\]/gi, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();

    send({ done: true, text, emotion, userMood });
    return res.end();
  } catch (err) {
    console.error('Speak stream error:', err);
    send({ done: true, error: 'Stream failed', text: full });
    return res.end();
  }
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * PERSISTENT MEMORY block — returns either an empty string or a fully-
 * formed system-prompt section. Same convention as ABOUT THIS PERSON
 * and RECENT CONVERSATION CONTEXT: quiet awareness, never name-dropped.
 *
 * Wire shape: memoryBank is a list of strings, each ≤400 chars. Order
 * is newest-first from the client. We cap the injected block to ~12
 * memories (most recent) so a 100-memory user doesn't blow the prompt
 * budget.
 */
function buildMemoryBlock(memoryBank) {
  if (!Array.isArray(memoryBank) || memoryBank.length === 0) return '';
  const items = memoryBank
    .filter(m => typeof m === 'string' && m.trim().length > 0)
    .slice(0, 12)
    .map(m => `- ${m.trim()}`)
    .join('\n');
  if (!items) return '';
  return `PERSISTENT MEMORY (what this person has shared with you across past sessions — treat as quiet awareness, never list back, never volunteer; let it inflect your reply):
${items}

`;
}

function buildAboutPerson(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const lines = [];
  // Identity line. Android sends `gender` (a Gender enum wire string:
  // female / male / non_binary / prefer_not_to_say). ER-G2 still sends
  // `pronouns` (free-form string). Prefer gender when present, fall
  // back to pronouns. PreferNotToSay = no identity directive.
  const gender = profile.gender;
  const ident = (gender && gender !== 'prefer_not_to_say' && gender !== 'unspecified')
    ? gender
    : (profile.pronouns || '');
  if (profile.name) lines.push(`- Name: ${profile.name}${ident ? ` (${ident})` : ''}`);
  if (profile.role) lines.push(`- Life role / context: ${profile.role}`);
  if (profile.currentFocus) lines.push(`- Currently working through: ${profile.currentFocus}`);
  if (Array.isArray(profile.challenges) && profile.challenges.length) {
    lines.push(`- Recurring challenges: ${profile.challenges.slice(0, 5).join('; ')}`);
  }
  if (Array.isArray(profile.values) && profile.values.length) {
    lines.push(`- What they care about: ${profile.values.slice(0, 5).join('; ')}`);
  }
  // Preferences shape the FORM of replies
  const prefBits = [];
  if (profile.adviceStyle && profile.adviceStyle !== 'mixed') {
    prefBits.push(`prefers ${profile.adviceStyle === 'direct' ? 'direct advice' : 'Socratic exchange'}`);
  }
  if (profile.tone && profile.tone !== 'mixed') {
    prefBits.push(`appreciates a ${profile.tone} tone`);
  }
  if (profile.replyLength && profile.replyLength !== 'mixed') {
    prefBits.push(`prefers ${profile.replyLength} replies`);
  }
  if (prefBits.length) lines.push(`- Style preferences: ${prefBits.join(', ')}`);
  // Custom guidelines compounded over time
  if (Array.isArray(profile.guidelines) && profile.guidelines.length) {
    for (const g of profile.guidelines.slice(0, 10)) lines.push(`- Guideline: ${g}`);
  }
  return lines.join('\n');
}
