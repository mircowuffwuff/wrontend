import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKGROUND_MODEL, MAIN_MODEL, type RequestStats, type RouteSettings } from '@shared/proxy';
import { ProxyServer } from './server';

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage['headers'];
  body: string;
}

const STREAM = [
  { type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [], usage: { input_tokens: 1234, output_tokens: 0 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'line one still line one' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 56 } },
  { type: 'message_stop' },
]
  .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
  .join('');

// a stand-in for Ollama that records what reaches it and answers in the Anthropic stream format
function fakeOllama(seen: Seen[]): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString() });
      if (req.url === '/v1/messages') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        // split mid-event, as a real network does
        res.write(STREAM.slice(0, 100));
        setTimeout(() => res.end(STREAM.slice(100)), 10);
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const settings: RouteSettings = { model: 'qwen3.8:27b-ud-iq3_s-derived-renderer', effort: 'on', backgroundPolicy: 'pass' };

const request = {
  model: MAIN_MODEL,
  max_tokens: 32000,
  stream: true,
  system: [{ type: 'text', text: 'you are a coding agent   with odd characters' }],
  tools: [{ name: 'Read', description: 'reads a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
  messages: [
    { role: 'user', content: 'pick a number' },
    { role: 'assistant', content: [{ type: 'thinking', thinking: 'i pick 4817', signature: 'x' }, { type: 'text', text: 'done' }] },
    { role: 'user', content: 'which one?' },
  ],
};

describe('ProxyServer', () => {
  const seen: Seen[] = [];
  let ollama: Server;
  let proxy: ProxyServer;
  let stats: RequestStats[];

  beforeEach(async () => {
    seen.length = 0;
    stats = [];
    ollama = await fakeOllama(seen);
    const port = (ollama.address() as AddressInfo).port;
    proxy = new ProxyServer(() => `http://127.0.0.1:${port}`);
    await proxy.start();
  });

  afterEach(async () => {
    await proxy.stop();
    await new Promise((r) => ollama.close(r));
  });

  it('routes a main request to the session model and leaves the conversation untouched', async () => {
    const route = proxy.register(settings, (s) => stats.push(s));
    const res = await fetch(`${route.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': 'secret' },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(STREAM);

    const sent = JSON.parse(seen[0].body);
    expect(seen[0].path).toBe('/v1/messages');
    expect(sent.model).toBe(settings.model);
    expect(sent.system).toEqual(request.system);
    expect(sent.tools).toEqual(request.tools);
    expect(sent.messages).toEqual(request.messages);
    expect(sent.thinking).toEqual({ type: 'enabled', budget_tokens: 16000 });
    expect(seen[0].headers['x-api-key']).toBeUndefined();

    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ kind: 'main', status: 200, inputTokens: 1234, outputTokens: 56, historyHasThinking: true, error: null });
    expect(stats[0].firstTokenMs).not.toBeNull();
    route.dispose();
  });

  it('turns thinking off when effort is off, and follows a settings change on the next request', async () => {
    const route = proxy.register(settings, (s) => stats.push(s));
    route.update({ effort: 'off', model: 'other:model' });
    await (await fetch(`${route.baseUrl}/v1/messages`, { method: 'POST', body: JSON.stringify(request) })).text();
    const sent = JSON.parse(seen[0].body);
    expect(sent.thinking).toEqual({ type: 'disabled' });
    expect(sent.model).toBe('other:model');
  });

  it('answers a background request locally when the policy says so', async () => {
    const route = proxy.register({ ...settings, backgroundPolicy: 'local' }, (s) => stats.push(s));
    const res = await fetch(`${route.baseUrl}/v1/messages`, {
      method: 'POST',
      body: JSON.stringify({ ...request, model: BACKGROUND_MODEL, stream: false }),
    });
    const reply = (await res.json() as any);
    expect(reply.content[0].text).toBe('New session');
    expect(seen).toHaveLength(0);
    expect(stats[0]).toMatchObject({ kind: 'background', status: 200 });
  });

  it('refuses a background request when the policy says so', async () => {
    const route = proxy.register({ ...settings, backgroundPolicy: 'refuse' }, (s) => stats.push(s));
    const res = await fetch(`${route.baseUrl}/v1/messages`, { method: 'POST', body: JSON.stringify({ ...request, model: BACKGROUND_MODEL }) });
    expect(res.status).toBe(400);
    expect(((await res.json() as any)).type).toBe('error');
    expect(seen).toHaveLength(0);
  });

  it('passes other paths through unchanged', async () => {
    const route = proxy.register(settings, () => {});
    const res = await fetch(`${route.baseUrl}/v1/models?limit=5`);
    expect((await res.json() as any)).toEqual({ data: [] });
    expect(seen[0]).toMatchObject({ method: 'GET', path: '/v1/models?limit=5' });
  });

  it('rejects an unknown session', async () => {
    const route = proxy.register(settings, () => {});
    route.dispose();
    const res = await fetch(`${route.baseUrl}/v1/messages`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
  });

  it('reports an unreachable Ollama in the shape the harness understands', async () => {
    const dead = new ProxyServer(() => 'http://127.0.0.1:1');
    await dead.start();
    const route = dead.register(settings, (s) => stats.push(s));
    const res = await fetch(`${route.baseUrl}/v1/messages`, { method: 'POST', body: JSON.stringify(request) });
    expect(res.status).toBe(502);
    const reply = (await res.json() as any);
    expect(reply.type).toBe('error');
    expect(reply.error.message).toContain('not reachable');
    expect(stats[0].error).toContain('not reachable');
    await dead.stop();
  });
});
