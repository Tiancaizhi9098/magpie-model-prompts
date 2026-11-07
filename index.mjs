import { fileURLToPath } from "node:url";
import { dataDirectory } from './lib/store.mjs';
import { startServiceManager } from './lib/service.mjs';

export const ModelPromptCatalog = async (_input, options = {}) => {
  const port=options.servicePort??34931;
  if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('servicePort 必须是 1024 到 65535 之间的端口。');
  await startServiceManager({pluginRoot:fileURLToPath(new URL('.',import.meta.url)),directory:dataDirectory(),port,gatewayAddress:options.gatewayAddress||process.env.MAGPIE_ADDR||'127.0.0.1:3425'});
  return {};
};
