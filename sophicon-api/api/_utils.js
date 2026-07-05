// ═══════════════════════════════════════════════════════════════════
// api/_utils.js — shared helpers used across multiple endpoints.
//
// Vercel treats files prefixed with _ as non-routable, so this module
// is importable but never exposed as an HTTP endpoint.
// ═══════════════════════════════════════════════════════════════════

/**
 * Map an ISO 639-1 language code to a human-readable label.
 * Returns null for English or missing codes so callers can skip the
 * language directive. Falls back to the raw code for unknown languages.
 *
 * @param {string} code - Two-letter ISO 639-1 language code (e.g. 'en', 'es').
 * @returns {string|null} The human-readable language name, null for English/missing,
 *                        or the code itself if unknown.
 */
export function languageLabel(code) {
  if (!code || code === 'en') return null;
  const map = {
    es: 'Spanish', fr: 'French', de: 'German', it: 'Italian',
    pt: 'Portuguese', nl: 'Dutch', ja: 'Japanese', ko: 'Korean',
    zh: 'Chinese', hi: 'Hindi', ar: 'Arabic', ru: 'Russian',
  };
  return map[code] || code;
}
