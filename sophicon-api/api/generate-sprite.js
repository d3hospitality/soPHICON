import { createClient } from '@supabase/supabase-js';
import { identify } from './_auth.js';

/**
 * POST /api/generate-sprite  — the $3 custom profile sprite render.
 *
 * Body: { refs: [url1, url2, url3, url4] }  (2–4 public reference image URLs,
 *        e.g. Supabase Storage public URLs the client uploaded first)
 * Auth: Bearer (Supabase JWT or glasses JWT) → resolves the user.
 *
 * Flow: consume one render credit (consume_sprite_gen RPC — each $3 grants 2,
 * an initial render + one free retry) → call gpt-image-1 /images/edits with
 * the enkiRIDION house style + the references → save the PRIOR sprite to
 * previous_sprite_path (a retry never destroys what you had) → upload the new
 * PNG to the `sprites` bucket → set profiles.sprite_path / status / source.
 *
 * Requires env: OPENAI_IMAGE_KEY (the gpt-image-1 key — separate from the
 * text key), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

// The enkiRIDION portrait house style — ported verbatim-in-spirit from the
// Sprite Maker (Phase 2) so custom sprites read as the same character system.
const STYLE_PROMPT = `Generate a single wise-NPC character portrait for a philosophical RPG, in this EXACT house style:
- Painterly pixel-art hybrid: visible brushstrokes but crisp edges, GBA-era retro game rendering
- Rich but limited, slightly desaturated color palette like GBA hardware
- Clean solid black background — NO decorations, borders, frames, or text
- Square image, face centered at 60–70% of the canvas, head-and-shoulders crop
- LIGHTING: a single key light from the UPPER LEFT at ~45°. Soft shadow on the right side of the face and under the chin; warm highlight on the left forehead/cheekbone; subtle rim light on the right shoulder. This lighting is identical to every other portrait in the system.
- Stylized and simplified — a VIDEO GAME CHARACTER, not a photoreal person
- Calm, composed, gently contemplative resting expression
- NO text, NO labels, NO names anywhere

Render the PERSON shown in the reference images as such a portrait: keep their recognizable identity — face shape, hair, skin tone, distinguishing features — but restyle them fully into this painterly GBA pixel-art house style with the lighting and framing above.`;

let _admin = null;
function admin() {
  if (!_admin) {
    _admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
  }
  return _admin;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.OPENAI_IMAGE_KEY) {
    return res.status(500).json({ error: 'image_generation_unconfigured' });
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'server_misconfigured' });
  }

  const id = await identify(req);
  if (!id?.userId) return res.status(401).json({ error: 'auth_required' });

  const refs = Array.isArray(req.body?.refs) ? req.body.refs.filter(u => typeof u === 'string') : [];
  if (refs.length < 2) return res.status(400).json({ error: 'need_references', min: 2, max: 4 });

  // 1) Consume a render credit atomically. No credit → nothing generated.
  const { data: ok, error: creditErr } = await admin().rpc('consume_sprite_gen', { p_user_id: id.userId });
  if (creditErr) {
    console.error('[generate-sprite] credit rpc', creditErr);
    return res.status(500).json({ error: 'credit_check_failed' });
  }
  if (!ok) return res.status(402).json({ error: 'no_render_credits', buy: 'https://enkiridion.com/profile' });

  try {
    // 2) Fetch the reference images and build the multipart edits request.
    const form = new FormData();
    form.append('model', 'gpt-image-1');
    form.append('prompt', STYLE_PROMPT);
    form.append('n', '1');
    form.append('size', '1024x1024');
    form.append('quality', 'high');

    let attached = 0;
    for (const url of refs.slice(0, 4)) {
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const type = r.headers.get('content-type') || 'image/png';
        if (/gif/i.test(type)) continue; // edits endpoint: jpeg/png/webp only
        const buf = Buffer.from(await r.arrayBuffer());
        form.append('image[]', new Blob([buf], { type }), `ref${attached}.png`);
        attached++;
      } catch { /* skip a bad ref */ }
    }
    if (attached === 0) {
      // Refund the credit we consumed — we never reached OpenAI.
      await admin().from('profiles')
        .update({ sprite_gens_remaining: (await currentGens(id.userId)) + 1 })
        .eq('id', id.userId);
      return res.status(400).json({ error: 'refs_unreadable' });
    }

    // 3) Generate.
    const oa = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_IMAGE_KEY}` },
      body: form,
    });
    if (!oa.ok) {
      const body = await oa.text().catch(() => '');
      console.error('[generate-sprite] openai', oa.status, body.slice(0, 200));
      // Give the credit back on an upstream failure.
      await admin().from('profiles')
        .update({ sprite_gens_remaining: (await currentGens(id.userId)) + 1 })
        .eq('id', id.userId);
      return res.status(502).json({ error: 'generation_failed' });
    }
    const data = await oa.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      await admin().from('profiles')
        .update({ sprite_gens_remaining: (await currentGens(id.userId)) + 1 })
        .eq('id', id.userId);
      return res.status(502).json({ error: 'no_image_returned' });
    }

    // 4) Save the prior sprite, then upload the new one to the `sprites` bucket.
    const { data: prof } = await admin().from('profiles')
      .select('sprite_path').eq('id', id.userId).single();
    const prior = prof?.sprite_path || null;

    const path = `custom/${id.userId}.png`;
    const bytes = Buffer.from(b64, 'base64');
    const { error: upErr } = await admin().storage.from('sprites')
      .upload(path, bytes, { contentType: 'image/png', upsert: true });
    if (upErr) {
      console.error('[generate-sprite] upload', upErr);
      return res.status(500).json({ error: 'store_failed' });
    }
    const { data: pub } = admin().storage.from('sprites').getPublicUrl(path);
    // Cache-bust so the UI shows the new render immediately.
    const spriteUrl = `${pub.publicUrl}?v=${Date.now()}`;

    await admin().from('profiles').update({
      previous_sprite_path: prior,
      sprite_path: spriteUrl,
      sprite_status: 'ready',
      sprite_source: 'generated',
      updated_at: new Date().toISOString(),
    }).eq('id', id.userId);

    return res.status(200).json({ spritePath: spriteUrl, previous: prior });
  } catch (err) {
    console.error('[generate-sprite]', err);
    // Best-effort credit refund on unexpected error.
    try {
      await admin().from('profiles')
        .update({ sprite_gens_remaining: (await currentGens(id.userId)) + 1 })
        .eq('id', id.userId);
    } catch { /* noop */ }
    return res.status(500).json({ error: 'generation_error' });
  }
}

async function currentGens(userId) {
  const { data } = await admin().from('profiles')
    .select('sprite_gens_remaining').eq('id', userId).single();
  return data?.sprite_gens_remaining || 0;
}
