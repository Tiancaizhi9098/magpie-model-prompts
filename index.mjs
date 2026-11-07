import { fileURLToPath } from "node:url";
import { startCatalog } from "./lib/catalog.mjs";

export const ModelPromptCatalog = async (_input, options = {}) => {
  startCatalog(fileURLToPath(new URL('./page/catalog.generated.js', import.meta.url)),
    options.gatewayAddress || process.env.MAGPIE_ADDR || '127.0.0.1:3425');
  return {};
};
