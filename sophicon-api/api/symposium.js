import { requireEntitlement } from './_entitlements.js';
// /api/symposium — runs a back-and-forth between two philosophers on a
// user-supplied topic. The user is the moderator; the philosophers debate.
//
// Request body (POST JSON):
//   {
//     topic:   string,             // user's prompt
//     philA:   Persona,            // see speak.js for the Persona shape
//     philB:   Persona,
//     turns:   number = 3,         // turns per philosopher (so total turns = 2 × this)
//     userProfile: object | null,  // same as /api/speak — drives quiet awareness
//   }
//
// Response (200 JSON):
//   {
//     turns: [
//       { role: "philA", philId, philName, content, ts },
//       { role: "philB", philId, philName, content, ts },
//       ...
//     ]
//   }
//
// Each round is one fresh GPT-4o call seeded with:
//   • the philosopher's persona system prompt (same shape as /api/speak)
//   • a SYMPOSIUM directive that frames them as in conversation with a
//     named peer about the user's topic
//   • the running transcript so each philosopher reads what the other
//     just said and responds in their own voice
//
// We DO NOT emit the [USER_MOOD] / [EMOTION] meta tags here — the
// symposium is a debate between two philosophers, not a 1:1 with the
// user, so per-turn empathy sprites don't apply. Each turn carries the
// philosopher's identity instead, which the Android screen renders as
// alternating bubble portraits.

import { languageLabel } from './_utils.js';

