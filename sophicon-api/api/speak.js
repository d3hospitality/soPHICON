export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { persona, history, userMessage, crossContext, userProfile } = req.body;

    if (!persona || !userMessage) {
      return res.status(400).json({ error: 'Missing persona or userMessage' });
    }

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

` : ''}${crossContext ? `RECENT CONVERSATION CONTEXT (across other philosophers, last 14 days — same rule: quiet awareness, never volunteer):
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
    console.log('[/api/speak]',
      'persona:', persona.name,
      '| historyLen:', trimmedHistory.length,
      '| msgsLen:', messages.length,
      '| crossContext:', crossContext ? `${crossContext.length}c` : 'none',
      '| userMsg:', userMessage.slice(0, 80),
    );
    console.log('[/api/speak] systemPrompt first 400 chars:', systemPrompt.slice(0, 400));

    // Call GPT-4o
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
    const raw = data.choices[0].message.content.trim();

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

// ─── Helpers ────────────────────────────────────────────────────────
function buildAboutPerson(profile) {
  if (!profile || typeof profile !== 'object') return '';
  const lines = [];
  if (profile.name) lines.push(`- Name: ${profile.name}${profile.pronouns ? ` (${profile.pronouns})` : ''}`);
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

function languageLabel(code) {
  const map = {
    en: 'English', es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
    hi: 'Hindi', ar: 'Arabic',
  };
  return map[code] || code;
}
