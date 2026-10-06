import { requireEntitlement } from './_entitlements.js';
import { buildNextMovePrompt, buildNextMoveTranscript } from '../prompts/next-move.js';

// ═══════════════════════════════════════════════════════════════════
// /api/next-move — the end of a conversation becomes one next step.
//
// The client (glasses, phone) sends the session it just finished plus
// the person's active goals and open moves; it gets back at most one
// move, the goal it serves, and possibly a suggested new goal. Nothing
// is stored here: goals and moves live on the device and sync through
// /api/device-sync as `goal` / `path_move` rows.
//
// POST { philName, exchanges: [{role, content}], goals: [{id, title}],
//        openMoves: [string] }
//   → { move: string|null, goalId: string|null, suggestedGoal: string|null }
// ═══════════════════════════════════════════════════════════════════

const MAX_TURNS = 16;
const NONE = { move: null, goalId: null, suggestedGoal: null };

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const unquote = s => s.replace(/^["'“”]+|["'“”]+$/g, '').trim();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = req.body || {};
  const exchanges = (Array.isArray(body.exchanges) ? body.exchanges : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_TURNS)
    .map(m => ({ role: m.role, content: clean(m.content, 600) }));
  // Nothing the person said → nothing to act on. Answer before the gate
  // so an empty session never spends quota or a provider call.
  if (!exchanges.some(m => m.role === 'user' && m.content)) return res.status(200).json(NONE);

  const gate = await requireEntitlement(req, res, 'next-move');
  if (!gate) return;
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'Server configuration error: missing API key' });

  const philName = clean(body.philName, 60) || 'a philosopher';
  const goals = (Array.isArray(body.goals) ? body.goals : [])
    .map(g => ({ id: clean(g?.id, 64), title: clean(g?.title, 80) }))
    .filter(g => g.id && g.title)
    .slice(0, 3);
  const openMoves = (Array.isArray(body.openMoves) ? body.openMoves : [])
    .map(m => clean(m, 160)).filter(Boolean).slice(0, 10);

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: buildNextMovePrompt({ philName, goals, openMoves, today: new Date().toISOString().slice(0, 10) }) },
          { role: 'user', content: buildNextMoveTranscript(philName, exchanges) },
        ],
        max_tokens: 200,
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
    });
    if (!response.ok) {
      console.error('[next-move] OpenAI error', response.status);
      return res.status(502).json({ error: 'provider_failed' });
    }
    const data = await response.json();
    let parsed = {};
    try { parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}'); } catch { parsed = {}; }

    // The model's answer is a suggestion; every field is checked here.
    const move = unquote(clean(parsed.move, 140)) || null;
    if (!move) return res.status(200).json(NONE);
    const goalId = goals.some(g => g.id === parsed.goalId) ? parsed.goalId : null;
    let suggestedGoal = null;
    if (!goalId && goals.length < 3) {
      const s = unquote(clean(parsed.suggestedGoal, 60));
      if (s && !goals.some(g => g.title.toLowerCase() === s.toLowerCase())) suggestedGoal = s;
    }
    return res.status(200).json({ move, goalId, suggestedGoal });
  } catch (err) {
    console.error('[next-move]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
