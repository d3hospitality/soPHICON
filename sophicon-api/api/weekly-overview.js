// ═══════════════════════════════════════════════════════════════════
// /api/weekly-overview
// Synthesizes a structured weekly action plan from the user's Speak
// journal: clusters recurring problems, tags each with a life-area
// category (Work/Love/Money/Health/Mind/Spirit/Other), proposes 3-5
// action steps per problem distributed across Eisenhower quadrants,
// and tags each action with emotion themes + topical tags so the
// client can match quotes from the existing 2,801-quote corpus.
//
// Optional `rolledOver` array preserves prior-week problems verbatim
// (same id, title, actions) so they carry into the new week without
// regeneration.
// ═══════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { journal, rolledOver, weekKey } = req.body;
    if (!Array.isArray(journal)) {
      return res.status(400).json({ error: 'journal must be an array' });
    }

    // Compact journal: user turns only, plus which philosopher heard them.
    const compact = journal.flatMap(session =>
      session.exchanges
        .filter(m => m.role === 'user')
        .map(m => ({
          date: session.date,
          phil: session.philName,
          tradition: session.tradition,
          mood: m.userMood || 'neutral',
          text: m.content.slice(0, 320),
        }))
    );

    // If there's literally nothing to analyze and no rollover, return empty
    if (compact.length === 0 && (!Array.isArray(rolledOver) || rolledOver.length === 0)) {
      return res.status(200).json({ weekKey: weekKey || isoWeekKey(new Date()), problems: [] });
    }

    const rolledTitles = Array.isArray(rolledOver)
      ? rolledOver.map(p => `"${p.title}"`).join(', ')
      : '';

    const system = `You build a weekly philosophical action plan for the user from their Speak conversations.

Extract 3 to 7 PROBLEMS the user is actually working through. For each, produce a small set of concrete action steps distributed across Eisenhower quadrants.

Per problem, return EXACTLY these fields:
  id           — stable kebab-case derived from title (e.g. "career-direction-uncertainty")
  title        — 5-8 words, lowercase except proper nouns
  summary      — one sentence, what the user is actually wrestling with
  category     — exactly one of: Work, Love, Money, Health, Mind, Spirit, Other
  philosophers — array of philosopher names who weighed in
  exchangeCount — integer, user turns related to this problem
  firstSeen    — YYYY-MM-DD, earliest date this problem appears
  actions      — 3 to 5 action items

Per action:
  id        — stable kebab-case
  title     — imperative, 5-10 words ("write the difficult email tonight")
  detail    — 1-2 sentences combining the philosopher's WHY + concrete HOW
  source    — "Philosopher Name (Tradition)"
  quadrant  — one of Q1 Q2 Q3 Q4 where:
                Q1 = Urgent + Important   (do this week)
                Q2 = Important, not urgent (schedule deliberately)
                Q3 = Urgent, not important (delegate, batch, automate)
                Q4 = Not urgent, not important (consider dropping)
  themes    — 1-3 emotion tags (used to surface matching quotes), choose from:
                [acceptance authority awe compassion contemplation conviction defiance
                 devotion doubt grief honor joy liberation neutral peace rage resolve
                 serenity sorrow teaching transcendence urgency wonder]
  tagHints  — 1-3 lowercase_underscore tags hinting at topic ("beginning", "time", "fear", "letting_go", "persistence")

Hard rules:
- Categories must be EXACTLY from the fixed list above; if genuinely none fit, use "Other".
- Distribute actions across quadrants — do NOT lump everything in Q1. Most weeks need at least one Q2 (the actually-important-but-easy-to-postpone one).
- Preserve each philosopher's voice in the action detail. If Marcus said "begin before dawn", keep that flavor — don't flatten to generic productivity advice.
- Skip the problem entirely if nothing actionable came up.
${rolledTitles ? `- The following problems are CARRIED OVER from last week (same ids, do NOT regenerate them, the client adds them back): ${rolledTitles}. Focus on NEW problems from this week.` : ''}

Return ONLY this JSON shape (no prose, no markdown):
{ "problems": [ { ...as above } ] }`;

    const user = `Conversations from this week:\n\n${JSON.stringify(compact).slice(0, 18000)}`;

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
        max_tokens: 2400,
        temperature: 0.5,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI /weekly-overview error:', err);
      return res.status(500).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.error('[weekly-overview] bad JSON:', raw.slice(0, 200));
      return res.status(500).json({ error: 'Bad model output' });
    }

    const newProblems = (parsed.problems || []).map(p => ({
      ...p,
      status: 'open',
      createdAt: Date.now(),
      actions: (p.actions || []).map(a => ({ ...a, done: false })),
    }));

    // Merge in rolled-over problems verbatim (preserve id, status preserved as 'open' or 'rolled-over')
    const rolled = Array.isArray(rolledOver)
      ? rolledOver.filter(p => p && p.id).map(p => ({
          ...p,
          status: p.status === 'addressed' ? 'addressed' : 'rolled-over',
        }))
      : [];

    // Dedupe by id — rolled wins (preserves user's done-checkmarks)
    const byId = new Map();
    for (const p of newProblems) byId.set(p.id, p);
    for (const p of rolled) byId.set(p.id, p);
    const problems = [...byId.values()];

    return res.status(200).json({
      weekKey: weekKey || isoWeekKey(new Date()),
      problems,
    });
  } catch (err) {
    console.error('/weekly-overview error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ── ISO week-of-year (Mon as week start) ──
function isoWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Set to nearest Thursday (current date + 4 - current day number)
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}
