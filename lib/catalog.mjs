import { writeFile, rename } from "node:fs/promises";

export function localCatalogUrl(address = "127.0.0.1:3425") {
  const value = /^https?:\/\//i.test(address) ? address : "http://" + address;
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password)
    throw new Error("Only a local Magpie gateway is supported.");
  return new URL('/v1/models', url).href;
}

export function cleanModels(payload) {
  if (!Array.isArray(payload?.data)) throw new Error("Invalid model catalog.");
  const seen = new Set();
  return payload.data.flatMap(model => {
    if (!model || typeof model.id !== 'string' || !model.id.includes('/') || model.id.startsWith('group/') || seen.has(model.id)) return [];
    seen.add(model.id);
    const slash = model.id.indexOf('/');
    return [{ id: model.id, name: typeof model.name === 'string' && model.name ? model.name : model.id.slice(slash + 1),
      provider: model.id.slice(0, slash) }];
  }).sort((a, b) => a.id.localeCompare(b.id));
}

// The sandboxed page deliberately has no network access. It reloads this
// first-party local script, which contains model names only (never API keys).
export async function writeCatalog(path, snapshot) {
  const text = 'window.MODEL_PROMPT_CATALOG = ' + JSON.stringify(snapshot).replace(/</g, '\\u003c') + ';\n';
  const temporary = path + '.next';
  await writeFile(temporary, text, 'utf8');
  await rename(temporary, path);
}

export function startCatalog(path, address, { interval = 5000, fetcher = fetch } = {}) {
  let url;
  try { url = localCatalogUrl(address); } catch { return; }
  let busy = false;
  let previous = [];
  let lastGood = null;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      const response = await fetcher(url, { signal: AbortSignal.timeout(3500), redirect: 'error' });
      if (!response.ok) throw new Error('Catalog unavailable.');
      previous = cleanModels(await response.json());
      lastGood = new Date().toISOString();
      await writeCatalog(path, { models: previous, updatedAt: lastGood, available: true });
    } catch {
      // Keep known model names during a temporary outage. Do not log endpoints,
      // credentials, request bodies, or the user's prompt text.
      await writeCatalog(path, { models: previous, updatedAt: lastGood, available: false }).catch(() => {});
    } finally { busy = false; }
  };
  const timer = setInterval(refresh, interval);
  timer.unref?.();
  // Do not await the gateway while the plugin host is still initializing.
  const initial = setTimeout(refresh, 30);
  initial.unref?.();
  return () => { clearInterval(timer); clearTimeout(initial); };
}
