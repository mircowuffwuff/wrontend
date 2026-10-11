// a real end-to-end run: Claude Code through claude-agent-acp, through the proxy, against the local Ollama
// off by default -- WRONTEND_LIVE=1 turns it on, WRONTEND_MODEL picks the model

import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RequestStats } from '@shared/proxy';
import type { SessionEvent } from '@shared/session';
import { resolveBaseUrl } from '../ollama/client';
import { ProxyServer } from '../proxy/server';
import { AgentHost } from './agent-host';

const live = process.env.WRONTEND_LIVE === '1';

describe.skipIf(!live)('Claude Code end to end', () => {
  it(
    'runs a turn with a tool call and a permission request',
    async () => {
      const folder = mkdtempSync(join(tmpdir(), 'wrontend-live-'));
      const dataDir = mkdtempSync(join(tmpdir(), 'wrontend-data-'));
      const proxy = new ProxyServer(() => resolveBaseUrl(process.env.OLLAMA_HOST));
      await proxy.start();

      const events: SessionEvent[] = [];
      const stats: RequestStats[] = [];
      let host: AgentHost;
      const emit = (e: SessionEvent) => {
        events.push(e);
        if (e.type === 'stats') {
          stats.push(e.stats);
          const s = e.stats;
          console.log(
            `request ${s.kind} ${s.status} in=${s.inputTokens} out=${s.outputTokens} first=${s.firstTokenMs}ms gen=${s.generationMs}ms thinking-in-history=${s.historyHasThinking}${s.error ? ` error=${s.error}` : ''}`,
          );
        }
        if (e.type === 'permission') {
          const allow = e.request.options.find((o) => o.kind === 'allow_once') ?? e.request.options[0];
          console.log(`permission: ${e.request.toolCall.title} -> ${allow.name} (options: ${e.request.options.map((o) => o.kind).join(', ')})`);
          host.answer(e.sessionId, e.request.requestId, allow.optionId);
        }
        if (e.type === 'turn-end' || e.type === 'exit') console.log(JSON.stringify(e).slice(0, 600));
      };
      host = new AgentHost(proxy, dataDir, emit);

      const model = process.env.WRONTEND_MODEL ?? 'qwen3.8:27b-ud-iq3_s-derived-renderer';
      const info = await host.create({ harness: 'claude-code', folder, model, effort: 'on' });
      const ended = new Promise<SessionEvent>((resolve) => {
        const check = setInterval(() => {
          const end = events.find((e) => e.type === 'turn-end' || e.type === 'exit');
          if (end) {
            clearInterval(check);
            resolve(end);
          }
        }, 200);
      });
      host.prompt(info.id, 'Create a file named hello.txt containing exactly the word canopy. Then say done.');
      const end = await ended;

      const kinds = new Map<string, number>();
      for (const e of events) {
        const key = e.type === 'update' ? `update:${e.update.sessionUpdate}` : e.type;
        kinds.set(key, (kinds.get(key) ?? 0) + 1);
      }
      console.log('events:', JSON.stringify(Object.fromEntries(kinds)));
      const diffs = events.flatMap((e) =>
        e.type === 'update' && (e.update.sessionUpdate === 'tool_call' || e.update.sessionUpdate === 'tool_call_update')
          ? (e.update.content ?? []).filter((c) => c.type === 'diff')
          : [],
      );
      console.log('diff contents sent:', diffs.length);
      const file = join(folder, 'hello.txt');
      console.log('hello.txt:', existsSync(file) ? JSON.stringify(readFileSync(file, 'utf8')) : 'missing');

      host.disposeAll();
      await proxy.stop();
      expect(end.type).toBe('turn-end');
      expect(stats.length).toBeGreaterThan(0);
    },
    20 * 60 * 1000,
  );
});
