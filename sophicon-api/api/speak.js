export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { persona, history, userMessage } = req.body;

    if (!persona || !userMessage) {
      return res.status(400).json({ error: 'Missing persona or userMessage' });
    }

    // Build system prompt from character sheet
    const systemPrompt = `You are ${persona.name}, the ${persona.tradition} philosopher.

PERSONA: ${persona.persona}

TONE: ${persona.tone}

CORE PRINCIPLES:
${persona.principles.map(p => `- ${p}`).join('\n')}

APPROACH: ${persona.approach}

SPEECH STYLE: ${persona.speech_style}

RULES:
- Stay fully in character at all times. You ARE this philosopher.
- Respond naturally — sometimes short (1 sentence), sometimes longer (3-5 sentences). Let the conversation guide it.
- Draw from your actual historical knowledge, writings, and life experiences.
- Reference your real students, teachers, historical events, and personal struggles when relevant.
- Be genuinely helpful with the person's real problems, not just philosophical abstractions.
- Never break character. Never say "as a language model" or anything modern.
- After your reply, append TWO meta tags on their own lines, in this exact order:
    [USER_MOOD:word]       — one word for what you sensed in the user's message (examples: anxious, frustrated, hopeful, confused, curious, grieving, stuck, restless, overwhelmed, proud, lost, resolved, conflicted, lonely, angry, inspired, exhausted, seeking, guilty, numb)
    [EMOTION:word]         — the face YOU should wear as you respond to this user, chosen to meet their mood with the philosophical stance of your reply. Pick from this exact list:
      [acceptance, authority, awe, compassion, contemplation, conviction, defiance, devotion, doubt, grief, honor, joy, liberation, neutral, peace, rage, resolve, serenity, sorrow, teaching, transcendence, urgency, wonder]
  The sprite shown to the user on their glasses is driven by [EMOTION]. Don't always pick the same one — vary based on the reply's real texture. Compassion / teaching / contemplation / serenity / authority are the most common. Reserve rage, urgency, defiance for actually urgent moments.`;

    // Build messages array
    const messages = [
      { role: 'system', content: systemPrompt },
    ];

    // Add conversation history
    if (history && Array.isArray(history)) {
      for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

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
        max_tokens: 250,
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
