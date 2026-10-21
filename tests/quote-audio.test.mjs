import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { quoteAudioKey, quoteAudioPath } from '../src/quote-audio-catalog.mjs';
import { quotePlan, recordingPath, emptyCatalog, mergeCatalog, checkedCatalog } from '../scripts/lib/quote-bake.mjs';
import { castVoice, CAST } from '../scripts/lib/quote-voices.mjs';
const a={philId:'socrates',text:'Know yourself.',key:quoteAudioKey('socrates','Know yourself.')};
const b={philId:'plato',text:'Begin again.',key:quoteAudioKey('plato','Begin again.')};
const voice={voiceId:'verified-account-voice',settings:{speed:0.96}};
const pathA=recordingPath(a,voice), pathB=recordingPath(b,voice);
const catalog=mergeCatalog(emptyCatalog(),{[a.key]:pathA,[b.key]:pathB},{});

test('recordings belong to exact philosopher and normalized English quote',()=>{
  assert.equal(quoteAudioPath(catalog,a.philId,a.text),pathA);
  assert.equal(quoteAudioPath(catalog,'plato',a.text),null);
  assert.equal(quoteAudioPath(catalog,a.philId,'Know thyself.'),null);
  assert.equal(quoteAudioKey('plato',' café '),quoteAudioKey('plato','cafe\u0301'));
});
test('catalog rejects traversal, another philosopher, and another provider',()=>{
  for(const path of ['../secret.mp3','https://example.com/a.mp3',pathB]) {
    const malformed={...catalog,entries:{[a.key]:path}};
    assert.equal(quoteAudioPath(malformed,a.philId,a.text),null);
    assert.throws(()=>checkedCatalog(malformed));
  }
  assert.equal(quoteAudioPath({...catalog,provider:'other'},a.philId,a.text),null);
});
test('a limited upload preserves previously published recordings',()=>{
  const partial=mergeCatalog({...catalog,entries:{[a.key]:pathA}},{[b.key]:pathB},{});
  assert.deepEqual(partial.entries,catalog.entries);
  assert.equal(partial.readyQuotes,2);
});
test('deduplication does not merge narrators and preview rotates philosophers',()=>{
  const plan=quotePlan([{philId:'socrates',quotes:[{text:'One'},{text:'One'},{text:'Two'}]},{philId:'plato',quotes:[{text:'One'}]}]);
  assert.deepEqual(plan.map(p=>[p.philId,p.text]),[['socrates','One'],['plato','One'],['socrates','Two']]);
});
test('changing voice or delivery produces a fresh immutable filename',()=>{
  assert.equal(recordingPath(a,voice),pathA);
  assert.notEqual(recordingPath(a,{...voice,voiceId:'another'}),pathA);
  assert.notEqual(recordingPath(a,{...voice,settings:{speed:0.9}}),pathA);
});
test('all 17 castings require verified inventory; no guessed IDs',()=>{
  assert.equal(Object.keys(CAST).length,17);
  assert.throws(()=>castVoice('socrates',{voices:[]}));
  const inventory={voices:[{name:'Brian - calm',category:'premade',voice_id:'brian-verified'}]};
  assert.equal(castVoice('socrates',inventory).voiceId,'brian-verified');
  assert.throws(()=>castVoice('socrates',inventory,{socrates:'unverified'}));
});

const bundled=await build({entryPoints:['src/quoteAudio.ts'],bundle:true,platform:'browser',format:'cjs',write:false});
function player(fetchOverride) {
  const requests=[],sources=[],events={};let status='';
  class Context {
    state='suspended';destination={};
    async resume(){this.state='running';}
    async decodeAudioData(bytes){return {bytes};}
    createBufferSource(){const node={onended:null,started:false,stopped:false,connect(){},disconnect(){},start(){this.started=true;},stop(){this.stopped=true;}};sources.push(node);return node;}
  }
  const fetch=async(url,options)=>{
    requests.push({url,options});
    if(fetchOverride)return fetchOverride(url,options);
    if(url.endsWith('catalog.json'))return {ok:true,json:async()=>catalog};
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(128)};
  };
  const sandbox={module:{exports:{}},window:{AudioContext:Context,addEventListener:(name,cb)=>events[name]=cb},fetch,AbortController,setTimeout,clearTimeout,console};
  vm.runInNewContext(bundled.outputFiles[0].text,sandbox);
  const api=sandbox.module.exports;api.onQuoteAudioStatus(s=>status=s);
  return {api,requests,sources,events,status:()=>status};
}
test('ring selection requires phone permission; no autoplay network call',async()=>{
  const p=player();await p.api.playQuoteAudio(a.philId,a.text);
  assert.equal(p.requests.length,0);assert.match(p.status(),/Enable audio/);
});
test('phone tap plays, repeated ring action stops, replay reuses decoded buffer',async()=>{
  const p=player();await p.api.playQuoteAudio(a.philId,a.text,true);
  assert.equal(p.sources[0].started,true);assert.equal(p.requests.length,2);
  await p.api.playQuoteAudio(a.philId,a.text);
  assert.equal(p.sources[0].stopped,true);assert.equal(p.api.isQuoteAudioActive(),false);
  await p.api.playQuoteAudio(a.philId,a.text);
  assert.equal(p.requests.length,2);assert.equal(p.sources[1].started,true);
  p.events.pagehide();assert.equal(p.sources[1].stopped,true);
});
test('stale download cannot play after another quote starts',async()=>{
  let release,requested;
  const waiting=new Promise(r=>requested=r);
  const p=player(async url=>{
    if(url.endsWith('catalog.json'))return {ok:true,json:async()=>catalog};
    if(url.endsWith(pathA)){requested();return new Promise(r=>release=r);}
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(128)};
  });
  const first=p.api.playQuoteAudio(a.philId,a.text,true);await waiting;
  await p.api.playQuoteAudio(b.philId,b.text,true);
  assert.equal(p.requests[1].options.signal.aborted,true);
  release({ok:true,arrayBuffer:async()=>new ArrayBuffer(128)});await first;
  assert.equal(p.sources.length,1);assert.equal(p.sources[0].started,true);
  p.api.stopQuoteAudio();
});
test('unavailable recordings show a useful message without another TTS provider',async()=>{
  const p=player(async()=>({ok:false}));await p.api.playQuoteAudio(a.philId,a.text,true);
  assert.equal(p.sources.length,0);assert.equal(p.requests.length,1);
  assert.match(p.status(),/not available/);assert.equal(p.api.isQuoteAudioActive(),false);
});
test('stopping during microphone permission/resume prevents delayed playback',async()=>{
  const p=player();const playing=p.api.playQuoteAudio(a.philId,a.text,true);
  p.api.stopQuoteAudio();await playing;
  assert.equal(p.sources.length,0);assert.equal(p.requests.length,0);
});
