/** Exact corpus identity: never reuse another philosopher's recording. */
export const quoteAudioKey = (philId, text) => `${philId}\n${text.normalize('NFC').trim()}`;
export function quoteAudioPath(catalog, philId, text) {
  if (catalog?.version !== 1 || catalog?.language !== 'en' || catalog?.provider !== 'elevenlabs') return null;
  const path = catalog.entries?.[quoteAudioKey(philId, text)];
  return typeof path === 'string' && /^v1\/en\/[a-z_]+\/[a-f0-9]{64}\.mp3$/.test(path)
    && path.split('/')[2] === philId ? path : null;
}
