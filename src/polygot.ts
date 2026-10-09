// ═══════════════════════════════════════════════════════════════════
// polygot.ts — a small card for PolyGot, D3's language app for the same
// glasses. A quick test with people who already wear G2: a headline whose
// word for "language" drifts through other languages, the 9:16 reel
// (streamed from polygot.live), and how to install it from Even Hub.
// The Even webview can't open external links, so the link is copied.
// ═══════════════════════════════════════════════════════════════════

const PG = 'https://polygot.live';
const HUB = 'https://hub.evenrealities.com/landing?package_id=com.d3hospitality.linguafranca';

const WORDS: Array<[string, string]> = [
  ['es', 'idioma'], ['fr', 'langue'], ['de', 'Sprache'], ['it', 'lingua'], ['nl', 'taal'], ['sv', 'språk'],
  ['pl', 'język'], ['ru', 'язык'], ['bg', 'език'], ['tr', 'dil'], ['id', 'bahasa'], ['fil', 'wika'],
  ['vi', 'ngôn ngữ'], ['ja', '言語'], ['ko', '언어'], ['zh', '语言'],
];

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function render(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card-header pg-kicker">Also for your G2 · PolyGot</div>
    <div class="card-body">
      <h2 class="pg-title" aria-label="Want to learn a new language?">
        <span aria-hidden="true">Want to learn a new </span><span class="pg-slot" aria-hidden="true"><span class="pg-word" data-phase="in" lang="en">language</span></span><span aria-hidden="true">?</span>
        <span class="pg-measure" aria-hidden="true"></span>
      </h2>
      <p class="pg-body">PolyGot puts the right words at the edge of your view: live conversation help, translation, a word game you play out loud, and a course that goes one word at a time.</p>
      <div class="pg-reel">
        <video muted loop playsinline preload="none" poster="${PG}/reel/polygot-reel.jpg" src="${PG}/reel/polygot-reel.mp4"></video>
        <button class="pg-sound" aria-pressed="false">Sound</button>
      </div>
      <p class="pg-cap">Real recordings of PolyGot on Even G2.</p>
      <button class="btn btn-primary pg-copy">Copy the Even Hub link</button>
      <p class="pg-msg" role="status" hidden></p>
      <ol class="pg-steps">
        <li><b>Open the Even Realities app</b> on this phone.</li>
        <li><b>Go to Even Hub</b> and search for <b>PolyGot</b> (the green parrot, by D3 Hospitality).</li>
        <li><b>Install it</b> to your glasses.</li>
        <li><b>Open PolyGot on your glasses.</b> A short demo runs first.</li>
      </ol>
      <p class="pg-note">Free to install. Premium starts with 3 free days. More at polygot.live.</p>
    </div>`;
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* webview may refuse */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  } catch { return false; }
}

/** Only the word moves: blur out and up, the next arrives from the same blur. */
async function drift(root: HTMLElement): Promise<void> {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const slot = root.querySelector<HTMLElement>('.pg-slot');
  const word = root.querySelector<HTMLElement>('.pg-word');
  const measure = root.querySelector<HTMLElement>('.pg-measure');
  if (!slot || !word || !measure) return;
  const width = (text: string, lang: string) => { measure.textContent = text; measure.lang = lang; return Math.ceil(measure.getBoundingClientRect().width); };
  const home: [string, string] = ['en', 'language'];
  slot.style.width = `${width(home[1], home[0])}px`;
  await sleep(3000);
  for (;;) {
    const set = [...WORDS].sort(() => Math.random() - 0.5).slice(0, 8);
    for (const [lang, text] of [...set, home]) {
      if (!root.isConnected) return;
      word.dataset.phase = 'out'; await sleep(700);
      slot.style.width = `${width(text, lang)}px`;
      word.textContent = text; word.lang = lang; word.dataset.phase = 'enter';
      await sleep(30);
      word.dataset.phase = 'in';
      await sleep(lang === 'en' ? 3700 : 2500);
    }
  }
}

/** Mount into #polygot-card on the Home tab. */
export function initPolyGotCard(): void {
  const root = document.getElementById('polygot-card');
  if (!root) return;
  render(root);
  void drift(root);

  const video = root.querySelector<HTMLVideoElement>('video');
  const sound = root.querySelector<HTMLButtonElement>('.pg-sound');
  if (video && 'IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    new IntersectionObserver(([e]) => { if (e.isIntersecting) video.play().catch(() => {}); else video.pause(); }, { threshold: 0.4 }).observe(video);
  }
  sound?.addEventListener('click', () => {
    if (!video) return;
    video.muted = !video.muted;
    sound.setAttribute('aria-pressed', String(!video.muted));
    sound.textContent = video.muted ? 'Sound' : 'Sound on';
    if (video.paused) video.play().catch(() => {});
  });

  const btn = root.querySelector<HTMLButtonElement>('.pg-copy');
  const msg = root.querySelector<HTMLElement>('.pg-msg');
  btn?.addEventListener('click', async () => {
    const ok = await copy(HUB);
    if (msg) {
      msg.textContent = ok ? 'Link copied. Paste it in your browser, or search PolyGot in Even Hub.' : `Search for PolyGot in Even Hub, or open ${HUB}`;
      msg.hidden = false;
      if (ok) setTimeout(() => { msg.hidden = true; }, 4000);
    }
  });
}
