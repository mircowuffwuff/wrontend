// every session's state as a UI shows it, kept in the main process so that any UI is a mirror of it: the transcript built
// from the harness's updates, whether a turn runs, the questions waiting for an answer, the modes and commands, the latest
// numbers. each change goes out as a SessionChange, and the transcript goes to disk at the points where it is whole: a
// prompt sent, a turn over, a notice, an error

import type { CreateSessionOptions, Quote, SessionChange, SessionState } from '@shared/session';
import type { AgentHost } from './agent-host';
import type { SessionEvent } from './session';
import { addEdits, addError, addNotice, addUser, applyUpdate, endTurn, firstChange, uniqueIds } from './transcript';

type Host = Pick<AgentHost, 'stored' | 'info' | 'create' | 'prompt' | 'cancel' | 'answer' | 'setModel' | 'setEffort' | 'setMode' | 'rename' | 'delete' | 'saveItems'>;

export class SessionStates {
  private readonly states = new Map<string, SessionState>();

  constructor(
    private readonly host: Host,
    private readonly emit: (change: SessionChange) => void,
  ) {
    // a thought a crash left open is closed, a turn an earlier run left running is over, and an id stored twice is made
    // unique
    for (const s of host.stored()) {
      this.states.set(s.info.id, {
        info: s.info,
        items: uniqueIds(endTurn(s.items)),
        turnStartedAt: null,
        permissions: [],
        modes: s.modes,
        commands: s.commands ?? [],
        usage: null,
        lastMain: null,
      });
    }
  }

  // newest first
  list(): SessionState[] {
    return [...this.states.values()].sort((a, b) => b.info.createdAt - a.info.createdAt);
  }

  // the sessions whose turn is running
  running(): SessionState[] {
    return this.list().filter((s) => s.turnStartedAt !== null);
  }

  // starts the session's harness; a harness that cannot start leaves no session behind
  async create(options: CreateSessionOptions): Promise<SessionState> {
    const { info, modes, commands } = await this.host.create(options);
    const state: SessionState = { info, items: [], turnStartedAt: null, permissions: [], modes, commands, usage: null, lastMain: null };
    this.states.set(info.id, state);
    this.emit({ type: 'added', session: state });
    return state;
  }

  // the turn's progress arrives as changes; a prompt that cannot be sent ends in an error in the transcript
  async prompt(id: string, text: string, quotes: Quote[] = []): Promise<void> {
    const message = promptText(text, quotes);
    if (!message) throw new Error('There is nothing to send.');
    if (this.get(id).turnStartedAt !== null) throw new Error('A turn is already running in this session.');
    this.change(id, (s) => ({ items: addUser(s.items, message), turnStartedAt: Date.now() }), true);
    try {
      await this.host.prompt(id, message);
    } catch (cause) {
      this.change(id, (s) => ({ turnStartedAt: null, items: addError(s.items, 'The prompt could not be sent.', describe(cause)) }), true);
    }
    // the first prompt gives the session its title
    this.change(id, () => ({ info: this.host.info(id) }));
  }

  async cancel(id: string): Promise<void> {
    await this.host.cancel(id);
  }

  // a null option dismisses the request, which ACP calls cancelled
  answer(id: string, requestId: string, optionId: string | null): void {
    this.host.answer(id, requestId, optionId);
  }

  setModel(id: string, model: string): void {
    this.host.setModel(id, model);
    this.change(id, () => ({ info: this.host.info(id) }));
  }

  setEffort(id: string, effort: SessionState['info']['effort']): void {
    this.host.setEffort(id, effort);
    this.change(id, () => ({ info: this.host.info(id) }));
  }

  // modes belong to the running harness, so a dormant session's harness starts for this; a failure ends in the transcript
  async setMode(id: string, modeId: string): Promise<void> {
    try {
      await this.host.setMode(id, modeId);
      this.change(id, (s) => ({ info: this.host.info(id), modes: s.modes ? { ...s.modes, current: modeId } : s.modes }));
    } catch (cause) {
      this.change(id, (s) => ({ items: addError(s.items, 'The mode could not be changed.', describe(cause)) }), true);
    }
  }

  // an empty title changes nothing
  rename(id: string, title: string): void {
    this.host.rename(id, title);
    this.change(id, () => ({ info: this.host.info(id) }));
  }

