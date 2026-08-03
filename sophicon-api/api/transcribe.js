import { requireEntitlement } from './_entitlements.js';
/**
 * Transcribe audio to text using OpenAI's Whisper API (gpt-4o-transcribe).
 * Accepts base64-encoded raw PCM audio (wrapped server-side in a WAV container)
 * or a compressed AAC/.m4a upload, and locks Whisper to a specific language to
 * prevent auto-detect drift.
 *
 * @description Convert speech audio to text
 * @method POST
 * @param {object} req.body
 * @param {string} req.body.audio - Base64 audio: raw 16kHz 16-bit mono PCM, or an .m4a file
 * @param {string} [req.body.format] - 'm4a' for compressed uploads (also auto-detected); default raw PCM
 * @param {string} [req.body.language='en'] - ISO 639-1 language code for transcription
 * @returns {object} { text: string }
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  // Authorization allowed so browser callers (web tap-to-talk) can send
  // their Bearer identity — matches speak.js / extract-memory.js.
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Device-Id');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const gate = await requireEntitlement(req, res, 'transcribe');
  if (!gate) return;

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: 'Server configuration error: missing API key' });
  }

  try {
    const { audio, language, format } = req.body || {};

    if (!audio) {
      return res.status(400).json({ error: 'Missing audio data' });
    }

    // CRITICAL: lock Whisper to a known language. Without an explicit
    // 'language' parameter Whisper auto-detects from the audio, which
    // silently flips to Spanish / German / Japanese on unclear, short,
    // or noisy clips. The philosopher then faithfully replies in the
    // mis-detected language and the user thinks the model is broken.
    // Default to English; client can override via UserProfile.language.
    const lockedLang = (typeof language === 'string' && /^[a-z]{2}$/.test(language))
      ? language
      : 'en';

    // Decode base64 audio to buffer
    const audioBuffer = Buffer.from(audio, 'base64');

    // Compressed uploads: Apple Watch / iOS send AAC in an .m4a container —
    // ~8× smaller than raw PCM, which matters enormously on the watch radio.
    // Detected by the MP4 'ftyp' magic as well as the explicit field, so a
    // client/server version skew can never WAV-wrap an m4a by mistake.
    const isM4A = format === 'm4a'
      || (audioBuffer.length > 12 && audioBuffer.toString('ascii', 4, 8) === 'ftyp');

    // Raw PCM gets a WAV header for 16kHz, 16-bit, mono; m4a passes through.
    const fileBuffer = isM4A
      ? audioBuffer
      : Buffer.concat([createWavHeader(audioBuffer.length), audioBuffer]);
    const fileName = isM4A ? 'audio.m4a' : 'audio.wav';
    const fileMime = isM4A ? 'audio/mp4' : 'audio/wav';

    // Create form data with the audio file
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const formParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n`,
      `Content-Type: ${fileMime}\r\n\r\n`,
    ];

    const modelPart = [
      `\r\n--${boundary}\r\n`,
      `Content-Disposition: form-data; name="model"\r\n\r\n`,
      `gpt-4o-transcribe`,
    ];

    // Always send language — defaults to 'en' to prevent auto-detect drift.
    const langPart = [
      `\r\n--${boundary}\r\n`,
      `Content-Disposition: form-data; name="language"\r\n\r\n`,
      lockedLang,
    ];

    console.log('[/api/transcribe] language locked to:', lockedLang, '| format:', isM4A ? 'm4a' : 'pcm/wav', '| audio bytes:', audioBuffer.length);

    const endPart = [`\r\n--${boundary}--\r\n`];

    const formBody = Buffer.concat([
      Buffer.from(formParts.join('')),
      fileBuffer,
      Buffer.from(modelPart.join('')),
      Buffer.from(langPart.join('')),
      Buffer.from(endPart.join('')),
    ]);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI transcription error:', err);
      return res.status(500).json({ error: 'Transcription failed' });
    }

    const data = await response.json();
    return res.status(200).json({ text: data.text || '' });

  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

function createWavHeader(dataLength) {
  const header = Buffer.alloc(44);
  const sampleRate = 16000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);

  return header;
}
