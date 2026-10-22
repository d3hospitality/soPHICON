import { authHeaders, onAccountChange } from './enkiAccount';
import { AphoricaRecorder } from './aphoricaRecorder';
import { thoughtGlobeModule } from './thoughtGlobe';
let orbit: any = null;
let orbitLoading = false;

const API = 'https://sophicon-api.vercel.app/api/social';
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export const countThought = (s: string) => Array.from(s.normalize('NFC').trim()).length;
export function validateThought(title: string, body: string) {
  if (!countThought(title) || countThought(title) > 80) throw Error('Use a title of 1–80 characters.');
  if (!countThought(body) || countThought(body) > 800) throw Error('Use a thought of 1–800 characters. Edit your transcript before sharing.');
}
let host: HTMLElement | null;
let me: any = null, channels: any[] = [], posts: any[] = [], globe: any = { total: 0, regions: [] };
let channel = '', following = false, cursor: string | null = null;
let draft: any = null, drafts: any[] | null = null, detail: any = null, reflection: any = null;
let review = false, reply = '', replyId = '', notice = '', error = '', busy = false, epoch = 0;
let voiceVersion = 0;
let recorder: AphoricaRecorder | null = null, recording = '', recordingTimer: ReturnType<typeof setTimeout> | undefined;

async function api(body?: any, query = '') {
  const version = epoch;
  const r = await fetch(API + query, {method: body ? 'POST' : 'GET', headers: {'Content-Type':'application/json', ...await authHeaders()}, ...(body ? {body:JSON.stringify(body)} : {}), signal: AbortSignal.timeout(45000)});
  const d = await r.json();
  if (version !== epoch) throw Error('Account changed. Reopen Aphorica.');
  if (!r.ok) throw Error(d.error || 'Please try again.');
  return d;
}
function member() {
  if (!me?.complete) throw Error(me ? 'Finish your free profile on the website, then refresh here.' : 'Connect your free account from Today to publish, reply and vote.');
}
async function run(fn: () => Promise<void>) {
  if (busy) return;
  busy = true; error = ''; notice = '';
  const version = epoch;
  host?.querySelectorAll<HTMLInputElement>('button, input, textarea, select').forEach(b => { if (!b.closest('.thought-orbit')) b.disabled = true; });
  try { await fn(); } catch (e) { if (version === epoch) error = (e as Error).message; }
  finally { if (version === epoch) { busy = false; render(); } }
}
async function feed(append = false) {
  const q = new URLSearchParams({view:'feed', limit:'15', ...(channel ? {channel} : {}), ...(following ? {following:'1'} : {}), ...(append && cursor ? {before:cursor} : {})});
  const d = await api(undefined, '?' + q);
  posts = append ? [...posts, ...d.posts.filter((p: any) => !posts.some(x => x.id === p.id))] : d.posts;
  cursor = d.next;
}
export async function refreshAphoricaPhone() {
  if (!host || busy || recording) return;
  await run(async () => {
    const [identity, topics, world] = await Promise.all([api(undefined,'?view=me'), api(undefined,'?view=channels'), api(undefined,'?view=globe')]);
    me = identity.user; channels = topics.channels; globe = world;
    await feed();
  });
}
const button = (action: string, label: string, id = '', extra = '') => `<button class="btn" data-action="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
function postCard(p: any, full = false) {
  return `<article class="aph-phone-post"><p class="muted">${esc(channels.find(c => c.id === p.channel_id)?.name || 'First Thoughts')} · @${esc(p.username)}</p><h3>${esc(p.title)}</h3><p class="aph-phone-body">${esc(p.body)}</p><div class="aph-phone-actions">${button('up','↑ Upvote',p.id,`aria-pressed="${p.vote === 1}"`)}<span aria-label="Score">${Number(p.upvotes) - Number(p.downvotes)}</span>${button('down','↓ Downvote',p.id,`aria-pressed="${p.vote === -1}"`)}${!full ? button('post','Read & reply',p.id) : ''}</div></article>`;
}
function render() {
  if (!host) return;
  const existingOrbit = host.querySelector<HTMLElement>('#aph-phone-orbit');
  const topic = channels.find(c => c.id === channel);
  host.innerHTML = `<section class="card"><div class="card-body aph-phone">
    <p class="muted">A WORLD OF HUMAN THOUGHT</p><h1>Aphorica<span>.</span></h1><p>Say what stays with you.</p>
    <p class="muted">${me ? `@${esc(me.username || 'your new voice')}` : 'Read freely. Connect your account from Today to join in.'} · Free for everyone</p>
    <div class="aph-phone-actions">${button('new','New thought')}${button('drafts','My drafts')}${button('refresh','Refresh')}</div>
    ${!me?.complete ? `<div class="aph-phone-actions">${button('connect','Connect account')}<a class="btn" href="https://enkiridion.com/aphorica" target="_blank" rel="noopener">${me ? 'Finish profile ↗' : 'Create free account ↗'}</a></div>` : ''}
    <p role="alert" class="aph-phone-error">${esc(error)}</p><p role="status">${esc(notice)}</p>
    ${draft ? compose() : ''}
    ${drafts ? `<section><h2>Private drafts</h2><p class="muted">Continue a thought from the web or glasses.</p>${drafts.map(d => button('draft',esc(d.title || 'Untitled thought'),d.id)).join('') || '<p>No saved drafts yet.</p>'}${button('close-drafts','Close drafts')}</section>` : ''}
    ${detail ? `<section>${button('back','← Back to thoughts')}${postCard(detail.post,true)}<div class="aph-phone-actions">${button('enki','Discuss with Enki')}${button('report','Report post')}</div>
      ${reflection ? `<section class="aph-phone-reflection"><h3>Enki · private AI reflection</h3><p class="aph-phone-body">${esc(reflection.text)}</p><details><summary>Philosophy sources</summary>${reflection.sources.map((s: any) => `<p>[${s.id}] ${esc(s.author)} · ${esc(s.source)}<br>${esc(s.text)}</p>`).join('')}</details></section>` : ''}
      <h3>Replies</h3>${detail.comments.map((c: any) => `<article class="aph-phone-post"><small>@${esc(c.username)}</small><p class="aph-phone-body">${esc(c.body)}</p></article>`).join('') || '<p class="muted">Start the conversation.</p>'}
      <label>Your reply<textarea data-field="reply" rows="3">${esc(reply)}</textarea></label><p class="muted" id="aph-reply-count">${countThought(reply)}/800 characters</p><div class="aph-phone-actions">${voice('reply')}${button('reply','Publish reply')}</div></section>` : ''}
    ${!detail ? `<section><h2>Find your people</h2><div class="aph-phone-actions">${button('all','All thoughts','',`aria-pressed="${!channel && !following}"`)}${button('following','Following','',`aria-pressed="${following}"`)}</div><label>Topics<select data-field="topic"><option value="">All topics</option>${channels.map(c => `<option value="${esc(c.id)}" ${c.id === channel ? 'selected' : ''}>${esc(c.name)} · ${c.followers} followers</option>`).join('')}</select></label>
      ${topic ? `<p>${esc(topic.description)}</p><div class="aph-phone-actions">${button('follow',topic.following ? 'Unfollow' : 'Follow')}${button('recommend',topic.vote === 1 ? 'Recommended ✓' : 'Recommend topic')}<span>${topic.score} recommendations</span></div>` : ''}
      <div>${posts.map(p => postCard(p)).join('') || '<p class="aph-phone-empty">A quiet corner, waiting for a thought. Start one above.</p>'}</div>${cursor ? button('more','More thoughts') : ''}</section>` : ''}
    <section class="aph-phone-globe"><div id="aph-phone-orbit"></div><h2>Light the world with a thought.</h2><p>${Number(globe.total) || 0} thoughts shared in the last 24 hours.</p><p class="muted">${globe.regions.map((r: any) => `${esc(r.region.replace(/-/g,' '))}: ${r.thoughts}`).join(' · ') || 'Regional lights appear when enough people choose to share a broad region.'}</p></section>
    <p class="muted">On glasses: Home → Aphorica. Topics, voice thoughts, votes and these same private drafts.</p><a class="btn" href="https://enkiridion.com/aphorica" target="_blank" rel="noopener">Continue on the website ↗</a>
  </div></section>`;
  if (existingOrbit) host.querySelector('#aph-phone-orbit')?.replaceWith(existingOrbit);
  if (orbit) orbit.update(globe.regions || []);
  else if (!orbitLoading && typeof IntersectionObserver !== 'undefined') {
    orbitLoading = true;
    void thoughtGlobeModule().then(({mountGlobe}) => {
      const target = host?.querySelector('#aph-phone-orbit');
      if (target) orbit = mountGlobe(target, {activity:globe.regions || []});
    }).catch(() => { const target = host?.querySelector('#aph-phone-orbit'); if (target) target.textContent = 'Globe unavailable. Refresh to retry.'; }).finally(() => {orbitLoading = false;});
  }
  if (recording || busy) host.querySelectorAll<HTMLInputElement>('button, input, textarea, select').forEach(b => { if (!b.closest('.thought-orbit')) b.disabled = b.dataset.action !== 'stop'; });
}
function voice(field: string) {
  return recording === field ? button('stop','Stop & transcribe') : button('record',`Record ${field}`,field);
}
function compose() {
  return `<section class="aph-phone-compose"><h2>${review ? 'Review before sharing' : 'Your thought'}</h2><p class="muted">Private until you confirm. Raw audio is not saved to the app.</p>
    ${review ? `<p>@${esc(me.username)} → ${esc(channels.find(c => c.id === draft.channel_id)?.name)}</p><h3>${esc(draft.title)}</h3><p class="aph-phone-body">${esc(draft.body)}</p><div class="aph-phone-actions">${button('publish','Confirm publish')}${button('edit','Edit / re-record')}</div>` : `
    <label>Topic<select data-field="channel_id">${channels.map(c => `<option value="${esc(c.id)}" ${draft.channel_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <label>Title<input data-field="title" value="${esc(draft.title)}"/></label><p class="muted" id="aph-title-count">${countThought(draft.title)}/80 characters</p>${voice('title')}
    <label>Thought<textarea data-field="body" rows="5">${esc(draft.body)}</textarea></label><p class="muted" id="aph-body-count">${countThought(draft.body)}/800 characters</p>${voice('body')}
    <label>Light a region (optional)<select data-field="region"><option value="">No location</option>${['africa','asia','europe','north-america','south-america','oceania'].map(r => `<option value="${r}" ${draft.region === r ? 'selected' : ''}>${r.replace(/-/g,' ')}</option>`).join('')}</select></label>
    <div class="aph-phone-actions">${button('review','Review thought')}${button('save','Save private draft')}</div>`}
    ${button('close-compose','Save & close')}</section>`;
}
async function save() { draft = await api({action:'draft', ...draft}); }
async function openPost(id: string) { detail = await api(undefined, '?view=post&id=' + encodeURIComponent(id)); reflection = null; reply = ''; replyId = ''; }
async function stopVoice(keep: boolean) {
  voiceVersion++;
  const r = recorder, field = recording, version = epoch;
  recorder = null; recording = ''; clearTimeout(recordingTimer);
  if (!r) return;
  if (!keep) { await r.stop(); render(); return; }
  await run(async () => {
    const data = await r.stop();
    if (data.seconds < .3) throw Error('Recording too short. Try again or type your thought.');
    const res = await fetch('https://sophicon-api.vercel.app/api/transcribe', {method:'POST',headers:{'Content-Type':'application/json', ...await authHeaders()},body:JSON.stringify({audio:data.audio,language:'en'}),signal:AbortSignal.timeout(45000)});
    const d = await res.json();
    if (version !== epoch) return;
    if (!res.ok) throw Error(d.error || 'Could not transcribe. Please re-record or type.');
    if (field === 'reply') { reply = d.text || ''; replyId = ''; }
    else if (draft) { draft[field] = d.text || ''; review = false; }
    notice = 'Transcript ready. Edit or re-record, then review before sharing.';
  });
}
async function action(name: string, id: string) {
  if (name === 'stop') { await stopVoice(true); return; }
  if (busy || recording) return;
  if (name === 'connect') {
    document.querySelector<HTMLButtonElement>('.tab-btn[data-tab="home"]')?.click();
    document.getElementById('social-pair-card')?.scrollIntoView({block:'start'}); return;
  }
  if (name === 'refresh') { await refreshAphoricaPhone(); return; }
  if (name === 'record') {
    await run(async () => {
      member(); const version = epoch, voice = ++voiceVersion; const r = new AphoricaRecorder(); recorder = r;
      try { await r.start(); if (version !== epoch || voice !== voiceVersion || document.hidden) { await r.stop(); return; } recording = id; recordingTimer = setTimeout(() => void stopVoice(true), id === 'title' ? 20000 : 90000); }
      catch { await r.stop().catch(() => {}); recorder = null; throw Error('Microphone unavailable. You can type your words instead.'); }
    }); return;
  }
  await run(async () => {
    if (name === 'new') { member(); if (!draft) draft = {id:crypto.randomUUID(),title:'',body:'',channel_id:channel || channels[0]?.id,region:null,revision:0}; review = false; }
    if (name === 'drafts') { member(); drafts = (await api(undefined,'?view=drafts')).drafts; }
    if (name === 'draft') { if (draft && draft.id !== id) await save(); draft = drafts?.find(d => d.id === id); review = false; drafts = null; }
    if (name === 'close-drafts') drafts = null;
    if (name === 'save' || name === 'close-compose') { await save(); notice = 'Private draft saved. Continue here, on the website or on glasses.'; if (name === 'close-compose') draft = null; }
    if (name === 'review') { validateThought(draft.title,draft.body); await save(); review = true; }
    if (name === 'edit') review = false;
    if (name === 'publish') { if (!review) throw Error('Review your words first.'); const d = await api({action:'publish',id:draft.id,revision:draft.revision}); draft = null; review = false; await openPost(d.id); await feed(); notice = 'Your thought is published.'; }
    if (name === 'all' || name === 'following') { channel = ''; following = name === 'following'; if (following) member(); await feed(); }
    if (name === 'more') await feed(true);
    if (name === 'post') await openPost(id);
    if (name === 'back') { detail = null; reflection = null; }
    if (name === 'up' || name === 'down') { member(); const p = detail?.post.id === id ? detail.post : posts.find(p => p.id === id); const value = name === 'up' ? 1 : -1; const d = await api({action:'vote',post_id:id,vote:p.vote === value ? 0 : value}); Object.assign(p,d); const row = posts.find(p => p.id === id); if (row) Object.assign(row,d); }
    if (name === 'follow' || name === 'recommend') { member(); const c = channels.find(c => c.id === channel); await api(name === 'follow' ? {action:'follow',channel_id:channel,following:!c.following} : {action:'channel_vote',channel_id:channel,vote:c.vote === 1 ? 0 : 1}); channels = (await api(undefined,'?view=channels')).channels; }
    if (name === 'reply') { member(); if (!countThought(reply) || countThought(reply) > 800) throw Error('Replies must be 1–800 characters.'); replyId ||= crypto.randomUUID(); await api({action:'comment',post_id:detail.post.id,body:reply,request_id:replyId}); await openPost(detail.post.id); }
    if (name === 'enki') { member(); reflection = await api({action:'enki',post_id:detail.post.id}); }
    if (name === 'report') { member(); await api({action:'report',post_id:detail.post.id,reason:'Member requested review from Even companion'}); notice = 'Report recorded. Thank you.'; }
  });
}
export function initAphoricaPhone() {
  host = document.getElementById('aphorica-phone');
  if (!host || host.dataset.ready) return;
  host.dataset.ready = '1'; render();
  host.addEventListener('click', e => { const b = (e.target as Element).closest<HTMLButtonElement>('button[data-action]'); if (b) void action(b.dataset.action!,b.dataset.id || ''); });
  host.addEventListener('input', e => {
    const el = e.target as HTMLInputElement;
    const field = el.dataset.field;
    if (!field || field === 'topic' || busy || recording) return;
    if (field === 'reply') { reply = el.value; replyId = ''; }
    else if (draft) { draft[field] = el.value; review = false; }
    const counter = document.getElementById(`aph-${field}-count`);
    if (counter) counter.textContent = `${countThought(el.value)}/${field === 'title' ? 80 : 800} characters`;
  });
  host.addEventListener('change', e => { const el = e.target as HTMLSelectElement; if (el.dataset.field === 'topic') void run(async () => { channel = el.value; following = false; await feed(); }); });
  // Leaving the panel releases the microphone and keeps dictation private.
  document.querySelectorAll<HTMLButtonElement>('.tab-btn').forEach(b => b.addEventListener('click', () => { if (b.dataset.tab !== 'aphorica' && recorder) void stopVoice(false); }));
  document.addEventListener('visibilitychange', () => { if (document.hidden && recorder) void stopVoice(false); });
  onAccountChange(() => { epoch++; void stopVoice(false); me = null; draft = null; drafts = null; detail = null; reflection = null; posts = []; reply = ''; replyId = ''; review = false; busy = false; channel = ''; following = false; void refreshAphoricaPhone(); });
  void refreshAphoricaPhone();
}
