#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// addrcheck — offline checksum verification for the crypto receive
// addresses in src/support.ts.
//
//   node scripts/addrcheck.js <address> [<address> ...]
//   node scripts/addrcheck.js --from-support     (checks what's committed)
//
// Zero dependencies, no network: this must be runnable and trustworthy
// on a machine with no npm install and no internet. A send is
// irreversible, so an address goes into support.ts only after it passes
// here — never straight from a screenshot, a chat message, or a
// truncated "6igpBg…VPdu" display form.
//
// Covers:
//   EVM (ETH / Base / any EVM chain) — EIP-55. The MIXED CASE IS THE
//     CHECKSUM. Never lowercase an EVM address to "clean it up"; doing
//     so throws away the only protection you have against a typo.
//   BTC — bech32 (BIP-173) and bech32m (BIP-350).
//   SOL — base58 decoding to exactly 32 bytes.
// ═══════════════════════════════════════════════════════════════════

const { keccak256 } = require('./keccak');

// ─── EVM (EIP-55) ────────────────────────────────────────────────────
function checkEvm(addr) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return { ok: false, why: 'not 0x + 40 hex chars' };
  const body = addr.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) {
    return { ok: false, why: 'all one case — no EIP-55 checksum to verify. Get the mixed-case form from the wallet.' };
  }
  const hash = keccak256(Buffer.from(body.toLowerCase(), 'ascii')).toString('hex');
  let expected = '';
  for (let i = 0; i < 40; i++) {
    const c = body[i].toLowerCase();
    expected += parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c;
  }
  return expected === body
    ? { ok: true, why: 'EIP-55 checksum valid' }
    : { ok: false, why: `EIP-55 MISMATCH — expected 0x${expected}` };
}

// ─── BTC (bech32 / bech32m) ──────────────────────────────────────────
const B32 = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function hrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 31);
  return out;
}
function checkBtc(addr) {
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) {
    return { ok: false, why: 'bech32 must not mix case' };
  }
  const a = addr.toLowerCase();
  const sep = a.lastIndexOf('1');
  if (sep < 1 || sep + 7 > a.length || a.length > 90) return { ok: false, why: 'malformed bech32 layout' };
  const hrp = a.slice(0, sep);
  if (hrp !== 'bc') return { ok: false, why: `human-readable part is "${hrp}", expected "bc" (mainnet)` };
  const data = [];
  for (const c of a.slice(sep + 1)) {
    const v = B32.indexOf(c);
    if (v === -1) return { ok: false, why: `invalid bech32 character "${c}"` };
    data.push(v);
  }
  const chk = polymod([...hrpExpand(hrp), ...data]);
  const witver = data[0];
  // v0 (P2WPKH/P2WSH) uses bech32; v1+ (Taproot) uses bech32m.
  const want = witver === 0 ? 1 : 0x2bc830a3;
  if (chk !== want) {
    return { ok: false, why: witver === 0 ? 'bech32 checksum FAILED' : 'bech32m checksum FAILED' };
  }
  return { ok: true, why: `bech32${witver === 0 ? '' : 'm'} checksum valid (witness v${witver})` };
}

// ─── SOL (base58 → 32 bytes) ─────────────────────────────────────────
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function checkSol(addr) {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(addr)) return { ok: false, why: 'contains non-base58 characters (0 O I l are excluded)' };
  let num = 0n;
  for (const c of addr) {
    const v = B58.indexOf(c);
    if (v === -1) return { ok: false, why: `invalid base58 character "${c}"` };
    num = num * 58n + BigInt(v);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  const bytes = Buffer.from(hex, 'hex');
  let leading = 0;
  for (const c of addr) { if (c === '1') leading++; else break; }
  const len = bytes.length + leading - (bytes.length === 1 && bytes[0] === 0 ? 1 : 0);
  return len === 32
    ? { ok: true, why: 'decodes to exactly 32 bytes (valid ed25519 public key length)' }
    : { ok: false, why: `decodes to ${len} bytes, expected 32` };
}

// ─── Dispatch ────────────────────────────────────────────────────────
function classify(addr) {
  if (/^0x/i.test(addr)) return ['evm', checkEvm];
  if (/^bc1/i.test(addr)) return ['btc', checkBtc];
  return ['sol', checkSol];
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: node scripts/addrcheck.js <address> [...]   |   --from-support');
  process.exit(2);
}

let inputs = args;
if (args[0] === '--from-support') {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'support.ts'), 'utf8');
  inputs = [...src.matchAll(/address:\s*'([^']*)'/g)].map(m => m[1]).filter(Boolean);
  if (inputs.length === 0) {
    console.log('support.ts has no addresses filled in yet — nothing to check.');
    process.exit(0);
  }
}

let bad = 0;
for (const addr of inputs) {
  if (addr.includes('…') || addr.includes('...')) {
    console.log(`FAIL  ${addr}\n      truncated display form — get the FULL address from the wallet`);
    bad++;
    continue;
  }
  const [kind, fn] = classify(addr);
  const r = fn(addr);
  if (!r.ok) bad++;
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  [${kind}] ${addr}\n      ${r.why}`);
}
console.log(bad === 0 ? `\nAll ${inputs.length} address(es) verified.` : `\n${bad} of ${inputs.length} FAILED — do not ship.`);
process.exit(bad === 0 ? 0 : 1);
