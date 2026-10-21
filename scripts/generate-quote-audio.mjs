#!/usr/bin/env node
// Operator-only. API credentials never enter the Vite bundle.
import { readFile, writeFile, mkdir, rename, stat, open, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { build } from 'esbuild';
import { castVoice } from './lib/quote-voices.mjs';
import { MODEL, FORMAT, quotePlan, recordingPath, emptyCatalog, checkedCatalog, mergeCatalog } from './lib/quote-bake.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const WORK=resolve(process.env.ENKI_QUOTE_AUDIO_WORK_DIR || resolve(ROOT,'work/quote-audio'));
const PROJECT='https://afdrjzhcfltsngyxaqhb.supabase.co';
const BUCKET='quote-audio', CATALOG='v1/en/catalog.json';
const {values:args}=parseArgs({options:{bake:{type:'boolean'},push:{type:'boolean'},upload:{type:'boolean'},limit:{type:'string'},philosophers:{type:'string'}}});
const bake=!!(args.bake||args.upload), push=!!(args.push||args.upload);
const limit=args.limit===undefined?Infinity:Number(args.limit);
if(!(limit>0)||(!Number.isInteger(limit)&&limit!==Infinity))throw Error('--limit must be a positive integer');
const output=await build({entryPoints:[resolve(ROOT,'src/constants.ts')],bundle:true,platform:'node',format:'esm',write:false});
const {PHILOSOPHERS}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].contents).toString('base64'));
const selected=args.philosophers?.split(',');
if(selected?.some(id=>!PHILOSOPHERS.some(p=>p.philId===id&&p.quotes.length)))throw Error('Unknown philosopher or no fixed quotes');
const allPlan=quotePlan(PHILOSOPHERS), plan=allPlan.filter(q=>!selected||selected.includes(q.philId)).slice(0,limit);
console.log(JSON.stringify({corpusQuotes:PHILOSOPHERS.reduce((n,p)=>n+p.quotes.length,0),uniqueRecordings:allPlan.length,selected:plan.length,characters:plan.reduce((n,q)=>n+q.text.length,0),philosophers:new Set(plan.map(q=>q.philId)).size,model:MODEL,mode:bake?(push?'bake+push':'bake'):push?'push':'dry-run'}));
if(!bake&&!push)process.exit(0);
await mkdir(WORK,{recursive:true});
const lockPath=resolve(WORK,'.lock');
let lock;
try{lock=await open(lockPath,'wx',0o600);}catch{throw Error(`Another bake may be running. Inspect ${lockPath} before removing a stale lock.`);}
await lock.writeFile(String(process.pid));
async function atomic(path,bytes){await mkdir(dirname(path),{recursive:true});await writeFile(path+'.tmp',bytes);await rename(path+'.tmp',path);}
async function loadJson(path,fallback){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
async function exists(path){try{return (await stat(path)).size>0;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function eleven(path,options={}) {
  const response=await fetch('https://api.elevenlabs.io'+path,{...options,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(60000)});
  // Never auto-repeat a paid request after ambiguous timeout/server failure.
  if(!response.ok)throw Error(`ElevenLabs ${response.status} at ${path.split('?')[0]}. Saved recordings are retained; no automatic retry.`);
  return response;
}
try {
  const receiptsPath=resolve(WORK,'receipts.json');
  const receipts=await loadJson(receiptsPath,{});
  let storage, previous=emptyCatalog();
  if(push) {
    const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
    if(url?.replace(/\/$/,'')!==PROJECT)throw Error('Use the enkiRIDION Supabase project, not PolyGot storage.');
    if(!process.env.SUPABASE_SERVICE_ROLE_KEY)throw Error('SUPABASE_SERVICE_ROLE_KEY is required for upload');
    const require=createRequire(resolve(ROOT,'sophicon-api/package.json'));
    const {createClient}=require('@supabase/supabase-js');
    const client=createClient(PROJECT,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:bucket,error:bucketError}=await client.storage.getBucket(BUCKET);
    if(bucketError||!bucket?.public)throw Error('Provision the public quote-audio bucket before upload.');
    storage=client.storage.from(BUCKET);
    const {data:oldBlob,error:oldError}=await storage.download(CATALOG);
    if(oldError&&!['404','400'].includes(String(oldError.statusCode)))throw oldError;
    // Supabase returns 400 Object not found for a missing path. Other 400s must fail.
    if(oldError&&String(oldError.statusCode)==='400'&&!/not found/i.test(oldError.message))throw oldError;
    previous=oldBlob?checkedCatalog(JSON.parse(await oldBlob.text())):emptyCatalog();
  }
  let voices={}, jobs=plan.map(item=>({...item,path:receipts[item.key]?.path}));
  if(bake) {
    if(!process.env.ELEVENLABS_API_KEY?.trim())throw Error('ELEVENLABS_API_KEY is empty. Configure the server key before generating recordings.');
    const inventory={voices:[]};let page='';
    do {
      const data=await (await eleven('/v2/voices?page_size=100'+(page?'&next_page_token='+encodeURIComponent(page):''))).json();
      inventory.voices.push(...data.voices);page=data.has_more?data.next_page_token:'';
      if(data.has_more&&!page)throw Error('Voice inventory pagination missing token');
    }while(page);
    const overrides=JSON.parse(process.env.ELEVENLABS_VOICE_MAP||'{}');
    for(const id of new Set(plan.map(q=>q.philId)))voices[id]=castVoice(id,inventory,overrides);
    jobs=plan.map(item=>({...item,path:recordingPath(item,voices[item.philId])}));
    // Recover matching paid clips from Storage if the local cache was moved/lost.
    if(storage)for(const job of jobs) {
      if(previous.entries[job.key]===job.path&&!await exists(resolve(WORK,job.path))) {
        const {data,error}=await storage.download(job.path);
        if(error)throw error;
        const bytes=Buffer.from(await data.arrayBuffer());
        if(bytes.length<256||bytes.length>4_000_000)throw Error('Invalid stored recording');
        await atomic(resolve(WORK,job.path),bytes);
      }
    }
    const missing=[];
    for(const job of jobs)if(!await exists(resolve(WORK,job.path)))missing.push(job);
    const required=missing.reduce((n,q)=>n+q.text.length,0);
    const subscription=await (await eleven('/v1/user/subscription')).json();
    const remaining=subscription.character_limit-subscription.character_count;
    if(!Number.isFinite(remaining)||required>remaining)throw Error(`Need ${required} characters; ${remaining} included credits remain. No generation or overage started.`);
    console.log(JSON.stringify({generate:missing.length,reuse:jobs.length-missing.length,charactersToGenerate:required,remainingCredits:remaining}));
    // Sequential is intentional: a failed request stops spend immediately.
    for(const job of jobs) {
      const file=resolve(WORK,job.path), voice=voices[job.philId];
      if(!await exists(file)) {
        const pending=file+'.pending';
        if(await exists(pending))throw Error(`Uncertain prior request for ${job.path}; recover its recording from ElevenLabs history before retrying.`);
        await atomic(pending,JSON.stringify({philId:job.philId,text:job.text,voiceId:voice.voiceId,at:new Date().toISOString()}));
        const response=await eleven(`/v1/text-to-speech/${encodeURIComponent(voice.voiceId)}?output_format=${FORMAT}`,{method:'POST',body:JSON.stringify({text:job.text,model_id:MODEL,voice_settings:voice.settings,seed:parseInt(job.path.split('/').pop().slice(0,8),16)})});
        if(!(response.headers.get('content-type')||'').startsWith('audio/'))throw Error('ElevenLabs did not return audio');
        const bytes=Buffer.from(await response.arrayBuffer());
        if(bytes.length<256||bytes.length>4_000_000)throw Error('Unexpected recording size');
        await atomic(file,bytes); // Save paid bytes before any cloud upload.
        await unlink(pending);
      }
      receipts[job.key]={path:job.path,voice};
      await atomic(receiptsPath,JSON.stringify(receipts,null,2));
      console.log(`Saved ${job.philId} · ${jobs.indexOf(job)+1}/${jobs.length}`);
    }
  }
  if(push) {
    const entries={};
    for(const job of jobs) {
      const receipt=receipts[job.key];
      if(!receipt)continue;
      checkedCatalog({...emptyCatalog(),entries:{[job.key]:receipt.path}});
      const bytes=await readFile(resolve(WORK,receipt.path));
      const {error}=await storage.upload(receipt.path,bytes,{contentType:'audio/mpeg',cacheControl:'31536000',upsert:false});
      if(error&&String(error.statusCode)!=='409')throw error;
      entries[job.key]=receipt.path;voices[job.philId]=receipt.voice;
    }
    if(!Object.keys(entries).length)throw Error('No saved recordings to publish. Run --bake with a valid ElevenLabs key first.');
    const catalog=mergeCatalog(previous,entries,voices);
    catalog.totalQuotes=allPlan.length;
    const {error}=await storage.upload(CATALOG,JSON.stringify(catalog),{contentType:'application/json',cacheControl:'60',upsert:true});
    if(error)throw error;
    const {data:verified,error:verifyError}=await storage.download(CATALOG);
    if(verifyError)throw verifyError;
    if(JSON.stringify(JSON.parse(await verified.text()).entries)!==JSON.stringify(catalog.entries))throw Error('Published catalog verification failed');
    await atomic(resolve(WORK,'catalog.json'),JSON.stringify(catalog,null,2));
    console.log(`Published and verified ${catalog.readyQuotes}/${allPlan.length} recordings in enkiRIDION Storage.`);
  }
} finally {await lock.close();await unlink(lockPath);}
