# English quote audio for the Even companion

Status on October 21, 2026: implemented locally; not released. The production
`ELEVENLABS_API_KEY` pulled from `lingua-franca-api` was empty. No recordings
have been generated and no ElevenLabs credits were spent. Even Hub 1.16.0
remains submitted for review. The standalone website remains free; this new
feature is scoped to the Even companion repository only.

## Experience

In the Even app, open Quotes and tap **Enable audio** once. Each quote card has
**Hear English**, and the glasses contextual menus expose the same action for
browse, favorites, mindfulness and the daily card. Tap it again to stop. Audio
plays through the paired phone or earbuds; G2 has no speakers. Navigation,
microphone activation, backgrounding and exit stop playback. Listening pauses
quote auto-rotation and the mindfulness display timeout so the quote stays put.

Narration uses synthetic character voices, not authentic historical recordings.
The exact English corpus text is spoken even if the display language differs.
The corpus has 2,801 entries across 17 historical philosophers: 2,728 unique
philosopher/text recordings, 200,148 normalized characters. Enki has no fixed
quote corpus and is not assigned invented quotes by this pipeline.

## Storage and generation

- enkiRIDION Supabase project: `afdrjzhcfltsngyxaqhb`.
- Bucket: `quote-audio`, public reads, service-only writes, 4 MB maximum object;
  only `audio/mpeg` and `application/json` MIME types accepted.
- MP3: `v1/en/<philId>/<sha256>.mp3`. The hash includes exact quote identity,
  verified voice ID, voice settings, model and output format.
- Catalog: `v1/en/catalog.json`, exact normalized philosopher/text keys → paths.
- Generator: `scripts/generate-quote-audio.mjs`; casting: `scripts/lib/quote-voices.mjs`.
- ElevenLabs model: `eleven_multilingual_v2`; output `mp3_44100_128`.
- Only the operator-side generator receives API/service credentials. No secrets
  or MP3 library ship in the Vite bundle or EHPK.

The generator validates account voice inventory before spending, checks included
credit balance, saves paid bytes locally before upload, and resumes from local
receipts or matching existing cloud recordings. Ambiguous failed paid requests
leave `.pending` receipts and are not automatically repeated. Recover those clips
from ElevenLabs history before clearing a pending marker. A stale `.lock` should
only be removed after verifying its recorded process is no longer running.

Run from the repository root with Node 24 and installed root/API dependencies:

```sh
node scripts/generate-quote-audio.mjs                         # no-charge plan
node --env-file=/secure/enki-quote-audio.env scripts/generate-quote-audio.mjs --upload --limit 17
node --env-file=/secure/enki-quote-audio.env scripts/generate-quote-audio.mjs --upload
```

The external, private env file needs a valid `ELEVENLABS_API_KEY`,
`SUPABASE_URL=https://afdrjzhcfltsngyxaqhb.supabase.co` and that project's
`SUPABASE_SERVICE_ROLE_KEY`. Optional `ELEVENLABS_VOICE_MAP` maps philosopher IDs
to voices present in the authenticated inventory. Never copy PolyGot's Supabase
URL into this file. Never commit this env file or place it in `public/`.

`--limit 17` produces one quote per historical philosopher for listening QA.
`--bake` generates only; `--push` publishes already-saved recordings without a TTS
key; `--upload` does both. `--philosophers=socrates,plato` restricts a batch.
Paid files and receipts live in ignored `work/quote-audio/`; optional
`ENKI_QUOTE_AUDIO_WORK_DIR` selects another persistent private work directory.
Partial uploads merge with the prior catalog rather than deleting other clips.
Keep one operator job running at a time, including across machines.

## Verified and remaining

- 14 automated checks: exact quote identity, traversal/cross-philosopher rejection,
  partial catalog merge, deduplication, voice casting, playback permission,
  cancellation, replay cache, unavailable audio, bake resume, ambiguous paid
  failure and insufficient-credit protection.
- TypeScript and Vite production build passed. Vite's existing large-bundle
  warning remains.
- SDK validation passed for all 20 page shapes, including all four audio menus.
- Local companion browser: controls, permission enable, quote button and missing
  recording feedback verified. No synthetic test audio was published.
- Live Storage: service upload/public read succeeded; anonymous write rejected
  with 403; `storage.objects` policies grant no authenticated writes to this
  bucket. Temporary verification JSON removed.
- Supabase advisor findings concern existing public views/functions/auth settings;
  no schema or policy changes were made for this audio feature.

Before release: configure the valid ElevenLabs key, verify stock voice casting
against the account, listen to the 17 previews, generate/upload the full library,
verify catalog coverage and actual MP3 playback, then test ring-triggered playback
on a paired phone/G2. Only then bump/package the audio release and replace the
pending Even Hub submission. Do not claim that the current 1.16.0 review includes
audio, and do not replace it with this unpopulated audio build.
