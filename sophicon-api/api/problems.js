// ═══════════════════════════════════════════════════════════════════
// /api/problems
// Extract recurring problem themes from a journal of soPHICON Speaks
// conversations. Client sends the journal array; we ask GPT-4o to
// cluster them into 3–7 named "problems" the user keeps returning to
// + which philosophers have weighed in on each.
// ═══════════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { journal } = req.body;
    if (!Array.isArray(journal) || journal.length === 0) {
      return res.status(200).json({ problems: [] });
    }

    // Compact the journal for the prompt — just user turns + who heard them.
    const compact = journal.flatMap(session =>
      session.exchanges
        .filter(m => m.role === 'user')
        .map(m => ({
          date: session.date,
          phil: session.philName,
          mood: m.userMood || 'neutral',
          text: m.content.slice(0, 300),
        }))
    );

    const system = `You analyze a user's voice-journal conversations with different philosopher personas.
Cluster the user's utterances into 3–7 recurring PROBLEM THEMES — real things the user is working through (e.g. "anxiety about career direction", "tension with my partner", "grief over losing a parent"). Be specific and human, not generic.
For each theme return:
  title (5–8 words, concrete, lowercase except proper nouns)
  summary (1 sentence of what the user is wrestling with)
  firstSeen (YYYY-MM-DD, earliest date this theme appears)
  philosophers (array of philosopher names who have weighed in)
  exchangeCount (integer — how many user turns are in this cluster)
  moods (array of up to 3 distinct userMood values observed in this cluster)

Return ONLY a JSON object shaped { "problems": [ ... ] }. No prose.`;

    const user = `Here is the compacted journal:\n\n${JSON.stringify(compact).slice(0, 18000)}`;

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
        max_tokens: 1200,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI /problems error:', err);
      return res.status(500).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.error('[problems] bad JSON from model:', raw.slice(0, 200));
      return res.status(500).json({ error: 'Bad model output' });
    }

    return res.status(200).json({ problems: parsed.problems || [] });
  } catch (err) {
    console.error('/problems error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
