import {test,mock,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
let uses,spent,seen;
const query={select(){return this},eq(){return this},single:async()=>({data:{sprite_path:null}}),update(){return this},then(resolve){return Promise.resolve({error:null}).then(resolve)}};
mock.module('@supabase/supabase-js',{namedExports:{createClient:()=>({from:()=>query,rpc(){throw Error('Paid credits must not be consumed')},storage:{from:()=>({upload:async()=>({error:null}),getPublicUrl:()=>({data:{publicUrl:'https://example.invalid/sprite.png'}})})}})}});
mock.module('../api/_auth.js',{namedExports:{identify:async()=>({userId:'member',tier:'seeker'})}});
mock.module('../api/_store.js',{namedExports:{kv:{incr:async()=>++uses,expire:async()=>{}}}});
const {default:handler}=await import('../api/generate-sprite.js');
beforeEach(()=>{uses=0;spent=0;seen=[];process.env.OPENAI_IMAGE_KEY='test';process.env.SUPABASE_URL='https://project.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='test';global.fetch=async(url,options)=>{seen.push(url);if(url.includes('api.openai.com')){spent++;return{ok:true,json:async()=>({data:[{b64_json:Buffer.from('image').toString('base64')}]})}}assert.equal(options.redirect,'error');return{ok:true,headers:{get:()=> 'image/png'},arrayBuffer:async()=>Buffer.from('ref')}}});
const refs=['0','1'].map(n=>`https://project.supabase.co/storage/v1/object/public/sprites/refs/member/${n}.png`);
async function call(values=refs){const res={status(n){this.code=n;return this},json(b){this.body=b;return this},setHeader(){},end(){}};await handler({method:'POST',headers:{},body:{refs:values}},res);return res;}
test('free account renders without a purchase or credit RPC',async()=>{assert.equal((await call()).code,200);assert.equal(spent,1)});
test('private/arbitrary URLs and another account references never fetch',async()=>{for(const bad of ['http://127.0.0.1/secret','https://project.supabase.co/storage/v1/object/public/sprites/refs/other/0.png'])assert.equal((await call([bad,refs[0]])).code,400);assert.equal(seen.length,0)});
test('burst throttle prevents model spend',async()=>{uses=2;assert.equal((await call()).code,429);assert.equal(spent,0)});
