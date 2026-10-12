// AgentHost owns every session's harness process and proxy route, and keeps the sessions on disk.
// a session from an earlier run is dormant -- no process -- until its next prompt reopens it

import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { BackgroundPolicy, Effort } from '@shared/proxy';
import type { CreatedSession, CreateSessionOptions, SessionEvent, SessionInfo, SessionModes, StoredSession } from '@shared/session';
import type { ProxyServer } from '../proxy/server';
import { PROFILES } from './profiles';
import { AgentSession } from './session';
import { SessionStore } from './store';

interface Entry {
  info: SessionInfo;
  harnessSessionId: string | null;
  modes: SessionModes | null;
  items: unknown[];
  agent: AgentSession | null;
  // a dormant session's process is starting; a second prompt waits for the same start
  starting: Promise<AgentSession> | null;
}

export class AgentHost {
  private readonly sessions = new Map<string, Entry>();
  private readonly store: SessionStore;
  private readonly dataDir: string;

  constructor(
    private readonly proxy: ProxyServer,
    // wrontend's own data folder: sessions are stored under it, and each harness keeps its config there
    dataDir: string,
    // the component resolver: an installed component's program, or null when it is not installed
    private readonly programOf: (component: string) => string | null,
    private readonly emit: (event: SessionEvent) => void,
    private backgroundPolicy: BackgroundPolicy = 'local-titles',
  ) {
    // full long-form paths: a Windows 8.3 short path such as C:\Users\ABCDEF~1 makes Node's file watcher in the harness abort
    this.dataDir = realpathSync.native(dataDir);
    this.store = new SessionStore(join(this.dataDir, 'sessions'));
    for (const stored of this.store.list()) {
      this.sessions.set(stored.info.id, { ...stored, modes: stored.modes ?? null, agent: null, starting: null });
    }
  }

  stored(): StoredSession[] {
    return [...this.sessions.values()]
      .sort((a, b) => b.info.createdAt - a.info.createdAt)
      .map(({ info, harnessSessionId, modes, items }) => ({ info, harnessSessionId, modes, items }));
  }

  async create(options: CreateSessionOptions): Promise<CreatedSession> {
    if (!PROFILES[options.harness]) throw new Error(`no harness called ${options.harness}`);
    const info: SessionInfo = {
      id: randomUUID(),
      harness: options.harness,
      folder: realpathSync.native(options.folder),
      model: options.model,
      effort: options.effort,
      title: 'New session',
      createdAt: Date.now(),
    };
    const entry: Entry = { info, harnessSessionId: null, modes: null, items: [], agent: null, starting: null };
    this.sessions.set(info.id, entry);
    try {
      const agent = await this.wake(entry);
      return { info, modes: agent.modes };
    } catch (cause) {
      this.sessions.delete(info.id);
      throw cause;
    }
  }

  async prompt(id: string, text: string): Promise<void> {
    const entry = this.get(id);
    if (entry.info.title === 'New session') {
      entry.info.title = text.trim().split('\n')[0].slice(0, 80);
      this.persist(entry);
    }
    const agent = await this.wake(entry);
    void agent.prompt(text);
  }

  async cancel(id: string): Promise<void> {
    await this.get(id).agent?.cancel();
  }

  // the titles of the sessions whose agent is working with this model right now
  workingWith(model: string): string[] {
    return [...this.sessions.values()].filter((e) => e.agent?.running && e.info.model === model).map((e) => e.info.title);
  }

  answer(id: string, requestId: string, optionId: string | null): void {
    this.get(id).agent?.answer(requestId, optionId);
  }

  setModel(id: string, model: string): void {
    const entry = this.get(id);
    entry.info.model = model;
    entry.agent?.updateRoute({ model });
    this.persist(entry);
  }

  setEffort(id: string, effort: Effort): void {
    const entry = this.get(id);
    entry.info.effort = effort;
    entry.agent?.updateRoute({ effort });
    this.persist(entry);
  }

  // applies to every running session from its next request on
  setBackgroundPolicy(policy: BackgroundPolicy): void {
    this.backgroundPolicy = policy;
    for (const entry of this.sessions.values()) entry.agent?.updateRoute({ backgroundPolicy: policy });
  }

  // a dormant session is woken for this: modes belong to the running harness
  async setMode(id: string, modeId: string): Promise<void> {
    const entry = this.get(id);
    const agent = await this.wake(entry);
    await agent.setMode(modeId);
    entry.info.mode = modeId;
    if (entry.modes) entry.modes = { ...entry.modes, current: modeId };
    this.persist(entry);
  }

  // the renderer owns the transcript's shape; main only keeps it
  saveItems(id: string, items: unknown[]): void {
    const entry = this.sessions.get(id);
    if (!entry) return;
    entry.items = items;
    this.persist(entry);
  }

  // stops the session's process; the session stays, dormant, until its next prompt
  sleep(id: string): void {
    const entry = this.sessions.get(id);
    entry?.agent?.dispose();
    if (entry) entry.agent = null;
  }

  delete(id: string): void {
    this.sleep(id);
    this.sessions.delete(id);
    this.store.remove(id);
  }

  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.sleep(id);
  }

  private wake(entry: Entry): Promise<AgentSession> {
    if (entry.agent) return Promise.resolve(entry.agent);
    if (entry.starting) return entry.starting;
    entry.starting = this.start(entry).finally(() => (entry.starting = null));
    return entry.starting;
  }

  private async start(entry: Entry): Promise<AgentSession> {
    const { info } = entry;
    const profile = PROFILES[info.harness];
    if (!profile) throw new Error(`no harness called ${info.harness}`);
    const route = this.proxy.register({ model: info.model, effort: info.effort, backgroundPolicy: this.backgroundPolicy }, (stats) =>
      this.emit({ sessionId: info.id, type: 'stats', stats }),
    );
    const agent = new AgentSession({
      id: info.id,
      profile,
      program: profile.component ? this.programOf(profile.component) : null,
      folder: info.folder,
      harnessHome: join(this.dataDir, 'harness', profile.id),
      route,
      emit: (event) => {
        // a process that ends on its own leaves the session dormant, ready to be reopened
        if (event.type === 'exit' && entry.agent === agent) entry.agent = null;
        if (event.type === 'modes') entry.modes = { current: event.current, available: event.available };
        if (event.type === 'update' && event.update.sessionUpdate === 'current_mode_update' && entry.modes) {
          entry.modes = { ...entry.modes, current: event.update.currentModeId };
        }
        this.emit(event);
      },
    });
    try {
      const how = await agent.start(entry.harnessSessionId);
      if (how === 'fresh-after-resume-failed') {
        this.emit({ sessionId: info.id, type: 'notice', text: 'The harness could not reopen this session, so it starts without the earlier context.' });
      }
    } catch (cause) {
      agent.dispose();
      throw cause;
    }
    // a reopened harness starts in its default mode; the user's choice goes back on
    if (info.mode) await agent.setMode(info.mode).catch(() => {});
    entry.agent = agent;
    entry.harnessSessionId = agent.harnessSessionId;
    this.persist(entry);
    return agent;
  }

  private persist(entry: Entry): void {
    this.store.save({ info: entry.info, harnessSessionId: entry.harnessSessionId, modes: entry.modes, items: entry.items });
  }

  private get(id: string): Entry {
    const entry = this.sessions.get(id);
    if (!entry) throw new Error(`no session ${id}`);
    return entry;
  }
}
