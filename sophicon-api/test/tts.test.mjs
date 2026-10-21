import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
let allowed,cache,providerCalls;
mock.module('../api/_entitlements.js',{namedExports:{requireEntitlement:async(req,res,feature)=>{assert.equal(feature,'tts');if(allowed)return{userId:'free-user',tier:'seeker'};res.status(429).json({error:'rate_limit'});return null}}});
mock.module('../api/_store.js',{namedExports:{kv:{get:async k=>cache.get(k),set:async(k,v)=>cache.set(k,v)}}});
mock.module('../api/_voices.js',{namedExports:{activeProvider:()=> 'openai',getVoice:()=>({voiceId:'alloy',style:'calm'})}});
const {default:handler}=await import('../api/tts.js');
beforeEach(()=>{allowed=true;cache=new Map();providerCalls=0;process.env.OPENAI_API_KEY='test';global.fetch=async()=>{providerCalls++;return{ok:true,arrayBuffer:async()=>Buffer.from('audio')}}});
async function invoke(){const res={status(n){this.code=n;return this},json(b){this.body=b;return this},setHeader(){},send(b){this.code=200;this.body=b;return this},end(){}};await handler({method:'POST',headers:{},body:{text:'Patience gives thought room to grow.',philosopherId:'socrates'}},res);return res;}
test('free users receive cloud speech without a daily counter',async()=>{assert.equal((await invoke()).code,200);assert.equal(providerCalls,1)});
test('cached audio does not trigger another provider charge',async()=>{await invoke();await invoke();assert.equal(providerCalls,1)});
test('short-term throttle stops synthesis before provider spend',async()=>{allowed=false;const r=await invoke();assert.equal(r.code,429);assert.equal(r.body.error,'rate_limit');assert.equal(providerCalls,0)});
