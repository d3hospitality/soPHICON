// Keccak-256, zero dependencies. Used only by scripts/addrcheck.js to
// verify EIP-55 address checksums offline.
//
// This is original Keccak (0x01 padding), NOT NIST SHA3-256 (0x06) —
// Ethereum predates the standard and uses the original. Swapping the
// pad byte silently produces a different digest and every address would
// "fail" its checksum, so don't.
//
// Verified against the published vectors at the bottom of this file:
//   node scripts/keccak.js --selftest

const MASK = (1n << 64n) - 1n;
const rotl = (x, n) => ((x << n) | (x >> (64n - n))) & MASK;

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];

// rho rotation offsets, R[x][y]
const R = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // θ
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    // ρ + π
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], BigInt(R[x][y]));
      }
    }
    // χ
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) {
        A[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y] & MASK) & B[(x + 2) % 5 + 5 * y]);
      }
    }
    // ι
    A[0] ^= RC[round];
  }
}

function keccak256(input) {
  const msg = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  const RATE = 136; // 1088 bits

  // Multi-rate padding: 0x01 … 0x80 (original Keccak).
  const padLen = RATE - (msg.length % RATE);
  const padded = Buffer.concat([msg, Buffer.alloc(padLen)]);
  padded[msg.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      A[i] ^= padded.readBigUInt64LE(off + i * 8);
    }
    keccakF(A);
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

module.exports = { keccak256 };

// ─── Self-test ───────────────────────────────────────────────────────
if (require.main === module && process.argv[2] === '--selftest') {
  const cases = [
    ['', 'c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470'],
    ['abc', '4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45'],
    ['The quick brown fox jumps over the lazy dog',
     '4d741b6f1eb29cb2a9b9911c82f56fa8d73b04959d3d9d222895df6c0b28aa15'],
  ];
  let bad = 0;
  for (const [msg, want] of cases) {
    const got = keccak256(msg).toString('hex');
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'}  keccak256(${JSON.stringify(msg)})\n      ${got}`);
  }
  process.exit(bad === 0 ? 0 : 1);
}
