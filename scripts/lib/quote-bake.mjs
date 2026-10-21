import { createHash } from 'node:crypto';
import { quoteAudioKey, quoteAudioPath } from '../../src/quote-audio-catalog.mjs';
export const MODEL = 'eleven_multilingual_v2';
export const FORMAT = 'mp3_44100_128';
export const emptyCatalog = () => ({version:1,language:'en',provider:'elevenlabs',entries:{},voices:{}});
// Round-robin means --limit 17 previews every historical philosopher.
export function quotePlan(philosophers) {
  const result=[], seen=new Set();
  for(let i=0;i<Math.max(0,...philosophers.map(p=>p.quotes.length));i++) {
    for(const p of philosophers) {
      const q=p.quotes[i];if(!q)continue;
      const text=q.text.normalize('NFC').trim(), key=quoteAudioKey(p.philId,text);
      if(seen.has(key))continue;
      seen.add(key);result.push({key,philId:p.philId,text});
    }
  }
  return result;
}
export function recordingPath(item,voice) {
  const digest=createHash('sha256').update(JSON.stringify([item.key,voice.voiceId,voice.settings,MODEL,FORMAT])).digest('hex');
  return `v1/en/${item.philId}/${digest}.mp3`;
}
export function checkedCatalog(catalog) {
  if(catalog?.version!==1||catalog?.language!=='en'||catalog?.provider!=='elevenlabs'||!catalog.entries||typeof catalog.entries!=='object')throw Error('Incompatible quote-audio catalog; refusing to overwrite.');
  for(const [key,path] of Object.entries(catalog.entries)) {
    const newline=key.indexOf('\n');
    if(newline<1||quoteAudioPath(catalog,key.slice(0,newline),key.slice(newline+1))!==path)throw Error('Invalid quote-audio catalog entry.');
  }
  return catalog;
}
export function mergeCatalog(previous, entries, voices) {
  checkedCatalog(previous);
  const merged={...previous,entries:{...previous.entries,...entries},voices:{...previous.voices,...voices}};
  checkedCatalog(merged);
  return {...merged,readyQuotes:Object.keys(merged.entries).length,updatedAt:new Date().toISOString()};
}
