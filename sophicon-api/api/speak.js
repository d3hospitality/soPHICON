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
- End every response with one emotion tag on its own line, from this list: [contemplative, stern, warm, passionate, amused, sorrowful, resolute, mystical]
  Format: [EMOTION:tag]
  Choose the emotion that best matches the energy of your response.`;

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

    // Parse emotion tag from response
    const emotionMatch = raw.match(/\[EMOTION:(\w+)\]\s*$/);
    const emotion = emotionMatch ? emotionMatch[1] : 'contemplative';
    const text = raw.replace(/\[EMOTION:\w+\]\s*$/, '').trim();

    return res.status(200).json({ text, emotion });

  } catch (err) {
    console.error('Speak error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
