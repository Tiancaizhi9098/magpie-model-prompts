import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createService } from '../lib/service.mjs';
import { loadState,saveState,MAX_BYTES } from '../lib/store.mjs';

test('independent store keeps large Unicode prompts, runtime data and revisions across restarts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'magpie-prompts-'));
  try {
    const directory=join(root,'data'),plugin=join(root,'plugin');
    await mkdir(plugin);
    // Old Magpie options are intentionally never consulted or migrated.
    assert.deepEqual((await loadState(directory)).rules,{});
    const prompt='中文测试 😀 " \\ \n </script>\u2028'.repeat(7000);
    assert.ok(Buffer.byteLength(prompt)>64000);
    const state=await saveState(directory,plugin,{enabled:true,rules:{'test/model':{enabled:true,position:'prepend',prompt}}},'empty');
    assert.equal((await loadState(directory)).rules['test/model'].prompt,prompt);
    assert.equal((await loadState(directory)).revision,state.revision);
    // The generated entry must import the normal hook and preserve arbitrary text.
    await writeFile(join(plugin,'package.json'),'{"type":"module"}');
    await writeFile(join(plugin,'prompts.middleware.js'),'export const onProvider=(body,ctx)=>ctx.options.rules["test/model"].prompt;');
    const generated=await import(pathToFileURL(join(plugin,'runtime.middleware.js')));
    assert.equal(generated.onProvider({},{}),prompt);
    await assert.rejects(()=>saveState(directory,plugin,{rules:{}},'stale'),{status:409});
    assert.equal((await loadState(directory)).rules['test/model'].prompt,prompt);
    await assert.rejects(()=>saveState(directory,plugin,{rules:{'test/model':{prompt:'x'.repeat(MAX_BYTES)}}},state.revision),/8 MB/);
    assert.equal((await loadState(directory)).revision,state.revision);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('loopback service saves over 64 KB, enforces access and conflicts, and reloads saved data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'magpie-service-'));
  const pluginRoot=fileURLToPath(new URL('../',import.meta.url));
  // Use a disposable runtime output, while static files come from the repository.
  const plugin=join(root,'plugin');await mkdir(plugin);await mkdir(join(plugin,'page'));
  await writeFile(join(plugin,'page/index.html'),await readFile(join(pluginRoot,'page/index.html')));
  let service;
  try {
    const directory=join(root,'data');
    service=await createService({pluginRoot:plugin,directory,port:0});
    const base=service.base,headers={authorization:'Bearer '+service.token,origin:'null','content-type':'application/json'};
    assert.equal((await fetch(base+'/api/state')).status,401);
    assert.equal((await fetch(base+'/api/state',{headers:{...headers,origin:'https://example.com'}})).status,403);
    const preflight=await fetch(base+'/api/state',{method:'OPTIONS',headers:{origin:'null','access-control-request-headers':'authorization,content-type'}});
    assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'null');
    assert.match((await fetch(base+'/editor.html')).headers.get('content-security-policy'),/sandbox allow-scripts/);
    const prompt='长提示词：中文测试。'.repeat(15000);
    const response=await fetch(base+'/api/state',{method:'POST',headers,body:JSON.stringify({revision:'empty',state:{rules:{'test/model':{prompt,position:'prepend'}}}})});
    assert.equal(response.status,200);const saved=await response.json();
    assert.equal(saved.rules['test/model'].prompt,prompt);
    const conflict=await fetch(base+'/api/state',{method:'POST',headers,body:JSON.stringify({revision:'empty',state:{rules:{}}})});
    assert.equal(conflict.status,409);
    const oversized=await fetch(base+'/api/state',{method:'POST',headers,body:'x'.repeat(MAX_BYTES+1)});
    assert.equal(oversized.status,413);
    await new Promise(resolve=>service.server.close(resolve));
    service=await createService({pluginRoot:plugin,directory,port:0});
    const restarted=await (await fetch(service.base+'/api/state',{headers:{authorization:'Bearer '+service.token}})).json();
    assert.equal(restarted.rules['test/model'].prompt,prompt);
    assert.equal(restarted.revision,saved.revision);
  } finally { if(service)await new Promise(resolve=>service.server.close(resolve));await rm(root,{recursive:true,force:true}); }
});
