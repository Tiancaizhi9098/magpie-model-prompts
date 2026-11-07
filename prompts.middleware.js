import { injectPrompt, selectRule } from "./lib/prompts.js";

// This hook runs after routing, in the caller's protocol. Each fallback receives
// a fresh body from Magpie, so a prompt cannot leak to the next provider.
export function onProvider(body, ctx) {
  const rule = selectRule(ctx);
  if (rule === undefined) return;
  return injectPrompt(body, ctx.protocol, rule.prompt, rule.position);
}
