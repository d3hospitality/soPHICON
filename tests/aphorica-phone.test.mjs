import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';
import { randomUUID } from 'node:crypto';

const built = await build({entryPoints:['src/aphoricaPhone.ts'],bundle:true,platform:'node',format:'cjs',write:false,plugins:[{name:'account',setup(b){b.onLoad({filter:/\/enkiAccount\.ts$/},()=>({contents:'export const authHeaders=async()=>({});export const onAccountChange=cb=>{globalThis.accountChanged=cb};',loader:'js'}));b.onLoad({filter:/\/aphoricaRecorder\.ts$/},()=>({contents:'export class AphoricaRecorder {async start(){await globalThis.micPermission;} async stop(){globalThis.micStops++;return {audio:"",seconds:1};}}',loader:'js'}));}}]});
async function fixture() {
  const {document,window} = parseHTML('<html><body><button class="tab-btn" data-tab="home"></button><button class="tab-btn" data-tab="aphorica"></button><div id="aphorica-phone"></div></body></html>');
  const topic = {id:randomUUID(),name:'Questions',followers:0,score:0,following:false};
  const calls = []; let draft, published = 0, deferred;
  let me = {id:'owner',username:'owner',complete:true};
  const post = {id:randomUUID(),title:'Someone else’s question',body:'What do you notice?',username:'reader',channel_id:topic.id,vote:0,upvotes:0,downvotes:0};
  const context = {document,window,console,micPermission:Promise.resolve(),micStops:0,URLSearchParams,AbortSignal,crypto:{randomUUID},setTimeout,clearTimeout,module:{exports:{}},exports:{},fetch:async(url,opts)=>{
    const body=opts?.body && JSON.parse(opts.body), view=new URL(url).searchParams.get('view'); calls.push(body || {view}); let data={};
    if(body?.action==='draft'){draft={...body,revision:(draft?.revision||0)+1}; data=draft; if(deferred) await deferred;}
    else if(body?.action==='publish'){published++;data={id:post.id};}
    else if(body?.action==='vote'){post.vote=body.vote;post.upvotes=body.vote===1?1:0;post.downvotes=body.vote===-1?1:0;data=post;}
    else if(body?.action==='follow'){topic.following=body.following;topic.followers=body.following?1:0;}
    else if(view==='me')data={user:me};
    else if(view==='channels')data={channels:[topic]};
    else if(view==='globe')data={total:0,regions:[]};
    else if(view==='drafts')data={drafts:draft?[draft]:[]};
    else if(view==='post')data={post,comments:[]};
    else data={posts:[post],next:null};
    return {ok:true,json:async()=>data};
  }};
  context.exports=context.module.exports; vm.runInNewContext(built.outputFiles[0].text,context); context.module.exports.initAphoricaPhone();
  const settle=async()=>{for(let i=0;i<30;i++)await new Promise(setImmediate);}; await settle();
  const click=async(action)=>{const el=document.querySelector(`[data-action="${action}"]`);assert.ok(el,action);assert.ok(!el.disabled,`${action} enabled`);el.click();await settle();};
  const input=(field,value)=>{const el=document.querySelector(`[data-field="${field}"]`);el.value=value;el.dispatchEvent(new window.Event('input',{bubbles:true}));};
  return {document,context,calls,click,input,settle,get published(){return published;},get draft(){return draft;},defer(){deferred=new Promise(r=>this.release=r);},changeAccount(){me=null;context.accountChanged();}};
}
test('phone saves drafts and requires review plus explicit confirmation before publishing',async()=>{
  const f=await fixture();await f.click('new');f.input('title','A concrete question');f.input('body','💡'.repeat(801));await f.click('review');assert.match(f.document.body.textContent,/1–800/);assert.equal(f.published,0);
  f.input('body','💡'.repeat(800));await f.click('review');assert.ok(f.document.querySelector('[data-action="publish"]'));assert.equal(f.published,0);assert.equal(f.draft.body.length,1600);
  await f.click('edit');f.input('body','The edited thought');assert.equal(f.document.querySelector('[data-action="publish"]'),null);await f.click('review');await f.click('publish');assert.equal(f.published,1);assert.match(f.document.body.textContent,/Your thought is published/);
});
test('phone resumes shared drafts and switches votes on the same post',async()=>{
  const f=await fixture();await f.click('new');f.input('title','A draft from the phone');f.input('body','Keep it private');await f.click('close-compose');assert.equal(f.published,0);await f.click('drafts');await f.click('draft');assert.equal(f.document.querySelector('[data-field="body"]').value,'Keep it private');
  await f.click('up');await f.click('down');assert.deepEqual(f.calls.filter(c=>c.action==='vote').map(c=>c.vote),[1,-1]);
});
test('an account change discards a pending private draft response',async()=>{
  const f=await fixture();await f.click('new');f.input('title','Private owner words');f.input('body','Should not survive account change');f.defer();f.document.querySelector('[data-action="save"]').click();await f.settle();f.changeAccount();f.release();await f.settle();assert.doesNotMatch(f.document.body.textContent,/Private owner words/);assert.equal(f.document.querySelector('[data-field="body"]'),null);assert.equal(f.published,0);
});

test('leaving the panel while permission is pending releases a late microphone',async()=>{
 const f=await fixture(); await f.click('new'); let allow;
 f.context.micPermission=new Promise(r=>allow=r);
 f.document.querySelector('[data-action="record"]').click(); await f.settle();
 f.document.querySelector('[data-tab="home"]').click(); allow(); await f.settle();
 assert.ok(f.context.micStops>=2); assert.equal(f.document.querySelector('[data-action="stop"]'),null);
 assert.equal(f.calls.filter(c=>c.action==='publish').length,0);
});
