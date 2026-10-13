import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { applySessionChange, type CreateSessionOptions, type SessionChange, type SessionInfo, type SessionState, type TranscriptItem } from '@shared/session';
import type { RequestStats } from '@shared/proxy';
import type { CreatedSession } from './agent-host';
import type { SessionEvent } from './session';
import { promptText, SessionStates } from './session-states';
import type { StoredSession } from './store';

// the host's side of a session without a harness: what the states ask of it, recorded
class FakeHost {
  readonly sessions = new Map<string, StoredSession>();
  readonly saved: TranscriptItem[][] = [];
  readonly answered: [string, string | null][] = [];
  promptFails: Error | null = null;
  private count = 0;

  stored(): StoredSession[] {
    return [...this.sessions.values()];
  }

  info(id: string): SessionInfo {
    return { ...this.get(id).info };
  }

  async create(o: CreateSessionOptions): Promise<CreatedSession> {
    const info: SessionInfo = {
      id: `s-${++this.count}`,
      harness: o.harness,
      folderId: 'f',
      folder: o.folder,
      model: o.model,
      effort: o.effort,
      title: 'New session',
      createdAt: this.count,
    };
    this.sessions.set(info.id, { info, harnessSessionId: null, modes: null, items: [] });
    return {
      info,
      modes: {
        current: 'default',
        available: [
          { id: 'default', name: 'Default' },
          { id: 'plan', name: 'Plan' },
        ],
      },
      commands: [],
    };
  }

  async prompt(id: string, text: string): Promise<void> {
    const { info } = this.get(id);
    if (info.title === 'New session') info.title = text.split('\n')[0];
    if (this.promptFails) throw this.promptFails;
  }

  async cancel(): Promise<void> {}

  answer(_id: string, requestId: string, optionId: string | null): void {
    this.answered.push([requestId, optionId]);
  }

  setModel(id: string, model: string): void {
    this.get(id).info.model = model;
  }

  setEffort(id: string, effort: 'on' | 'off'): void {
    this.get(id).info.effort = effort;
  }

  async setMode(id: string, modeId: string): Promise<void> {
    if (modeId === 'missing') throw new Error('the harness has no such mode');
    this.get(id).info.mode = modeId;
  }

  rename(id: string, title: string): void {
    if (title.trim()) this.get(id).info.title = title.trim();
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }

  saveItems(id: string, items: TranscriptItem[]): void {
    this.get(id).items = items;
    this.saved.push(items);
  }

  private get(id: string): StoredSession {
    const s = this.sessions.get(id);
    if (!s) throw new Error(`no session ${id}`);
    return s;
  }
}

// an event as the host sends it, before it names its session
type Unsent<E = SessionEvent> = E extends unknown ? Omit<E, 'sessionId'> : never;

const OPTIONS: CreateSessionOptions = { harness: 'fake', folder: 'C:/work', model: 'm', effort: 'on' };
const chunk = (text: string): SessionUpdate => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } });
const stats = (over: Partial<RequestStats>): RequestStats => ({
  kind: 'main',
  model: 'm',
  status: 200,
  inputTokens: 100,
  outputTokens: 20,
  firstTokenMs: 10,
  generationMs: 1000,
  historyHasThinking: false,
  error: null,
  ...over,
});

function setUp(host = new FakeHost()) {
  const changes: SessionChange[] = [];
  const states = new SessionStates(host, (c) => changes.push(c));
  const listed = states.list();
  const event = (e: Unsent, id = 's-1') => states.apply({ ...e, sessionId: id } as SessionEvent);
  // what a UI that read the list at the start and then heard every change holds now
  const mirror = (): SessionState[] => changes.reduce(applySessionChange, listed);
  return { host, states, changes, event, mirror };
}

