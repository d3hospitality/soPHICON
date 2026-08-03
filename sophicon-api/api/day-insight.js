import crypto from 'node:crypto';
import { kv } from '@vercel/kv';
import { requireEntitlement } from './_entitlements.js';
// ═══════════════════════════════════════════════════════════════════
// /api/day-insight
// Given everything the user logged on one day — rituals, philosopher
// conversations, intentions + reflections, habit check-ins — return a
// content-aware diary paragraph (what the day actually was) plus 2–4
// pieces of active advice, each pre-assigned to an Eisenhower quadrant
// and a life domain so a client can insert it into the Weekly plan
// with one tap. iOS Journal calendar + Watch journal both call this.
// ═══════════════════════════════════════════════════════════════════

/**
 * Distill one day's logs into a diary entry + quadrant-ready advice.
 *
 * @description Content-aware daily diary + Eisenhower advice
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.date - Day key, yyyy-MM-dd
 * @param {string} [req.body.language='en'] - ISO 639-1 code for the diary/advice language
 * @param {Array<{kind: string, text: string, mood?: string}>} [req.body.rituals]
 * @param {Array<{philName: string, tradition: string, exchanges: Array<{role: string, content: string}>}>} [req.body.conversations]
 * @param {Array<{title: string, completed: boolean, result?: string, lesson?: string, nextAction?: string, domain?: string}>} [req.body.intentions]
 * @param {Array<{name: string, status: string}>} [req.body.habits]
 * @returns {object} { date, diary, advice: Array<{ id, title, detail, source, quadrant, domain, theme }> }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'day-insight');
  if (!gate) return;
  // Private cost cap — this is a full gpt-4o completion per call, so an
  // uncapped anonymous loop is an open wallet. Same pattern as /api/tts.
  if (await overDailyLimit(req, gate)) {
    return res.status(429).json({ error: 'daily_limit', feature: 'day-insight', limit: INSIGHTS_PER_DAY });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const { date, language, rituals, conversations, intentions, habits } = req.body || {};
    // Strict shape: also the fence that keeps `date` out of the token budget
    // (it is interpolated into the prompt outside the size-capped JSON).
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be yyyy-MM-dd' });
    }

    const compactRituals = (Array.isArray(rituals) ? rituals : [])
      .filter(r => r && typeof r.text === 'string' && r.text.trim())
      .map(r => ({ kind: r.kind, mood: r.mood || undefined, text: r.text.slice(0, 600) }));
    const compactConvos = (Array.isArray(conversations) ? conversations : [])
      .filter(s => s && Array.isArray(s.exchanges))
      .map(s => ({
        phil: s.philName,
        tradition: s.tradition,
        exchanges: s.exchanges.map(m => ({ role: m.role, text: String(m.content || '').slice(0, 320) })),
      }));
    const compactIntentions = (Array.isArray(intentions) ? intentions : [])
      .filter(i => i && typeof i.title === 'string')
      .map(i => ({
        title: i.title.slice(0, 160),
        completed: !!i.completed,
        result: i.result ? String(i.result).slice(0, 240) : undefined,
        lesson: i.lesson ? String(i.lesson).slice(0, 240) : undefined,
        nextAction: i.nextAction ? String(i.nextAction).slice(0, 160) : undefined,
        domain: i.domain || undefined,
      }));
    const compactHabits = (Array.isArray(habits) ? habits : [])
      .filter(h => h && typeof h.name === 'string')
      .map(h => ({ name: h.name.slice(0, 80), status: h.status }));

    // Nothing logged → nothing to distill. 200 so clients render a calm
    // empty state instead of an error.
    if (!compactRituals.length && !compactConvos.length && !compactIntentions.length && !compactHabits.length) {
      return res.status(200).json({ date, diary: '', advice: [] });
    }

    const lang = (typeof language === 'string' && /^[a-z]{2}$/.test(language)) ? language : 'en';

    const system = `You are the reflective voice of enkiRIDION, distilling ONE day of a seeker's logs into two things.

1. "diary" — a content-aware diary entry about THIS day, written to the user in the second person ("you"). 90–160 words, one or two flowing paragraphs, no bullet points, no headings. It must be grounded in what actually happened — name the real intentions, the real conversations, the real moods that appear in the data. Notice patterns (what they avoided, what gave them energy, tension between what they planned and what they did). Warm but honest; never saccharine; never invent events that are not in the data.

2. "advice" — 2 to 4 pieces of ACTIVE advice that turn the day's lessons into the user's Eisenhower weekly plan. Each item:
   - "id": stable kebab-case slug
   - "title": imperative, small, doable within a week (max ~10 words)
   - "detail": one sentence of why, rooted in the day's data
   - "source": where it came from — "Marcus Aurelius (Stoicism)" if from a conversation, "Your evening ritual", "Your reflection on <intention>", etc.
   - "quadrant": "Q1" (urgent+important: unblocks something pressing the user named), "Q2" (important, not urgent: growth/practice — most advice belongs here), "Q3" (urgent, not important: delegate/limit), or "Q4" (eliminate: a named distraction or drain to cut)
   - "domain": one of Work, Love, Money, Health, Mind, Spirit, Other
   - "theme": short lowercase tag
   Preserve the philosopher's framing when advice stems from a conversation — don't flatten to generic self-help.

Write BOTH the diary and every advice title/detail in the language with ISO code "${lang}".

Return ONLY JSON: { "diary": "...", "advice": [ { "id": "...", "title": "...", "detail": "...", "source": "...", "quadrant": "Q2", "domain": "Mind", "theme": "..." } ] }`;

    const logsJson = JSON.stringify({
      rituals: compactRituals,
      conversations: compactConvos,
      intentions: compactIntentions,
      habits: compactHabits,
    });
    // Mark truncation so the model knows the tail is amputated instead of
    // silently reading malformed JSON as a complete day.
    const fencedLogs = logsJson.length > 15000
      ? logsJson.slice(0, 15000) + ' …[TRUNCATED — the day had more logs than fit here]'
      : logsJson;
    const user = `Date: ${date}\n\nLogs:\n${fencedLogs}`;

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
          { role: 'user', content: user },
        ],
        max_tokens: 1100,
        temperature: 0.65,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI /day-insight error:', err);
      return res.status(500).json({ error: 'OpenAI request failed' });
    }

    const data = await response.json();
    const raw = data.choices[0].message.content.trim();
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch {
      console.error('[day-insight] bad JSON from model:', raw.slice(0, 200));
      return res.status(500).json({ error: 'Bad model output' });
    }

    const QUADRANTS = new Set(['Q1', 'Q2', 'Q3', 'Q4']);
    const DOMAINS = new Set(['Work', 'Love', 'Money', 'Health', 'Mind', 'Spirit', 'Other']);
    const seenIds = new Set();
    const advice = (Array.isArray(parsed.advice) ? parsed.advice : [])
      .filter(a => a && a.title)
      .slice(0, 4)
      .map((a, i) => {
        // Coerce + uniquify: Codable clients need a String id, and SwiftUI's
        // ForEach needs it unique even when the model repeats a slug.
        let id = String(a.id || `advice-${date}-${i}`).slice(0, 80);
        if (seenIds.has(id)) id = `${id}-${i}`;
        seenIds.add(id);
        return {
          id,
          title: String(a.title).slice(0, 120),
          detail: String(a.detail || '').slice(0, 300),
          source: String(a.source || '').slice(0, 120),
          quadrant: QUADRANTS.has(a.quadrant) ? a.quadrant : 'Q2',
          domain: DOMAINS.has(a.domain) ? a.domain : 'Other',
          theme: String(a.theme || '').slice(0, 40),
        };
      });

    return res.status(200).json({ date, diary: String(parsed.diary || ''), advice });
  } catch (err) {
    console.error('Day-insight error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// ─── Private daily cap (mirrors api/tts.js) ─────────────────────────

const INSIGHTS_PER_DAY = 40;
const KV_BUDGET_MS = 400;
function kvFast(op, fallback) {
  return Promise.race([
    Promise.resolve().then(op).catch(() => fallback),
    new Promise((resolve) => setTimeout(() => resolve(fallback), KV_BUDGET_MS)),
  ]);
}

async function overDailyLimit(req, gate) {
  const who = gate.userId
    || req.headers['x-device-id']
    || (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown');
  const day = new Date().toISOString().slice(0, 10);
  const hashed = crypto.createHash('sha256').update(String(who)).digest('hex').slice(0, 24);
  const key = `insight:rl:${hashed}:${day}`;
  const n = await kvFast(() => kv.incr(key), null);
  if (n === 1) await kvFast(() => kv.expire(key, 86400), null);
  return typeof n === 'number' && n > INSIGHTS_PER_DAY;
}
