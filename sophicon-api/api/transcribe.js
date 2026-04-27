export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { audio, language } = req.body;

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

    // Decode base64 PCM to buffer
    const pcmBuffer = Buffer.from(audio, 'base64');

    // Create WAV header for 16kHz, 16-bit, mono PCM
    const wavHeader = createWavHeader(pcmBuffer.length);
    const wavBuffer = Buffer.concat([wavHeader, pcmBuffer]);

    // Create form data with WAV file
    const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
    const formParts = [
      `--${boundary}\r\n`,
      `Content-Disposition: form-data; name="file"; filename="audio.wav"\r\n`,
      `Content-Type: audio/wav\r\n\r\n`,
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

    console.log('[/api/transcribe] language locked to:', lockedLang, '| audio bytes:', pcmBuffer.length);

    const endPart = [`\r\n--${boundary}--\r\n`];

    const formBody = Buffer.concat([
      Buffer.from(formParts.join('')),
      wavBuffer,
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
