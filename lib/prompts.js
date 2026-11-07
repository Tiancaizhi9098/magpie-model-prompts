// Pure JavaScript shared by the middleware and offline tests; no I/O.
export function routedModelId(ctx) {
  const provider = ctx.provider;
  if (!provider || typeof provider.id !== "string" || typeof provider.model !== "string") return "";
  const prefix = provider.id + "/";
  return provider.model.startsWith(prefix) ? provider.model : prefix + provider.model;
}

export function selectRule(ctx) {
  const options = ctx.options;
  if (!options || options.enabled === false || !options.rules || typeof options.rules !== "object") return;
  const id = routedModelId(ctx);
  if (!id || !Object.prototype.hasOwnProperty.call(options.rules, id)) return;
  const rule = options.rules[id];
  if (!rule || rule.enabled === false || typeof rule.prompt !== "string" || !rule.prompt.trim()) return;
  return { prompt: rule.prompt, position: rule.position === 'prepend' ? 'prepend' : 'append' };
}

function appendText(content, prompt, before) {
  if (typeof content === "string") return before ? prompt + (content ? "\n\n" : "") + content : content + (content ? "\n\n" : "") + prompt;
  if (Array.isArray(content)) return before ? [{ type: "text", text: prompt }].concat(content) : content.concat([{ type: "text", text: prompt }]);
  if (content === undefined || content === null) return prompt;
}

export function injectPrompt(body, protocol, prompt, position = 'append') {
  if (!body || typeof body !== "object") return;
  const before = position === 'prepend';
  switch (protocol) {
    case "anthropic": {
      const next = appendText(body.system, prompt, before);
      if (next === undefined) return;
      body.system = next;
      break;
    }
    case "responses": {
      // Responses instructions is a string. Preserve any unusual shape unchanged.
      if (body.instructions != null && typeof body.instructions !== "string") return;
      body.instructions = before ? prompt + (body.instructions ? "\n\n" + body.instructions : "") : (body.instructions ? body.instructions + "\n\n" : "") + prompt;
      break;
    }
    case "chat": {
      if (!Array.isArray(body.messages)) return;
      // Extend only the initial instructions, never a historical mid-turn message.
      const first = body.messages[0];
      if (first && (first.role === "system" || first.role === "developer")) {
        const next = appendText(first.content, prompt, before);
        if (next === undefined) return;
        body.messages[0] = { ...first, content: next };
      } else body.messages.unshift({ role: "system", content: prompt });
      break;
    }
    case "gemini": {
      const key = body.system_instruction && !body.systemInstruction ? "system_instruction" : "systemInstruction";
      const instruction = body[key];
      if (instruction != null && (typeof instruction !== "object" || !Array.isArray(instruction.parts))) return;
      const parts = instruction?.parts || [];
      body[key] = { ...(instruction || {}), parts: before ? [{ text: prompt }, ...parts] : [...parts, { text: prompt }] };
      break;
    }
    default: return;
  }
  return body;
}