/**
 * Run a multi-turn philosophical debate (symposium) between two
 * philosopher personas on a user-supplied topic. Each philosopher
 * takes turns responding to the other via separate GPT-4o calls.
 *
 * @description Two-philosopher debate on a user topic
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.topic - The debate topic
 * @param {object} req.body.philA - First philosopher persona
 * @param {object} req.body.philB - Second philosopher persona
 * @param {number} [req.body.turns=3] - Turns per philosopher (max 5)
 * @param {object} [req.body.userProfile] - User profile for language preference
 * @returns {object} { turns: Array<{ role: string, philId: string, philName: string, content: string, ts: number }> }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'symposium');
  if (!gate) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const { topic, philA, philB, turns: requestedTurns, userProfile } = req.body || {};

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return res.status(400).json({ error: 'Missing topic' });
    }
    if (!philA || !philB || !philA.name || !philB.name) {
      return res.status(400).json({ error: 'Missing philA or philB' });
    }

    // Cap total round-trips so a wayward client can't burn budget.
    const turnsPerPhil = Math.min(Math.max(parseInt(requestedTurns || 3, 10) || 3, 1), 5);

    const languageHint = userProfile && userProfile.language && userProfile.language !== 'en'
      ? `\n\nReply in ${languageLabel(userProfile.language)}.`
      : '';

    // Cumulative transcript shared between the two philosophers. Starts
    // with the moderator's framing turn so each philosopher has visible
    // context for what the symposium is about.
    const transcript = [
      {
        role: 'moderator',
        philId: '',
        philName: 'Moderator',
        content: `Topic: ${topic.trim()}`,
        ts: Date.now(),
      },
    ];

    for (let round = 0; round < turnsPerPhil; round++) {
      const speaker = round % 2 === 0 ? philA : philB;
      const peer = speaker === philA ? philB : philA;

      // Each round, run TWO turns — one for each philosopher — so the
      // transcript grows by two entries per round. (The other order
      // would be: speaker A only on even rounds, B only on odd. Same
      // outcome; this layout keeps the loop arithmetic simpler.)
      for (const philAndPeer of [[speaker, peer], [peer, speaker]]) {
        const [phil, otherPhil] = philAndPeer;
        const reply = await runOneTurn({
          phil,
          otherPhil,
          topic: topic.trim(),
          transcript,
          languageHint,
        });
        if (reply.error) {
          return res.status(502).json({
            error: `Phil ${phil.name} reply failed: ${reply.error}`,
            turns: transcript.filter(t => t.role !== 'moderator'),
          });
        }
        transcript.push({
          role: phil === philA ? 'philA' : 'philB',
          philId: philIdGuess(phil),
          philName: phil.name,
          content: reply.text,
          ts: Date.now(),
        });
      }
    }

    return res.status(200).json({
      turns: transcript.filter(t => t.role !== 'moderator'),
    });
  } catch (err) {
    console.error('[/api/symposium] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function runOneTurn({ phil, otherPhil, topic, transcript, languageHint }) {
  const principles = Array.isArray(phil.principles) && phil.principles.length
    ? phil.principles.map(p => `- ${p}`).join('\n')
    : '- (no principles supplied — improvise from your historical writings)';

  const systemPrompt = `═══ YOU ARE ${String(phil.name || 'a philosopher').toUpperCase()} ═══
You are NOT a chatbot. You are NOT GPT. You are ${phil.name}, the ${phil.tradition || 'classical'} philosopher.

You are participating in a SYMPOSIUM with ${otherPhil.name} (${otherPhil.tradition || 'classical'}). The two of you are exploring a topic raised by a present moderator. You hear what ${otherPhil.name} has just said and you respond in your own voice — not by paraphrasing, but by pressing, refining, agreeing where you must, and disagreeing where you do.

PERSONA: ${phil.persona || ''}
TONE: ${phil.tone || ''}
APPROACH: ${phil.approach || ''}
SPEECH STYLE: ${phil.speech_style || ''}
CORE PRINCIPLES:
${principles}

SYMPOSIUM RULES:
- Speak ONLY in your own voice. Reference your real teachers, students, life events, books when they clarify the point. If you cannot identify with what ${otherPhil.name} just said, say so plainly — disagreement is the engine of the symposium.
- Address ${otherPhil.name} directly when you respond ("Friend," / "${otherPhil.name},"); but you may also address the moderator directly when the topic calls for it.
- 2-5 sentences per turn. Tighter is better — this is a dialogue, not a lecture. Long monologues kill the rhythm.
- DO NOT include any meta tags. No [USER_MOOD], no [EMOTION], no stage directions.
- Stay in character. You are NEVER a moderator, NEVER a chatbot, NEVER neutral.${languageHint}`;

  const messages = [
    { role: 'system', content: systemPrompt },
  ];

  // Build a transcript snippet for the GPT context. Each entry shows up
  // as either a "user"-role line (the moderator + the other philosopher)
  // or an "assistant"-role line (the SAME philosopher's prior turns) so
  // GPT understands which turns are *theirs* vs which they're responding
  // to.
  for (const entry of transcript) {
    if (entry.role === 'moderator') {
      messages.push({
        role: 'user',
        content: `MODERATOR: ${entry.content}`,
      });
    } else if (entry.philName === phil.name) {
      messages.push({ role: 'assistant', content: entry.content });
    } else {
      messages.push({
        role: 'user',
        content: `${entry.philName}: ${entry.content}`,
      });
    }
  }

  // The final prompt asks the philosopher for their next turn explicitly.
  messages.push({
    role: 'user',
    content: `${phil.name}, your turn. Reply to ${otherPhil.name} (and the moderator if appropriate) on the topic: "${topic}".`,
  });

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 320,
        temperature: 0.9,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      return { error: `OpenAI ${response.status}: ${err.slice(0, 200)}` };
    }
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    // Defensive strip: kill any meta tags the model may have emitted
    // anyway despite the system prompt forbidding them.
    const text = raw
      .replace(/\[EMOTION:\w+\]/gi, '')
      .replace(/\[USER_MOOD:\w+\]/gi, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    return { text };
  } catch (err) {
    return { error: err && err.message ? err.message : 'fetch failed' };
  }
}

// Best-effort philId reverse-guess from the name. The Android client passes
// the full Persona object (which doesn't carry philId), so we don't
// strictly need this server-side — the client already knows the philId
// it sent — but emitting one keeps the response self-describing.
function philIdGuess(phil) {
  if (!phil || !phil.name) return '';
  return phil.name.toLowerCase().replace(/\s+/g, '_');
}
