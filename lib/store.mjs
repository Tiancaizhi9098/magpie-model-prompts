import { mkdir,readFile,writeFile,rename } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID,randomBytes } from 'node:crypto';

export const MAX_BYTES = 8 * 1024 * 1024;
export const emptyState = () => ({ version:2,revision:'empty',enabled:true,rules:{} });
export const dataDirectory = () => join(process.env.XDG_CONFIG_HOME || join(homedir(),'.config'),'magpie','model-prompts');

export function validateState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !input.rules || typeof input.rules !== 'object' || Array.isArray(input.rules)) throw new Error('提示词配置格式不正确。');
  const rules = Object.create(null);
  for (const [id,rule] of Object.entries(input.rules)) {
    if (!id.includes('/') || id.length > 1024 || !rule || typeof rule.prompt !== 'string') throw new Error('模型或提示词格式不正确。');
    if (rule.prompt.trim()) rules[id] = { enabled:rule.enabled !== false,position:rule.position === 'prepend' ? 'prepend' : 'append',prompt:rule.prompt };
  }
  const state = { version:2,enabled:input.enabled !== false,rules };
  if (Buffer.byteLength(JSON.stringify(state),'utf8') > MAX_BYTES - 2048) throw new Error('提示词总量超过 8 MB，请适当缩短部分内容。');
  return state;
}

export async function atomicWrite(file,text) {
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temporary=file+'.'+randomUUID()+'.next';
  await writeFile(temporary,text,{encoding:'utf8',mode:0o600});
  await rename(temporary,file);
}

export async function loadState(directory) {
  try {
    const parsed=JSON.parse(await readFile(join(directory,'prompts.json'),'utf8'));
    return {...validateState(parsed),revision:typeof parsed.revision==='string'?parsed.revision:'external'};
  } catch(error) {
    if(error.code==='ENOENT')return emptyState();
    throw new Error('本地提示词文件无法读取，请保留文件并检查格式。');
  }
}

export async function accessToken(directory) {
  await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,'service.key');
  try { return (await readFile(path,'utf8')).trim(); } catch(error) { if(error.code!=='ENOENT')throw error; }
  const key=randomBytes(32).toString('hex');
  try { await writeFile(path,key,{encoding:'utf8',mode:0o600,flag:'wx'}); return key; }
  catch(error) { if(error.code==='EEXIST')return (await readFile(path,'utf8')).trim(); throw error; }
}

export async function publishRuntime(pluginRoot,state) {
  // This generated cache is ignored by Git and recreated from the independent
  // data file on every startup. No user text is stored in plugins.json.
  const data=JSON.stringify(JSON.stringify(state)).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const module='// Generated local cache. Contains private prompt data. Do not publish.\n'+
    'import { onProvider as apply } from "./prompts.middleware.js";\n'+
    'const settings=JSON.parse('+data+');\n'+
    'export function onProvider(body,ctx){return apply(body,{...ctx,options:settings});}\n';
  await atomicWrite(join(pluginRoot,'runtime.middleware.js'),module);
}

export async function saveState(directory,pluginRoot,input,expectedRevision) {
  const current=await loadState(directory);
  if (expectedRevision && expectedRevision!==current.revision) {
    const error=new Error('另一个页面已修改提示词。请先保留当前草稿，重新打开后再保存。');error.status=409;throw error;
  }
  const state={...validateState(input),revision:randomUUID()};
  await atomicWrite(join(directory,'prompts.json'),JSON.stringify(state,null,2));
  await publishRuntime(pluginRoot,state);
  return state;
}
