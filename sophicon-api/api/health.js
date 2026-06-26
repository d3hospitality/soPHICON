// GET /api/health
// Returns: { status, service, version, uptimeMs, env: { OPENAI_API_KEY }, endpoints: [...], time }
//
// Zero-cost liveness + readiness probe for the soPHICON G2 / enkiSPEAKS backend.
// Lets deploy-verification (d3-sentry, d3-beacon) and clients confirm the API is
// reachable and correctly configured WITHOUT paying for an OpenAI round-trip. It
// never calls OpenAI — it only reports whether the required env var is present
// (boolean; the key value is never exposed) so a misconfigured deploy fails loud.
//
// "readiness" is the AND of every dependency the worker functions need. Every
// worker route in this project reads OPENAI_API_KEY (20 call sites), so that is
// the single required dependency today. Add to REQUIRED_ENV as new deps appear
// so this endpoint stays the source of truth for "is this deploy actually usable".
//
// Mirrors sommni-api/api/health.js so both backends expose an identical contract
// to uptime-targets.json (expectBodyIncludes: "\"status\":\"ok\"").

const START = Date.now();

// Env vars every worker endpoint depends on. Reported as booleans only.
const REQUIRED_ENV = ['OPENAI_API_KEY'];

// The live worker routes this deploy exposes — handy for clients that want to
// discover endpoints instead of hardcoding them, and for spotting drift.
const ENDPOINTS = [
  '/api/speak',
  '/api/symposium',
  '/api/transcribe',
  '/api/problems',
  '/api/actions',
  '/api/photo-reflection',
  '/api/extract-memory',
  '/api/weekly-overview',
  '/api/aphorica/classify',
  '/api/community/feed',
  '/api/community/get-quote',
  '/api/community/submit-quote',
];

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Probes hit this often; let edge/browser cache it for a few seconds so a
  // monitoring loop doesn't spin up a cold function on every poll.
  res.setHeader('Cache-Control', 'public, max-age=5');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const env = {};
  let ready = true;
  for (const key of REQUIRED_ENV) {
    const present = Boolean(process.env[key]);
    env[key] = present;
    if (!present) ready = false;
  }

  // 200 when ready, 503 when a required dependency is missing — so an uptime
  // monitor treats a misconfigured-but-running deploy as DOWN, not healthy.
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    service: 'sophicon-api',
    version: '0.1.0',
    uptimeMs: Date.now() - START,
    env,
    endpoints: ENDPOINTS,
    time: new Date().toISOString(),
  });
}
