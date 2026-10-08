// ═══════════════════════════════════════════════════════════════════
// waitlist.ts — "Coming soon" card on the Home tab.
//
// A demand test for two products we haven't built yet. Every view, tap
// and join is counted at sophicon-api /api/waitlist (no IPs kept). A
// join needs a linked account; unlinked wearers are sent to the link
// overlay, so the waitlist is also a reason to sign up.
// ═══════════════════════════════════════════════════════════════════

import { authHeaders, handleUnauthorized, isLinked, onAccountChange } from './enkiAccount';

const API = 'https://sophicon-api.vercel.app/api/waitlist';
type Feature = 'paint-me' | 'summon';

const ITEMS: Array<{ id: Feature; title: string; body: string; note: string; ask?: string }> = [
  {
    id: 'paint-me',
    title: 'Paint me into the canon',
    body: 'Send a few selfies. We paint you in the house style, in 23 expressions, with your own lines as your quotes.',
    note: 'About $15, once.',
  },
  {
    id: 'summon',
    title: 'Summon a philosopher',
    body: 'Someone missing? Name them. When enough people ask, we paint them in, and the people who asked talk to them first.',
    note: 'Summoners get a badge.',
    ask: 'Who should we summon?',
  },
];

function send(body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response | null> {
  return fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ surface: 'g2', ...body }),
  }).catch(() => null);
}

/** Fire-and-forget counter. */
function count(feature: Feature, action: 'view' | 'tap', src: string): void {
  authHeaders().then((h) => send({ feature, action, src }, h)).catch(() => {});
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function render(root: HTMLElement): void {
  root.innerHTML = `
    <div class="card-header">Coming soon</div>
    <div class="card-body soon-list">
      ${ITEMS.map((it) => `
        <div class="soon-item" data-feature="${it.id}">
          <div class="soon-title">${esc(it.title)}</div>
          <p class="soon-body">${esc(it.body)}</p>
          ${it.ask ? `<input class="soon-ask" type="text" maxlength="60" placeholder="${esc(it.ask)}" autocomplete="off" />` : ''}
          <div class="soon-row">
            <button class="btn btn-primary soon-join">Join the waitlist</button>
            <span class="soon-note">${esc(it.note)}</span>
          </div>
          <p class="soon-msg" role="status" hidden></p>
        </div>`).join('')}
    </div>`;
}

function setJoined(item: HTMLElement, text = 'You’re on the list. We’ll tell you first.'): void {
  const btn = item.querySelector<HTMLButtonElement>('.soon-join');
  if (btn) { btn.textContent = 'On the list ✓'; btn.disabled = true; btn.classList.remove('btn-primary'); }
  const msg = item.querySelector<HTMLElement>('.soon-msg');
  if (msg) { msg.textContent = text; msg.hidden = false; }
}

/** Already joined from another device? Show it. */
async function syncJoined(root: HTMLElement): Promise<void> {
  if (!(await isLinked())) return;
  const h = await authHeaders();
  for (const it of ITEMS) {
    const r = await fetch(`${API}?feature=${it.id}`, { headers: h }).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    const item = root.querySelector<HTMLElement>(`.soon-item[data-feature="${it.id}"]`);
    if (d?.joined && item) {
      setJoined(item);
      const ask = item.querySelector<HTMLInputElement>('.soon-ask');
      if (ask && d.philosopher) ask.value = d.philosopher;
    }
  }
}

async function join(item: HTMLElement, feature: Feature, onNeedSignIn: () => void): Promise<void> {
  const btn = item.querySelector<HTMLButtonElement>('.soon-join');
  const msg = item.querySelector<HTMLElement>('.soon-msg');
  const say = (t: string) => { if (msg) { msg.textContent = t; msg.hidden = false; } };
  const philosopher = item.querySelector<HTMLInputElement>('.soon-ask')?.value.trim() || undefined;

  if (!(await isLinked())) {
    say('Link your account to save your spot, then tap again. It’s free.');
    onNeedSignIn();
    return;
  }
  if (btn) btn.disabled = true;
  const r = await send({ feature, action: 'join', philosopher }, await authHeaders());
  if (r?.ok) { setJoined(item, philosopher ? `You’re on the list. We’ve noted ${philosopher}.` : undefined); return; }
  if (btn) btn.disabled = false;
  if (r?.status === 401) { await handleUnauthorized(); say('Your link expired. Link again to save your spot.'); onNeedSignIn(); return; }
  say(r ? 'That didn’t save. Try again in a moment.' : 'No connection. Try again when you’re online.');
}

/** Mount the card into #soon-card. onNeedSignIn opens the link overlay. */
export function initWaitlist(onNeedSignIn: () => void): void {
  const root = document.getElementById('soon-card');
  if (!root) return;
  render(root);

  // One "view" per feature per session, when the card is actually seen.
  let seen = false;
  const markSeen = () => { if (seen) return; seen = true; ITEMS.forEach((it) => count(it.id, 'view', 'home')); };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { markSeen(); io.disconnect(); } }, { threshold: 0.4 });
    io.observe(root);
  } else markSeen();

  root.querySelectorAll<HTMLElement>('.soon-item').forEach((item) => {
    const feature = item.dataset.feature as Feature;
    item.querySelector('.soon-join')?.addEventListener('click', () => {
      count(feature, 'tap', 'home');
      join(item, feature, onNeedSignIn).catch(() => {});
    });
  });
  syncJoined(root).catch(() => {});
  onAccountChange(() => { syncJoined(root).catch(() => {}); });
}
