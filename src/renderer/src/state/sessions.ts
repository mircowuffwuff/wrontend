// every session's transcript, turn state, pending permission and latest numbers -- and their copy on disk

import { create } from 'zustand';
import type { AvailableCommand, SessionMode } from '@agentclientprotocol/sdk';
import type { Effort, RequestStats } from '@shared/proxy';
import type { CreateSessionOptions, PermissionRequest, SessionEvent, SessionInfo } from '@shared/session';
import { bridge } from '../bridge';
import { back, forget, forward, NO_HISTORY, visit, type History } from './history';
import { addEdits, addError, addNotice, addUser, applyUpdate, endTurn, type TranscriptItem } from './transcript';

export interface SessionView {
  info: SessionInfo;
  items: TranscriptItem[];
  running: boolean;
  turnStartedAt: number | null;
  permissions: PermissionRequest[];
  lastMain: RequestStats | null;
  usage: { used: number; size: number } | null;
  // what the harness offers; empty until its process has started
  modes: { current: string; available: SessionMode[] };
  // the harness's slash commands; empty until it has reported them
  commands: AvailableCommand[];
}

interface SessionsState {
  sessions: Record<string, SessionView>;
  order: string[];
  activeId: string | null;
  history: History;
  creating: boolean;
  loaded: boolean;
  load(): Promise<void>;
  createAndPrompt(options: CreateSessionOptions, text: string): Promise<void>;
  prompt(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
  answer(id: string, requestId: string, optionId: string | null): Promise<void>;
  setModel(id: string, model: string): Promise<void>;
  setEffort(id: string, effort: Effort): Promise<void>;
  setMode(id: string, modeId: string): Promise<void>;
  rename(id: string, title: string): Promise<void>;
  remove(id: string): Promise<void>;
  open(id: string | null): void;
  back(): void;
  forward(): void;
}

function view(info: SessionInfo, items: TranscriptItem[] = []): SessionView {
  return { info, items, running: false, turnStartedAt: null, permissions: [], lastMain: null, usage: null, modes: { current: info.mode ?? '', available: [] }, commands: [] };
}

function patch(state: SessionsState, id: string, change: (s: SessionView) => Partial<SessionView>): Partial<SessionsState> {
  const s = state.sessions[id];
  if (!s) return {};
  return { sessions: { ...state.sessions, [id]: { ...s, ...change(s) } } };
}

function titleFrom(text: string): string {
  return text.trim().split('\n')[0].slice(0, 80);
}

// the transcript goes to disk at the points where it is whole: a sent prompt, a finished turn
function persist(id: string): void {
  const s = useSessions.getState().sessions[id];
  if (s) void bridge.invoke('session:save-items', id, s.items).catch(() => {});
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: {},
  order: [],
  activeId: null,
  history: NO_HISTORY,
  creating: false,
  loaded: false,

  async load() {
    const stored = await bridge.invoke('session:stored');
    const sessions: Record<string, SessionView> = {};
    for (const s of stored) {
      sessions[s.info.id] = { ...view(s.info, endTurn(s.items as TranscriptItem[])), modes: s.modes ?? { current: s.info.mode ?? '', available: [] }, commands: s.commands ?? [] };
    }
    set((state) => ({
      sessions: { ...sessions, ...state.sessions },
      order: [...state.order, ...stored.map((s) => s.info.id).filter((id) => !state.sessions[id])],
      loaded: true,
    }));
  },

  async createAndPrompt(options, text) {
    set({ creating: true });
    try {
      const { info, modes, commands } = await bridge.invoke('session:create', options);
      const created = { ...view(info), modes: modes ?? { current: '', available: [] }, commands };
      set((s) => ({ sessions: { ...s.sessions, [info.id]: created }, order: [info.id, ...s.order], activeId: info.id, history: visit(s.history, s.activeId, info.id) }));
      await get().prompt(info.id, text);
    } catch (cause) {
      throw cause;
    } finally {
      set({ creating: false });
    }
  },

  async prompt(id, text) {
    set((s) =>
      patch(s, id, (v) => ({
        items: addUser(v.items, text),
        info: v.info.title === 'New session' ? { ...v.info, title: titleFrom(text) } : v.info,
        running: true,
        turnStartedAt: Date.now(),
      })),
    );
    persist(id);
    try {
      await bridge.invoke('session:prompt', id, text);
    } catch (cause) {
      set((s) => patch(s, id, (v) => ({ running: false, turnStartedAt: null, items: addError(v.items, 'The prompt could not be sent.', String(cause)) })));
      persist(id);
    }
  },

  async cancel(id) {
    await bridge.invoke('session:cancel', id);
  },

  async answer(id, requestId, optionId) {
    await bridge.invoke('session:answer', id, requestId, optionId);
  },

  async setModel(id, model) {
    await bridge.invoke('session:set-model', id, model);
    set((s) => patch(s, id, (v) => ({ info: { ...v.info, model } })));
  },

  async setEffort(id, effort) {
    await bridge.invoke('session:set-effort', id, effort);
    set((s) => patch(s, id, (v) => ({ info: { ...v.info, effort } })));
  },

  async setMode(id, modeId) {
    try {
      await bridge.invoke('session:set-mode', id, modeId);
      set((s) => patch(s, id, (v) => ({ info: { ...v.info, mode: modeId }, modes: { ...v.modes, current: modeId } })));
    } catch (cause) {
      set((s) => patch(s, id, (v) => ({ items: addError(v.items, 'The mode could not be changed.', String(cause)) })));
    }
  },

  // shown at once, so the field does not give way to the old title first; put back if main cannot keep it
  async rename(id, title) {
    const before = get().sessions[id]?.info.title;
    set((s) => patch(s, id, (v) => ({ info: { ...v.info, title } })));
    try {
      await bridge.invoke('session:rename', id, title);
    } catch {
      if (before !== undefined) set((s) => patch(s, id, (v) => ({ info: { ...v.info, title: before } })));
    }
  },

  async remove(id) {
    await bridge.invoke('session:delete', id);
    set((s) => {
      const sessions = { ...s.sessions };
      delete sessions[id];
      const activeId = s.activeId === id ? null : s.activeId;
      return { sessions, order: s.order.filter((o) => o !== id), activeId, history: forget(s.history, activeId, id) };
    });
  },

  open(id) {
    set((s) => ({ activeId: id, history: visit(s.history, s.activeId, id) }));
  },

  back() {
    set((s) => {
      const step = back(s.history, s.activeId);
      return step ? { activeId: step.screen, history: step.history } : {};
    });
  },

  forward() {
    set((s) => {
      const step = forward(s.history, s.activeId);
      return step ? { activeId: step.screen, history: step.history } : {};
    });
  },
}));

