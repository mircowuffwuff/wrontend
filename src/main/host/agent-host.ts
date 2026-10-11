// AgentHost owns every session's harness process and proxy route

import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { Effort } from '@shared/proxy';
import type { CreateSessionOptions, SessionEvent, SessionInfo } from '@shared/session';
import type { ProxyServer } from '../proxy/server';
import { PROFILES } from './profiles';
import { AgentSession } from './session';

export class AgentHost {
  private readonly sessions = new Map<string, { info: SessionInfo; agent: AgentSession }>();

  constructor(
    private readonly proxy: ProxyServer,
    // wrontend's own data folder; each harness keeps its config under it
    private readonly dataDir: string,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  async create(options: CreateSessionOptions): Promise<SessionInfo> {
    const profile = PROFILES[options.harness];
    if (!profile) throw new Error(`no harness called ${options.harness}`);
    // full long-form paths: a Windows 8.3 short path such as C:\Users\ABCDEF~1 makes Node's file watcher in the harness abort
    const folder = realpathSync.native(options.folder);
    const dataDir = realpathSync.native(this.dataDir);
    const id = randomUUID();
    const route = this.proxy.register({ model: options.model, effort: options.effort, backgroundPolicy: 'local-titles' }, (stats) =>
      this.emit({ sessionId: id, type: 'stats', stats }),
    );
    const agent = new AgentSession({
      id,
      profile,
      folder,
      harnessHome: join(dataDir, 'harness', profile.id),
      route,
      emit: this.emit,
    });
    const info: SessionInfo = {
      id,
      harness: profile.id,
      folder,
      model: options.model,
      effort: options.effort,
      title: 'New session',
      createdAt: Date.now(),
    };
    this.sessions.set(id, { info, agent });
    try {
      await agent.start();
    } catch (cause) {
      agent.dispose();
      this.sessions.delete(id);
      throw cause;
    }
    return info;
  }

  prompt(id: string, text: string): void {
    const s = this.get(id);
    if (s.info.title === 'New session') s.info.title = text.trim().split('\n')[0].slice(0, 80);
    void s.agent.prompt(text);
  }

  cancel(id: string): Promise<void> {
    return this.get(id).agent.cancel();
  }

  answer(id: string, requestId: string, optionId: string | null): void {
    this.get(id).agent.answer(requestId, optionId);
  }

  setModel(id: string, model: string): void {
    const s = this.get(id);
    s.info.model = model;
    s.agent.updateRoute({ model });
  }

  setEffort(id: string, effort: Effort): void {
    const s = this.get(id);
    s.info.effort = effort;
    s.agent.updateRoute({ effort });
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((s) => s.info);
  }

  close(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.agent.dispose();
    this.sessions.delete(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  private get(id: string) {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    return s;
  }
}
