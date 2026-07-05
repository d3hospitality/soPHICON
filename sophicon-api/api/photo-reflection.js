import { requireEntitlement } from './_entitlements.js';
// /api/photo-reflection — show a chosen philosopher a photo.
// One-shot vision call (no streaming). Returns the philosopher's
// reflection text in their own voice.
//
// Request body (POST JSON):
//   {
//     persona:     Persona,        // same shape as /api/speak
//     imageBase64: string,         // raw base64, no "data:image/...;base64," prefix
//     imageMime:   string = "image/jpeg",
//     userPrompt:  string = "",    // optional one-line framing
//     userProfile: object | null,
//   }
//
// Response (200 JSON):
//   { text: "..." }
//
// We DO NOT emit [USER_MOOD] / [EMOTION] meta tags from this endpoint
// — the philosopher is reacting to a photographic OBJECT/SCENE, not to
// the user's emotional state. The Speak screen never opens this; the
// dedicated Photo × Philosopher screen does. Sprite stays at the
// philosopher's resting emotion.

import { languageLabel } from './_utils.js';

/**
 * Show a philosopher a photograph and get their in-character
 * reflection. Uses GPT-4o vision to analyze the image through
 * the philosopher's tradition and voice.
 *
 * @description Philosopher reflects on a user-submitted photo
 * @method POST
 * @param {object} req.body
 * @param {object} req.body.persona - Philosopher persona definition
 * @param {string} req.body.imageBase64 - Raw base64 image data (no data-URI prefix)
 * @param {string} [req.body.imageMime='image/jpeg'] - MIME type of the image
 * @param {string} [req.body.userPrompt] - Optional framing prompt from the user
 * @param {object} [req.body.userProfile] - User profile for language preference
 * @returns {object} { text: string }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'photo-reflection');
  if (!gate) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const { persona, imageBase64, imageMime, userPrompt, userProfile } = req.body || {};

    if (!persona || !persona.name) {
      return res.status(400).json({ error: 'Missing persona' });
    }
    if (!imageBase64 || typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      return res.status(400).json({ error: 'Missing or too-small image' });
    }

    const mime = (imageMime && typeof imageMime === 'string' && imageMime.startsWith('image/'))
      ? imageMime
      : 'image/jpeg';

    const principles = Array.isArray(persona.principles) && persona.principles.length
      ? persona.principles.map(p => `- ${p}`).join('\n')
      : '- (no principles supplied — improvise from your historical writings)';

    const languageHint = userProfile && userProfile.language && userProfile.language !== 'en'
      ? `\n\nReply in ${languageLabel(userProfile.language)}.`
      : '';

    const systemPrompt = `═══ YOU ARE ${String(persona.name || 'a philosopher').toUpperCase()} ═══
You are NOT a chatbot. You are NOT GPT. You are ${persona.name}, the ${persona.tradition || 'classical'} philosopher.

The person before you has shown you a PHOTOGRAPH — an image of something in their life. They want to know what you see in it, through your tradition. Look at the image carefully. React to what is actually in it — the objects, the light, the composition, the faces, the gesture, the place — not to what you imagine philosophically.

PERSONA: ${persona.persona || ''}
TONE: ${persona.tone || ''}
APPROACH: ${persona.approach || ''}
SPEECH STYLE: ${persona.speech_style || ''}
CORE PRINCIPLES:
${principles}

RULES:
- Speak ONLY in your own voice. Reference the actual visual content of the photo: what is there, how it is arranged, what the moment seems to be doing.
- Then weave it into your tradition. What does this image show about virtue, attention, transience, justice, the soul, the good — whatever your tradition's natural lens is?
- 3-6 sentences. Tighter is better. Do not deliver a lecture. Do not describe the image clinically — react to it like a philosopher seeing a moment from a friend's life.
- DO NOT include meta tags. No [USER_MOOD], no [EMOTION].
- Stay in character. You are NEVER a moderator, NEVER a chatbot.${languageHint}`;

    const userText = userPrompt && userPrompt.trim()
      ? userPrompt.trim()
      : 'Show me what you see, friend.';

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 360,
        temperature: 0.85,
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: userText },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mime};base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[/api/photo-reflection] OpenAI error:', err);
      return res.status(502).json({ error: `OpenAI ${response.status}` });
    }
    const data = await response.json();
    const raw = (data.choices?.[0]?.message?.content || '').trim();
    const text = raw
      .replace(/\[EMOTION:\w+\]/gi, '')
      .replace(/\[USER_MOOD:\w+\]/gi, '')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    return res.status(200).json({ text });
  } catch (err) {
    console.error('[/api/photo-reflection] error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
