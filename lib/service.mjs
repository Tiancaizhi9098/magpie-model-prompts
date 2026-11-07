import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { accessToken,atomicWrite,loadState,publishRuntime,saveState,MAX_BYTES } from './store.mjs';
import { cleanModels,localCatalogUrl } from './catalog.mjs';

export const VERSION='2.0.0';
function sameToken(actual,expected) {
  const a=Buffer.from(actual||''),b=Buffer.from('Bearer '+expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
async function requestJson(req) {
  let total=0;const chunks=[];
  for await(const chunk of req) {
    total+=chunk.length;
    if(total>MAX_BYTES) { const error=new Error('保存内容超过 8 MB。');error.status=413;throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error=new Error('保存内容不是有效的 JSON。');error.status=400;throw error; }
}

export async function createService({pluginRoot,directory,port=34931,gatewayAddress='127.0.0.1:3425'}) {
  const token=await accessToken(directory);
  let mutation=Promise.resolve();
  const gateway=localCatalogUrl(gatewayAddress);
  const files={'/editor.html':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','application/javascript'],'/theme.js':['theme.js','application/javascript'],'/style.css':['style.css','text/css'],'/icon.svg':['icon.svg','image/svg+xml']};
  const server=createServer(async(req,res)=>{
    const origin='http://127.0.0.1:'+server.address().port;
    const requestOrigin=req.headers.origin;
    const allowedOrigin=!requestOrigin || requestOrigin==='null' || requestOrigin===origin;
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!=='127.0.0.1:'+server.address().port || !allowedOrigin) { res.writeHead(403);res.end();return; }
    if(requestOrigin) { res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin'); }
    if(req.method==='OPTIONS') { res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.writeHead(204);res.end();return; }
    const path=new URL(req.url,origin).pathname;
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(path.startsWith('/api/')) {
        if(!sameToken(req.headers.authorization,token)) { json(401,{error:'本机服务的访问凭证无效，请从 Magpie 重新打开页面。'});return; }
        if(path==='/api/health' && req.method==='GET') { json(200,{name:'magpie-model-prompts',version:VERSION});return; }
        if(path==='/api/state' && req.method==='GET') { json(200,await loadState(directory));return; }
        if(path==='/api/models' && req.method==='GET') {
          const response=await fetch(gateway,{signal:AbortSignal.timeout(5000),redirect:'error'});
          if(!response.ok)throw new Error('模型目录暂时不可用。');
          json(200,{models:cleanModels(await response.json()),available:true});return;
        }
        if(path==='/api/state' && req.method==='POST') {
          if(!String(req.headers['content-type']||'').startsWith('application/json')) { json(415,{error:'请使用 JSON 格式保存。'});return; }
          if(Number(req.headers['content-length'])>MAX_BYTES) { json(413,{error:'保存内容超过 8 MB。'});req.resume();return; }
          const input=await requestJson(req);
          const pending=mutation.then(()=>saveState(directory,pluginRoot,input.state,input.revision));
          mutation=pending.catch(()=>{});
          json(200,await pending);return;
        }
        json(404,{error:'没有这个接口。'});return;
      }
      const file=files[path];
      if(req.method!=='GET'||!file){res.writeHead(404);res.end();return;}
      res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox allow-scripts; script-src "+origin+"; style-src "+origin+" 'unsafe-inline'; connect-src "+origin+"; img-src "+origin+" data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self' http://wails.localhost wails://wails.localhost http://127.0.0.1:* http://localhost:*");
      res.writeHead(200,{'Content-Type':file[1]});res.end(await readFile(join(pluginRoot,'page',file[0])));
    } catch(error) { if(!res.headersSent)json(error.status||500,{error:error.message||'保存失败，请重试。'});else res.end(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  server.unref();
  return { server,token,base:'http://127.0.0.1:'+server.address().port };
}

export async function startServiceManager(options) {
  const {pluginRoot,directory,port=34931}=options;
  const token=await accessToken(directory);
  const base='http://127.0.0.1:'+port;
  let owned=null,busy=false,lastRevision=null;
  const ensure=async()=>{
    if(busy)return;busy=true;
    try {
      if(!owned) {
        let existing=false;
        try { const r=await fetch(base+'/api/health',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(500)});const data=await r.json();existing=r.ok&&data.version===VERSION; } catch {}
        if(!existing) {
          try { owned=await createService(options); }
          catch(error) { if(error.code!=='EADDRINUSE')throw error; const response=await fetch(base+'/api/health',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(500)});if(!response.ok)throw new Error('本机端口被其他程序占用，请更改 servicePort。'); }
        }
      }
      const state=await loadState(directory);
      if(state.revision!==lastRevision) { await publishRuntime(pluginRoot,state);lastRevision=state.revision; }
    } finally { busy=false; }
  };
  await ensure();
  await atomicWrite(join(pluginRoot,'page','launch.generated.js'),'window.MODEL_PROMPT_SERVICE='+JSON.stringify({base,token,version:VERSION})+';\n');
  const timer=setInterval(()=>ensure().catch(()=>{}),1000);timer.unref();
  return { close:()=>{clearInterval(timer);owned?.server.close();},base,token };
}