  // stops the session's harness, if it runs, and removes wrontend's copy; the harness keeps its own history
  delete(id: string): void {
    this.host.delete(id);
    if (this.states.delete(id)) this.emit({ type: 'removed', id });
  }

  // what the harness and its process report, as the host passes it on
  apply(event: SessionEvent): void {
    const id = event.sessionId;
    switch (event.type) {
      case 'update': {
        const u = event.update;
        if (u.sessionUpdate === 'usage_update') return this.change(id, () => ({ usage: { used: u.used, size: u.size } }));
        if (u.sessionUpdate === 'current_mode_update') return this.change(id, (s) => (s.modes ? { modes: { ...s.modes, current: u.currentModeId } } : {}));
        if (u.sessionUpdate === 'available_commands_update') return this.change(id, () => ({ commands: u.availableCommands }));
        return this.change(id, (s) => ({ items: applyUpdate(s.items, u) }));
      }
      case 'turn-start':
        return this.change(id, (s) => ({ turnStartedAt: s.turnStartedAt ?? Date.now() }));
      case 'turn-end':
        return this.change(
          id,
          (s) => {
            // the turn's changed files sum it up, so a Stopped line or an error goes below them
            const ended = addEdits(endTurn(s.items), event.edits);
            let items = ended;
            if (event.stopReason === 'error') items = addError(ended, 'The turn ended with an error.', event.error ?? '');
            else if (event.stopReason === 'cancelled') items = addNotice(ended, 'Stopped');
            else if (event.stopReason === 'max_tokens') items = addNotice(ended, 'The reply hit the output token limit');
            return { turnStartedAt: null, permissions: [], items };
          },
          true,
        );
      case 'permission':
        return this.change(id, (s) => ({ permissions: [...s.permissions, event.request] }));
      case 'permission-closed':
        return this.change(id, (s) => ({ permissions: s.permissions.filter((p) => p.requestId !== event.requestId) }));
      case 'stats': {
        const { stats } = event;
        if (stats.kind !== 'main') return;
        return this.change(id, (s) => ({
          lastMain: stats,
          ...(stats.error && stats.status >= 400 ? { items: addError(s.items, 'The model request failed.', stats.error) } : {}),
        }));
      }
      // a reopened harness reports its default mode before the user's choice goes back on
      case 'modes':
        return this.change(id, (s) => ({ modes: { current: s.info.mode ?? event.current, available: event.available } }));
      case 'notice':
        return this.change(id, (s) => ({ items: addNotice(s.items, event.text) }), true);
      // a harness that ends on its own mid-turn is an error; the session stays and reopens on its next prompt
      case 'exit':
        return this.change(
          id,
          (s) => ({
            turnStartedAt: null,
            permissions: [],
            items: addError(endTurn(s.items), 'The harness process stopped.', `exit code ${event.code}\n\n${event.detail}`),
          }),
          true,
        );
    }
  }

  private get(id: string): SessionState {
    const state = this.states.get(id);
    if (!state) throw new Error(`no session ${id}`);
    return state;
  }

  // applies a change and sends it: the fields it set, and the transcript from its first changed item on. an event for a
  // session not known yet -- one still being created -- is dropped, since its creation brings what it said along
  private change(id: string, how: (s: SessionState) => Partial<SessionState>, save = false): void {
    const before = this.states.get(id);
    if (!before) return;
    const { items, ...fields } = how(before);
    const after: SessionState = { ...before, ...fields, items: items ?? before.items };
    this.states.set(id, after);
    const change: SessionChange = { type: 'updated', id, fields };
    if (after.items !== before.items) {
      const from = firstChange(before.items, after.items);
      change.items = { from, items: after.items.slice(from) };
    }
    if (Object.keys(fields).length > 0 || change.items) this.emit(change);
    if (save) this.host.saveItems(id, after.items);
  }
}

// each quote becomes a markdown quote followed by its reply, in the order they were written; the typed text comes last
export function promptText(text: string, quotes: Quote[]): string {
  const parts = quotes.map(({ quote, reply }) => {
    const quoted = quote
      .trim()
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n');
    return reply.trim() ? `${quoted}\n\n${reply.trim()}` : quoted;
  });
  if (text.trim()) parts.push(text.trim());
  return parts.join('\n\n');
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
