// ═══════════════════════════════════════════════════════════════════
// api/_persona.js — server-owned persona lookup (SEC-03).
//
// Clients send which philosopher they want; the server decides what
// that philosopher's system prompt is. A client-supplied persona body
// is never used to build the prompt when a match is found here, so a
// caller cannot ship an arbitrary system prompt, or label a different
// prompt "Enki" to slip past the seeker gate.
// ═══════════════════════════════════════════════════════════════════

// _personas.js is gitignored: this repo is PUBLIC, so the prompts must not
// be committed here. It is generated locally and shipped with the Vercel
// deploy. If it is missing, lookups return null (hard mode → 400).
const PERSONAS = (await import('./_personas.js').catch(() => {
  console.error('[persona] _personas.js missing — server personas unavailable');
  return { default: {} };
})).default;

const norm = (s) => String(s || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

// id → id, and normalized display name → id ("Zeno of Citium" → zeno_of_citium)
const INDEX = new Map();
for (const [id, p] of Object.entries(PERSONAS)) {
  INDEX.set(norm(id), id);
  INDEX.set(norm(p.name), id);
  INDEX.set(norm(id).replace(/_/g, '-'), id);
}

/**
 * @param {string|{id?: string, key?: string, name?: string}} requested
 * @returns {{ id: string, persona: object } | null}
 */
export function resolvePersona(requested) {
  if (!requested) return null;
  const candidates = typeof requested === 'string'
    ? [requested]
    : [requested.id, requested.key, requested.name];
  for (const c of candidates) {
    if (!c) continue;
    const id = INDEX.get(norm(c)) || INDEX.get(norm(c).replace(/-/g, '_'));
    if (id) return { id, persona: PERSONAS[id] };
  }
  return null;
}

export const PERSONA_IDS = Object.keys(PERSONAS);
