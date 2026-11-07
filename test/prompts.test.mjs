import test from 'node:test';
import assert from 'node:assert/strict';
import { onProvider } from '../prompts.middleware.js';
import { cleanModels, localCatalogUrl, writeCatalog } from '../lib/catalog.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const context = (protocol = 'anthropic', provider = 'one', model = 'model-a') => ({
  protocol, model: 'group/auto', provider: { id: provider, model },
  options: { enabled: true, rules: { 'one/model-a': { prompt: 'A 的规则', enabled: true }, 'two/model-a': { prompt: 'B 的规则', enabled: true } } }
});

test('routed model and provider determine the prompt, including routing groups', () => {
  assert.equal(onProvider({ system: 'original' }, context()).system, 'original\n\nA 的规则');
  assert.equal(onProvider({ system: 'original' }, context('anthropic', 'two')).system, 'original\n\nB 的规则');
  assert.equal(onProvider({ system: 'original' }, context('anthropic', 'unknown')), undefined);
  assert.equal(onProvider({ system: 'original' }, context('anthropic', 'one', 'one/model-a')).system, 'original\n\nA 的规则');
});
test('disabled, empty and missing rules are no-ops', () => {
  const ctx = context();
  ctx.options.enabled = false; assert.equal(onProvider({}, ctx), undefined);
  ctx.options.enabled = true; ctx.options.rules['one/model-a'].enabled = false; assert.equal(onProvider({}, ctx), undefined);
  ctx.options.rules['one/model-a'] = { prompt: ' \n ' }; assert.equal(onProvider({}, ctx), undefined);
  assert.equal(onProvider({}, { protocol: 'anthropic' }), undefined);
});
test('Anthropic text blocks retain cache markers and tools', () => {
  const block = { type: 'text', text: 'original', cache_control: { type: 'ephemeral' } };
  const tools = [{ name: 'test', input_schema: { type: 'object' } }];
  const body = { model: 'test', system: [block], tools, stream: true };
  onProvider(body, context());
  assert.deepEqual(body.system, [block, { type: 'text', text: 'A 的规则' }]);
  assert.equal(body.system[0], block); assert.equal(body.tools, tools); assert.equal(body.stream, true); assert.equal(body.model, 'test');
});
test('Anthropic missing instructions get a prompt, malformed data stays intact', () => {
  assert.equal(onProvider({}, context()).system, 'A 的规则');
  assert.equal(onProvider({ system: 7 }, context()), undefined);
});
test('Responses instructions are appended, other inputs and tools stay intact', () => {
  const input = [{ role: 'user', content: 'hello' }];
  const body = { instructions: 'original', input, tools: [] };
  assert.equal(onProvider(body, context('responses')).instructions, 'original\n\nA 的规则');
  assert.equal(body.input, input);
  assert.equal(onProvider({ instructions: [] }, context('responses')), undefined);
});
test('Chat initial developer and system instructions support both text shapes', () => {
  for (const role of ['developer', 'system']) {
    const body = { messages: [{ role, content: 'original' }, { role: 'user', content: 'hello' }] };
    onProvider(body, context('chat'));
    assert.equal(body.messages[0].role, role); assert.equal(body.messages[0].content, 'original\n\nA 的规则');
  }
  const body = { messages: [{ role: 'system', content: [{ type: 'text', text: 'original' }] }] };
  onProvider(body, context('chat')); assert.equal(body.messages[0].content.length, 2);
});
test('Chat adds initial instructions without rewriting historical messages', () => {
  const history = [{ role: 'user', content: 'hello' }, { role: 'system', content: 'historical' }];
  const body = { messages: [...history] }; onProvider(body, context('chat'));
  assert.deepEqual(body.messages.slice(1), history); assert.equal(body.messages[0].content, 'A 的规则');
});
test('Gemini supports camelCase and snake_case instruction shapes', () => {
  for (const key of ['systemInstruction', 'system_instruction']) {
    const body = { [key]: { role: 'system', parts: [{ text: 'original' }] }, contents: [] };
    onProvider(body, context('gemini'));
    assert.deepEqual(body[key].parts, [{ text: 'original' }, { text: 'A 的规则' }]);
    assert.equal(body[key].role, 'system');
  }
  assert.deepEqual(onProvider({}, context('gemini')).systemInstruction.parts, [{ text: 'A 的规则' }]);
});
test('fallback body is independently modified for each provider', () => {
  const original = { system: [{ type: 'text', text: 'original' }] };
  const first = structuredClone(original), second = structuredClone(original);
  onProvider(first, context()); onProvider(second, context('anthropic', 'two'));
  assert.equal(first.system.at(-1).text, 'A 的规则'); assert.equal(second.system.at(-1).text, 'B 的规则');
  assert.equal(original.system.length, 1);
});
test('unsupported protocol and unexpected shape are no-ops', () => {
  assert.equal(onProvider({}, context('unknown')), undefined);
  assert.equal(onProvider({}, context('chat')), undefined);
});
test('catalog contains only public model metadata, excludes groups and duplicates', () => {
  const output = cleanModels({ data: [
    { id: 'one/a', name: '模型 A', apiKey: 'never expose' }, { id: 'one/a' }, { id: 'group/auto' }, { id: 'two/b' }, { name: 'bad' }
  ] });
  assert.deepEqual(output, [{ id: 'one/a', name: '模型 A', provider: 'one' }, { id: 'two/b', name: 'b', provider: 'two' }]);
  assert.throws(() => cleanModels({}));
});
test('catalog fetch accepts local HTTP only, never forwards secrets or remote addresses', () => {
  assert.equal(localCatalogUrl(), 'http://127.0.0.1:3425/v1/models');
  assert.equal(localCatalogUrl('localhost:4567'), 'http://localhost:4567/v1/models');
  for (const address of ['https://example.com', 'http://example.com:3425', 'http://user:password@127.0.0.1:3425']) assert.throws(() => localCatalogUrl(address));
});
test('catalog script safely encodes text and can be updated atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'magpie-prompt-test-'));
  try {
    const path = join(dir, 'catalog.js');
    await writeCatalog(path, { models: [{ id: 'one/a', name: '</script>' }] });
    const first = await readFile(path, 'utf8'); assert.equal(first.includes('</script>'), false);
    await writeCatalog(path, { models: [] }); assert.equal((await readFile(path, 'utf8')).includes('"models":[]'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('prepend works in all four protocols and keeps the original instructions', () => {
  const cases = [
    ['anthropic', { system: 'base' }, body => body.system, 'A 的规则\n\nbase'],
    ['anthropic', { system: [{ type: 'text', text: 'base', cache_control: { type: 'ephemeral' } }] }, body => body.system.map(x => x.text).join('|'), 'A 的规则|base'],
    ['responses', { instructions: 'base' }, body => body.instructions, 'A 的规则\n\nbase'],
    ['chat', { messages: [{ role: 'developer', content: 'base' }] }, body => body.messages[0].content, 'A 的规则\n\nbase'],
    ['chat', { messages: [{ role: 'system', content: [{ type: 'text', text: 'base' }] }] }, body => body.messages[0].content.map(x => x.text).join('|'), 'A 的规则|base'],
    ['gemini', { systemInstruction: { parts: [{ text: 'base' }] } }, body => body.systemInstruction.parts.map(x => x.text).join('|'), 'A 的规则|base']
  ];
  for (const [protocol, body, inspect, expected] of cases) {
    const ctx = context(protocol); ctx.options.rules['one/model-a'].position = 'prepend';
    assert.equal(inspect(onProvider(body, ctx)), expected, protocol);
  }
});