describe('the session states', () => {
  it('build the transcript from the harness, save it at a turn’s end, and stream every change a mirror needs', async () => {
    const { host, states, event, mirror } = setUp();
    const { info } = await states.create(OPTIONS);
    await states.prompt(info.id, 'make it so\nplease');
    expect(states.list()[0]).toMatchObject({ info: { title: 'make it so' }, items: [{ kind: 'user', text: 'make it so\nplease' }] });
    expect(states.list()[0].turnStartedAt).not.toBeNull();
    expect(host.saved).toHaveLength(1);

    event({ type: 'turn-start' });
    event({ type: 'update', update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'hm' } } });
    event({ type: 'update', update: chunk('Done ') });
    event({ type: 'update', update: chunk('now.') });
    event({ type: 'update', update: { sessionUpdate: 'usage_update', used: 300, size: 4096 } });
    event({ type: 'update', update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'compact', description: 'Compact' }] } });
    event({ type: 'permission', request: { requestId: 'r', toolCall: { toolCallId: 't' }, options: [] } });
    expect(states.list()[0].permissions).toHaveLength(1);
    event({ type: 'permission-closed', requestId: 'r' });
    event({ type: 'stats', stats: stats({}) });
    const file = { path: 'a.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b'] }], whole: true };
    event({ type: 'turn-end', stopReason: 'cancelled', edits: [file] });

    const s = states.list()[0];
    expect(s.items.map((i) => i.kind)).toEqual(['user', 'thought', 'assistant', 'edits', 'notice']);
    expect(s.items[2]).toMatchObject({ text: 'Done now.' });
    expect(s.items[4]).toMatchObject({ text: 'Stopped' });
    expect(s).toMatchObject({ turnStartedAt: null, permissions: [], usage: { used: 300, size: 4096 }, commands: [{ name: 'compact' }], lastMain: { outputTokens: 20 } });
    expect(host.saved.at(-1)).toEqual(s.items);
    expect(JSON.stringify(mirror())).toBe(JSON.stringify(states.list()));
  });

  it('send a streamed chunk as the one item it changed', async () => {
    const { states, changes, event } = setUp();
    const { info } = await states.create(OPTIONS);
    await states.prompt(info.id, 'hi');
    event({ type: 'update', update: chunk('a') });
    event({ type: 'update', update: chunk('b') });
    expect(changes.at(-1)).toMatchObject({ type: 'updated', fields: {}, items: { from: 1, items: [{ kind: 'assistant', text: 'ab' }] } });
  });

  it('end a prompt that cannot be sent in an error, and refuse a second prompt while a turn runs', async () => {
    const { host, states } = setUp();
    const { info } = await states.create(OPTIONS);
    host.promptFails = new Error('Claude Code is not set up.');
    await states.prompt(info.id, 'hi');
    expect(states.list()[0]).toMatchObject({
      turnStartedAt: null,
      items: [{ kind: 'user' }, { kind: 'error', message: 'The prompt could not be sent.', detail: 'Claude Code is not set up.' }],
    });
    host.promptFails = null;
    await states.prompt(info.id, 'again');
    await expect(states.prompt(info.id, 'and again')).rejects.toThrow('A turn is already running');
    await expect(states.prompt(info.id, '  ', [])).rejects.toThrow('nothing to send');
  });

  it('show a failed model request and a harness that stopped, but not a background request', async () => {
    const { states, event } = setUp();
    const { info } = await states.create(OPTIONS);
    await states.prompt(info.id, 'hi');
    event({ type: 'stats', stats: stats({ kind: 'background', status: 500, error: 'busy' }) });
    event({ type: 'stats', stats: stats({ status: 500, error: 'model runner has unexpectedly stopped' }) });
    event({ type: 'exit', code: 1, detail: 'it crashed' });
    const s = states.list()[0];
    expect(s.items.slice(1).map((i) => (i.kind === 'error' ? i.message : i.kind))).toEqual(['The model request failed.', 'The harness process stopped.']);
    expect(s.turnStartedAt).toBeNull();
  });

  it('change the mode, and say so in the transcript when the harness refuses', async () => {
    const { states } = setUp();
    const { info } = await states.create(OPTIONS);
    await states.setMode(info.id, 'plan');
    expect(states.list()[0]).toMatchObject({ info: { mode: 'plan' }, modes: { current: 'plan' } });
    await states.setMode(info.id, 'missing');
    expect(states.list()[0].items.at(-1)).toMatchObject({ kind: 'error', detail: 'the harness has no such mode' });
  });

  it('keep the user’s mode when a reopened harness reports its default', async () => {
    const { states, event } = setUp();
    const { info } = await states.create(OPTIONS);
    await states.setMode(info.id, 'plan');
    event({ type: 'modes', current: 'default', available: [{ id: 'default', name: 'Default' }] });
    expect(states.list()[0].modes?.current).toBe('plan');
  });

  it('follow a rename, a model and an effort, and drop an event for a session they do not know', async () => {
    const { states, changes, event, mirror } = setUp();
    const { info } = await states.create(OPTIONS);
    states.rename(info.id, ' Renamed ');
    states.setModel(info.id, 'other');
    states.setEffort(info.id, 'off');
    expect(states.list()[0].info).toMatchObject({ title: 'Renamed', model: 'other', effort: 'off' });
    const heard = changes.length;
    event({ type: 'update', update: chunk('lost') }, 'nobody');
    expect(changes).toHaveLength(heard);
    states.delete(info.id);
    expect(changes.at(-1)).toEqual({ type: 'removed', id: info.id });
    expect(mirror()).toEqual([]);
  });

  it('bring a stored session back with its turn over and its last thought closed', () => {
    const host = new FakeHost();
    const info: SessionInfo = { id: 's-9', harness: 'fake', folderId: 'f', folder: 'C:/work', model: 'm', effort: 'on', title: 'Old', createdAt: 1, mode: 'plan' };
    host.sessions.set(info.id, {
      info,
      harnessSessionId: 'h',
      modes: { current: 'plan', available: [] },
      commands: [{ name: 'compact', description: '' }],
      items: [{ kind: 'thought', id: 't-1', text: 'hm', startedAt: 1, endedAt: null }],
    });
    const { states } = setUp(host);
    const s = states.list()[0];
    expect(s).toMatchObject({ turnStartedAt: null, permissions: [], modes: { current: 'plan' }, commands: [{ name: 'compact' }] });
    expect(s.items[0]).toMatchObject({ kind: 'thought' });
    expect((s.items[0] as { endedAt: number | null }).endedAt).not.toBeNull();
  });
});

describe('promptText', () => {
  it('quotes each passage before its reply, keeps their order, and puts the typed text last', () => {
    const message = promptText('anything else?', [
      { quote: 'does the proxy cost performance?', reply: 'it should not' },
      { quote: 'first line\n\nthird line', reply: 'yes' },
    ]);
    expect(message).toBe('> does the proxy cost performance?\n\nit should not\n\n> first line\n>\n> third line\n\nyes\n\nanything else?');
  });

  it('sends a quote without a reply as just the quote', () => {
    expect(promptText('', [{ quote: 'this', reply: '' }])).toBe('> this');
  });
});
