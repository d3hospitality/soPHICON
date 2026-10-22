import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { WONDER_MOMENTS } from '../src/wonder.mjs';
const require=createRequire(import.meta.url);
const result=await build({stdin:{contents:`export * from './src/practiceGlass';export * from './src/path';export * from './src/habits';export * from './src/constants';export {validateEvenHubPageContainer} from '@evenrealities/even_hub_sdk';`,resolveDir:process.cwd()},bundle:true,external:['@evenrealities/even_hub_sdk'],platform:'node',format:'cjs',write:false,plugins:[{name:'offline-account',setup(b){
 b.onLoad({filter:/\/enkiAccount\.ts$/},()=>({contents:'export const authHeaders=async()=>({});export const isLinked=async()=>false;export const onAccountChange=()=>{};export const setAccountBridge=()=>{};',loader:'js'}));
 b.onLoad({filter:/\/enkiSync\.ts$/},()=>({contents:'export const syncNow=async()=>{};export const markDirty=async()=>{};export const schedulePush=()=>{};',loader:'js'}));
 b.onLoad({filter:/\/ui\.ts$/},()=>({contents:'export const log=()=>{};',loader:'js'}));
}}]});
const storage=new Map();const module={exports:{}};
vm.runInNewContext(result.outputFiles[0].text,{module,exports:module.exports,require,console,TextEncoder,TextDecoder,URL,Date,setTimeout:()=>0,clearTimeout:()=>{},window:{localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}}});
const app=module.exports;
test('curated quotations exactly match the existing library',()=>{
 for(const m of WONDER_MOMENTS){const p=app.PHILOSOPHERS.find(p=>p.philId===m.quote.philId);assert.ok(p?.quotes.some(q=>q.text===m.quote.text&&q.source===m.quote.source),m.id)}
});
test('real glasses flow keeps, completes and reopens without duplicating or resetting a saved step',async()=>{
 let page;let checked=0;
 const bridge={getLocalStorage:async k=>storage.get(k)||'',setLocalStorage:async(k,v)=>{storage.set(k,v);return true},rebuildPageContainer:async p=>{const validation=app.validateEvenHubPageContainer(p);assert.equal(validation.valid,true,JSON.stringify(validation));page=p;checked++;return true}};
 await app.initPath(bridge);
 const glass=new app.PracticeGlass(bridge,async()=>{});
 const choose=async label=>{const names=page.listObject[0].itemContainer.itemName;const i=names.indexOf(label);assert.ok(i>=0,`${label} missing: ${names}`);await glass.handle({listEvent:{currentSelectItemIndex:i}})};
 await glass.open(true);await choose('Read the quote');await choose('Try the experiment');await choose('Keep this step');
 assert.equal(app.openMoves().length,1);const id=app.openMoves()[0].id;
 await choose('Mark done');assert.equal(app.moveById(id).status,'done');
 await glass.open(true);await choose('Try a small experiment');await choose('View kept step');
 assert.equal(app.moveById(id).status,'done');assert.equal(app.recentDone().length,1);
 await glass.open(true);await choose('Another perspective');
 await app.addGoal('Open a neighborhood restaurant');await choose('Try a small experiment');await choose('Connect to a goal');await choose('Open a neighborhood restaurant');await choose('Keep this step');
 assert.equal(app.openMoves().length,1);assert.equal(app.openMoves()[0].goalId,app.activeGoals()[0].id);
 assert.ok(checked>=12);assert.equal(await glass.handle({sysEvent:{eventType:4}}),false);
});
