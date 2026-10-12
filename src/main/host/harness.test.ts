// tests against the real claude-agent-acp that never reach a model: its proxy route points at a dead address.
// off by default -- WRONTEND_HARNESS_TESTS=1 turns them on; they need no GPU and no Ollama, only the adapter, which the first
// run installs

import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/session';
import { installedProgram } from '../components/testing';
import { ProxyServer } from '../proxy/server';
import { AgentHost } from './agent-host';
import { claudeCode } from './profiles';

const on = process.env.WRONTEND_HARNESS_TESTS === '1';
const temp = (prefix: string) => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

function connect(program: string, home: string, folder: string) {
  const launch = claudeCode.launch({ proxyUrl: 'http://127.0.0.1:1/s/dead', harnessHome: home, program });
  const child = spawn(launch.command, launch.args, { cwd: folder, env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const connection = client({ name: 'wrontend-test' })
    .onNotification('session/update', () => {})
    .connect(ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>));
  return { child, agent: connection.agent, close: () => (connection.close(), child.kill()) };
}

describe.skipIf(!on)('claude-agent-acp without a model', () => {
  it('reports its capabilities and reopens a session in a new process', async () => {
    const home = temp('wrontend-home-');
    const folder = temp('wrontend-project-');

    const program = await installedProgram('claude-code');
    const first = connect(program, home, folder);
    const init = await first.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    console.log('capabilities:', JSON.stringify(init.agentCapabilities));
    const created = await first.agent.request('session/new', { cwd: folder, mcpServers: [] });
    console.log('modes:', JSON.stringify(created.modes?.availableModes?.map((m) => m.id)), 'config:', JSON.stringify(created.configOptions?.map((o) => o.id)));
    first.close();

    const second = connect(program, home, folder);
    await second.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const outcome: Record<string, string> = {};
    for (const method of ['session/resume', 'session/load'] as const) {
      try {
        if (method === 'session/resume') await second.agent.request(method, { sessionId: created.sessionId, cwd: folder, mcpServers: [] });
        else await second.agent.request(method, { sessionId: created.sessionId, cwd: folder, mcpServers: [] });
        outcome[method] = 'ok';
      } catch (cause) {
        outcome[method] = (cause as Error).message;
      }
    }
    console.log('reopen:', JSON.stringify(outcome));
    second.close();
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION);
  }, 120_000);
});

// a stand-in for Ollama's Anthropic endpoint: every request gets the same short streamed reply, and is recorded
function fakeModel(log: { model: string; system: string; messages: number; stream: boolean }[]): Promise<Server> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not here"}');
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      const system = Array.isArray(body.system) ? body.system.map((b: { text?: string }) => b.text ?? '').join(' ') : String(body.system ?? '');
      log.push({ model: body.model, system, messages: body.messages?.length ?? 0, stream: !!body.stream });
      const message = { id: `msg_${log.length}`, type: 'message', role: 'assistant', model: body.model, content: [] as unknown[], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } };
      const text = 'Hello from the fake model.';
      if (!body.stream) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 6 } }));
        return;
      }
      const events = [
        { type: 'message_start', message },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } },
        { type: 'message_stop' },
      ];
      res.writeHead(200, { 'content-type': 'text/event-stream' }).end(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function turnEnded(events: SessionEvent[], after: number): Promise<SessionEvent> {
  return new Promise((resolve) => {
    const check = setInterval(() => {
      const end = events.slice(after).find((e) => e.type === 'turn-end' || e.type === 'exit');
      if (end) {
        clearInterval(check);
        resolve(end);
      }
    }, 100);
  });
}

describe.skipIf(!on)('Claude Code against a fake model', () => {
  it('runs a turn, survives a restart of the host and resumes with its history', async () => {
    const log: { model: string; system: string; messages: number; stream: boolean }[] = [];
    const model = await fakeModel(log);
    const proxy = new ProxyServer(() => `http://127.0.0.1:${(model.address() as AddressInfo).port}`);
    await proxy.start();
    const dataDir = temp('wrontend-data-');
    const folder = temp('wrontend-project-');
    const events: SessionEvent[] = [];

    const program = await installedProgram('claude-code');
    const first = new AgentHost(proxy, dataDir, () => program, (e) => events.push(e));
    const { info, modes } = await first.create({ harness: 'claude-code', folder, model: 'fake-model', effort: 'off' });
    expect(modes?.available.map((m) => m.id)).toContain('plan');
    await first.setMode(info.id, 'plan');
    await first.prompt(info.id, 'say hi');
    const end1 = await turnEnded(events, 0);
    expect(end1).toMatchObject({ type: 'turn-end', stopReason: 'end_turn' });
    const replies = events.filter((e) => e.type === 'update' && e.update.sessionUpdate === 'agent_message_chunk');
    expect(replies.length).toBeGreaterThan(0);
    first.saveItems(info.id, [{ kind: 'user', id: 'u-1', text: 'say hi' }]);
    first.disposeAll();

    const mark = events.length;
    const second = new AgentHost(proxy, dataDir, () => program, (e) => events.push(e));
    const stored = second.stored();
    expect(stored.map((s) => s.info.id)).toEqual([info.id]);
    expect(stored[0].items).toHaveLength(1);
    expect(stored[0].harnessSessionId).not.toBeNull();
    expect(stored[0].info.mode).toBe('plan');
    const before = log.length;
    await second.prompt(info.id, 'say hi again');
    const end2 = await turnEnded(events, mark);
    expect(end2).toMatchObject({ type: 'turn-end', stopReason: 'end_turn' });
    expect(events.slice(mark).some((e) => e.type === 'notice')).toBe(false);
    // the reopened session is in the mode the user picked
    const reported = events.slice(mark).filter((e) => e.type === 'modes');
    expect(reported.map((e) => e.type === 'modes' && e.current)).toEqual(['plan']);

    // the resumed session sent the earlier exchange along: its main request carries more than one message
    const main = log.slice(before).filter((r) => r.model === 'fake-model' && r.stream);
    console.log('requests:', JSON.stringify(log.map((r) => ({ model: r.model, messages: r.messages, stream: r.stream, system: r.system.slice(0, 160) })), null, 1));
    expect(main.some((r) => r.messages >= 3)).toBe(true);
    // title requests are answered by the proxy and never reach the model
    expect(log.some((r) => r.system.includes('You are naming'))).toBe(false);

    second.disposeAll();
    await proxy.stop();
    await new Promise((r) => model.close(r));
  }, 180_000);
});