function onEvent(event: SessionEvent): void {
  const id = event.sessionId;
  let save = false;
  useSessions.setState((state) => {
    switch (event.type) {
      case 'update': {
        const u = event.update;
        if (u.sessionUpdate === 'usage_update') return patch(state, id, () => ({ usage: { used: u.used, size: u.size } }));
        if (u.sessionUpdate === 'current_mode_update') return patch(state, id, (v) => ({ modes: { ...v.modes, current: u.currentModeId } }));
        if (u.sessionUpdate === 'available_commands_update') return patch(state, id, () => ({ commands: u.availableCommands }));
        return patch(state, id, (v) => ({ items: applyUpdate(v.items, u) }));
      }
      case 'turn-start':
        return patch(state, id, (v) => ({ running: true, turnStartedAt: v.turnStartedAt ?? Date.now() }));
      case 'turn-end':
        save = true;
        return patch(state, id, (v) => {
          // the card of changed files sums up the turn, so a Stopped line or an error goes below it
          const ended = addEdits(endTurn(v.items), event.edits);
          return {
            running: false,
            turnStartedAt: null,
            permissions: [],
            items:
              event.stopReason === 'error'
                ? addError(ended, 'The turn ended with an error.', event.error ?? '')
                : event.stopReason === 'cancelled'
                  ? addNotice(ended, 'Stopped')
                  : event.stopReason === 'max_tokens'
                    ? addNotice(ended, 'The reply hit the output token limit')
                    : ended,
          };
        });
      case 'permission':
        return patch(state, id, (v) => ({ permissions: [...v.permissions, event.request] }));
      case 'permission-closed':
        return patch(state, id, (v) => ({ permissions: v.permissions.filter((p) => p.requestId !== event.requestId) }));
      case 'stats':
        if (event.stats.kind !== 'main') return {};
        return patch(state, id, (v) => ({
          lastMain: event.stats,
          items: event.stats.error && event.stats.status >= 400 ? addError(v.items, 'The model request failed.', event.stats.error) : v.items,
        }));
      case 'modes':
        return patch(state, id, (v) => ({ modes: { current: v.info.mode ?? event.current, available: event.available } }));
      case 'notice':
        save = true;
        return patch(state, id, (v) => ({ items: addNotice(v.items, event.text) }));
      case 'exit':
        save = true;
        // a harness that ends on its own mid-turn is an error; the session itself stays and reopens on its next prompt
        return patch(state, id, (v) => ({
          running: false,
          turnStartedAt: null,
          permissions: [],
          items: addError(endTurn(v.items), 'The harness process stopped.', `exit code ${event.code}\n\n${event.detail}`),
        }));
    }
  });
  if (save) persist(id);
}

export function startSessionSync(): () => void {
  const stop = bridge.on('session:event', onEvent);
  void useSessions.getState().load();
  return stop;
}
