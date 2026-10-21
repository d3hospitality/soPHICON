import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
async function fixture(t) {
  const dir=await mkdtemp(join(tmpdir(),'enki-quote-bake-test-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const mock=join(dir,'mock.mjs'),calls=join(dir,'calls.txt');
  await writeFile(mock,`
    import {appendFile} from 'node:fs/promises';
    globalThis.fetch=async(url,options)=>{
      if(url.includes('/v2/voices'))return Response.json({voices:[{name:'Brian',category:'premade',voice_id:'test-stock-brian'}],has_more:false});
      if(url.includes('/v1/user/subscription'))return Response.json({character_count:0,character_limit:process.env.TEST_MODE==='quota'?0:10000});
      if(url.includes('/v1/text-to-speech/')) {
        await appendFile(process.env.TEST_CALLS,'tts\\n');
        if(process.env.TEST_MODE==='timeout')throw Error('Synthetic connection lost');
        return new Response(new Uint8Array(512).fill(73),{headers:{'Content-Type':'audio/mpeg'}});
      }
      throw Error('Unexpected request in test: '+url);
    };
  `);
  return {dir,calls,run:mode=>exec(process.execPath,['--import',mock,resolve('scripts/generate-quote-audio.mjs'),'--bake','--limit','1'],{env:{...process.env,ELEVENLABS_API_KEY:'test-only-key',ELEVENLABS_VOICE_MAP:'{}',ENKI_QUOTE_AUDIO_WORK_DIR:dir,TEST_CALLS:calls,TEST_MODE:mode||''}})};
}
test('resuming a completed bake reuses paid bytes without another TTS call',async t=>{
  const f=await fixture(t);await f.run();await f.run();
  assert.equal(await readFile(f.calls,'utf8'),'tts\n');
  const receipts=JSON.parse(await readFile(join(f.dir,'receipts.json'),'utf8'));
  assert.equal(Object.keys(receipts).length,1);
  assert.equal((await readFile(join(f.dir,Object.values(receipts)[0].path))).length,512);
});
test('ambiguous paid failure is not automatically charged again on resume',async t=>{
  const f=await fixture(t);await assert.rejects(f.run('timeout'));
  await assert.rejects(f.run(),error=>/Uncertain prior request/.test(error.stderr));
  assert.equal(await readFile(f.calls,'utf8'),'tts\n');
});
test('insufficient included credits stops before creating audio',async t=>{
  const f=await fixture(t);await assert.rejects(f.run('quota'),error=>/No generation or overage started/.test(error.stderr));
  await assert.rejects(readFile(f.calls),{code:'ENOENT'});
});
