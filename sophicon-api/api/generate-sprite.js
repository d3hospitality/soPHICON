import { createClient } from '@supabase/supabase-js';
import { identify } from './_auth.js';
import { kv } from './_store.js';

/** Free account portrait rendering, with per-minute abuse protection.
 * References must be uploaded to the caller's own Supabase sprites path.
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

  if (refs.length > 4 || refs.some(value => {
    try { const u = new URL(value); return u.origin !== new URL(process.env.SUPABASE_URL).origin || !u.pathname.startsWith(`/storage/v1/object/public/sprites/refs/${id.userId}/`) || u.username || u.password; }
    catch { return true; }
  })) return res.status(400).json({ error: 'Use 2–4 photos uploaded to your account.' });
  try {
    const key = `aph:sprite:${id.userId}:${Math.floor(Date.now()/60000)}`;
    const n = await kv.incr(key); if (n === 1) await kv.expire(key, 120);
    if (n > 2) return res.status(429).json({ error: 'Please wait a minute before rendering again.' });
  } catch { return res.status(503).json({ error: 'Rendering is temporarily unavailable.' }); }

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
        const r = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!r.ok) continue;
        const type = r.headers.get('content-type') || 'image/png';
        if (!/^image\/(png|jpeg|webp)(;|$)/i.test(type)) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 8_000_000) continue;
        form.append('image[]', new Blob([buf], { type }), `ref${attached}.png`);
        attached++;
      } catch { /* skip a bad ref */ }
    }
    if (attached === 0) {
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
      return res.status(502).json({ error: 'generation_failed' });
    }
    const data = await oa.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
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
    return res.status(500).json({ error: 'generation_error' });
  }
}
