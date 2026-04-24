// ═══════════════════════════════════════════════════════════════════
// /api/actions
// Given one or more conversations, return 3–5 concrete TODOs the user
// can take based on what the philosopher(s) said. The philosopher's
// voice/frame is preserved in the action item — e.g. if Seneca said
// "write a letter", the TODO keeps that voice, doesn't flatten to
// generic self-help.
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { conversations, scope } = req.body;
    if (!Array.isArray(conversations) || conversations.length === 0) {
      return res.status(200).json({ actions: [] });
    }

    // Compact: keep user turns + their matched philosopher replies
    const compact = conversations.flatMap(session =>
      session.exchanges.map(m => ({
        role: m.role,
        phil: session.philName,
        tradition: session.tradition,
        mood: m.userMood,
        text: m.content.slice(0, 400),
      }))
    );

    const scopeLabel = scope === 'week'
      ? "conversations from the past 7 days"
      : scope === 'session'
        ? "this specific conversation"
        : "recent conversations";

    const system = `You turn ${scopeLabel} with philosopher personas into a short list of CONCRETE action items the user can take in the next 7 days.

Rules:
- Exactly 3 to 5 items. Quality over quantity. Skip the session entirely if nothing actionable came up.
- Each item must be specific, small, and doable this week. NOT "practice gratitude" — YES "write down three things you're grateful for before bed tonight".
- Preserve the philosopher's voice and framing. If Marcus Aurelius said "begin before dawn," the action item keeps that ancestor energy. Don't flatten to generic self-help.
- Credit which philosopher inspired each action (by name + tradition).
- If multiple philosophers echoed the same theme, cite them together ("Seneca + Epictetus").

Return ONLY JSON: { "actions": [ { "title": "...", "detail": "...", "source": "Philosopher Name (Tradition)", "theme": "short tag" } ] }`;

    const user = `Conversations:\n\n${JSON.stringify(compact).slice(0, 18000)}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
        max_tokens: 900,
        temperature: 0.6,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI /actions error:', err);
      return res.status(500).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.error('[actions] bad JSON from model:', raw.slice(0, 200));
      return res.status(500).json({ error: 'Bad model output' });
    }

    return res.status(200).json({ actions: parsed.actions || [] });
  } catch (err) {
    console.error('/actions error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
