import { quoteAudioKey, quoteAudioPath } from './quote-audio-catalog.mjs';

const ROOT = 'https://afdrjzhcfltsngyxaqhb.supabase.co/storage/v1/object/public/quote-audio';
let context: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let request: AbortController | null = null;
let generation = 0;
let activeKey = '';
let catalog: unknown = null;
let checkedAt = 0;
const buffers = new Map<string, AudioBuffer>();
let status = 'Tap Enable audio, then choose Hear English on a quote.';
const listeners = new Set<(message:string)=>void>();
function report(message:string) { status=message; for(const cb of listeners)cb(message); }
export function onQuoteAudioStatus(cb:(message:string)=>void) { listeners.add(cb);cb(status);return()=>listeners.delete(cb); }
export function isQuoteAudioActive():boolean { return !!activeKey || !!request; }

/** Called in a real phone tap so iOS can authorize later ring-triggered playback. */
export async function enableQuoteAudio():Promise<boolean> {
  try {
    const Context = window.AudioContext || (window as Window & {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
    if(!Context)throw Error('Audio unavailable');
    if(!context)context=new Context();
    await context.resume();
    if(context.state!=='running')throw Error('Audio suspended');
    report('Audio enabled. Quotes play through your phone or connected earbuds.');return true;
  }catch{report('Tap Enable audio in the Even app to allow playback.');return false;}
}
export function stopQuoteAudio() {
  generation++;request?.abort();request=null;
  if(source){source.onended=null;try{source.stop();}catch{/* already ended */}source.disconnect();source=null;}
  activeKey='';report('Audio stopped. Choose Hear English to replay.');
}
export async function playQuoteAudio(philId:string,text:string,fromPhoneTap=false):Promise<void> {
  const key=quoteAudioKey(philId,text);
  if(activeKey===key){stopQuoteAudio();return;}
  stopQuoteAudio();const run=generation;activeKey=key;
  // Resume synchronously from the phone tap before awaiting the network.
  if(fromPhoneTap){if(!await enableQuoteAudio()||run!==generation){if(run===generation)activeKey='';return;}}
  if(!context||context.state!=='running'){activeKey='';report('Open the Even app and tap Enable audio once, then try Hear English again.');return;}
  activeKey=key;report('Loading English quote…');
  const controller=new AbortController();request=controller;
  const timer=setTimeout(()=>controller.abort(),15000);
  try {
    if(!catalog||Date.now()-checkedAt>600000){
      const r=await fetch(`${ROOT}/v1/en/catalog.json`,{signal:controller.signal,cache:'no-cache'});
      if(!r.ok)throw Error('The English recordings are not available yet.');
      catalog=await r.json();checkedAt=Date.now();
    }
    const path=quoteAudioPath(catalog,philId,text);
    if(!path)throw Error('This English quote has not been recorded yet.');
    let buffer=buffers.get(path);
    if(!buffer){
      const r=await fetch(`${ROOT}/${path}`,{signal:controller.signal});
      if(!r.ok)throw Error('Could not load this recording. Please try again.');
      const bytes=await r.arrayBuffer();
      if(bytes.byteLength>4_000_000)throw Error('This recording could not be played.');
      buffer=await context.decodeAudioData(bytes);
      if(run!==generation)return;
      if(buffers.size>=8)buffers.delete(buffers.keys().next().value!);
      buffers.set(path,buffer);
    }
    if(run!==generation)return;
    if(context.state!=='running')throw Error('Tap Enable audio in the Even app to resume playback.');
    const node=context.createBufferSource();node.buffer=buffer;node.connect(context.destination);source=node;
    node.onended=()=>{node.disconnect();if(run===generation){source=null;activeKey='';report('Finished. Hear English again to replay.');}};
    node.start();report('Playing English quote · tap Hear English again to stop.');
  }catch(e){if(run===generation){activeKey='';report(controller.signal.aborted?'Audio timed out. Please try again.':(e as Error).message);}}
  finally{clearTimeout(timer);if(request===controller)request=null;}
}
// A suspended or closed Even app must not leave a clip playing unexpectedly.
if(typeof window!=='undefined')window.addEventListener('pagehide',stopQuoteAudio);
