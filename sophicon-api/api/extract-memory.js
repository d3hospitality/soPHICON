// /api/extract-memory — pull 0-3 candidate memories from a finished
// Speak session. Cheap GPT-4o-mini call so it's not a meaningful budget
// hit per session. Each candidate lands in the client's memory bank
// with status=pending; the user accepts or dismisses in Settings.
//
// Request body (POST JSON):
//   {
//     philName: string,       // e.g. "Marcus Aurelius"
//     tradition: string,
//     exchanges: [             // the session's full exchange list
//       { role: "user" | "assistant", content: string }, ...
//     ],
//     existingMemories: [string]   // optional; passed so we don't re-propose facts the user already has
//   }
//
// Response:
//   { memories: [string, string, ...] }   // 0-3 single-line facts
//
// Memory criteria (in the system prompt below):
//   • Single-line factual statements about the user's life that would
//     persist beyond this conversation
//   • NOT mood / emotion / temporary state ("anxious about X")
//   • NOT advice the philosopher gave ("told to meditate")
//   • NOT the philosopher's own observations about the user — only
//     things the user said about themselves
//   • Each fact ≤ 160 chars
//   • If nothing memorable was shared, return [] — better to skip than
//     pad

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { philName, tradition, exchanges, existingMemories } = req.body || {};
    if (!Array.isArray(exchanges) || exchanges.length === 0) {
      return res.status(200).json({ memories: [] });
    }
    // Skip extraction on tiny sessions — there's nothing to remember
    // from a 1-2-turn check-in.
    const userTurns = exchanges.filter(m => m && m.role === 'user');
    if (userTurns.length < 2) {
      return res.status(200).json({ memories: [] });
    }

    const transcript = exchanges
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => `${m.role.toUpperCase()}: ${m.content.slice(0, 600)}`)
      .join('\n\n');

    const existingBlock = Array.isArray(existingMemories) && existingMemories.length
      ? `\n\nThe user already has these memories on file (do NOT propose anything that duplicates these):\n${existingMemories.slice(0, 20).map(m => `- ${m}`).join('\n')}`
      : '';

    const systemPrompt = `You are a memory-extraction assistant. You read a single conversation between a user and a philosopher (${philName || 'a philosopher'}, ${tradition || 'classical'}) and extract 0 to 3 SINGLE-LINE FACTS the user shared about themselves that would be worth remembering across future sessions.

CRITERIA — a memory must be:
- Something the USER said about themselves (life facts, ongoing situations, preferences, relationships, work, projects). NOT something the philosopher said. NOT advice given.
- Persistent — would still be true a month from now, not a temporary mood.
- One line, ≤160 characters.
- Specific. "I'm working on a wine app called sommNI" is good. "I sometimes feel stressed" is not.

OUTPUT FORMAT — JSON only, no other text:
{ "memories": ["fact one", "fact two"] }

If nothing memorable was shared, return { "memories": [] }. PADDING IS WORSE THAN NOTHING.${existingBlock}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 280,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `TRANSCRIPT:\n\n${transcript}` },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/extract-memory] OpenAI error:', err);
      return res.status(200).json({ memories: [] });
    }
    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = { memories: [] }; }
    const memories = Array.isArray(parsed.memories)
      ? parsed.memories
          .filter(m => typeof m === 'string')
          .map(m => m.trim())
          .filter(Boolean)
          .slice(0, 3)
          .map(m => m.slice(0, 200))
      : [];
    return res.status(200).json({ memories });
  } catch (err) {
    console.error('[/api/extract-memory] error:', err);
    return res.status(200).json({ memories: [] });
  }
}
