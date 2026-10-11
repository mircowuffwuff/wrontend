// every open session's transcript, turn state, pending permission and latest numbers

import { create } from 'zustand';
import type { Effort, RequestStats } from '@shared/proxy';
import type { CreateSessionOptions, PermissionRequest, SessionEvent, SessionInfo } from '@shared/session';
import { bridge } from '../bridge';
import { addError, addNotice, addUser, applyUpdate, endTurn, type TranscriptItem } from './transcript';

export interface SessionView {
  info: SessionInfo;
  items: TranscriptItem[];
  running: boolean;
  turnStartedAt: number | null;
  permissions: PermissionRequest[];
  lastMain: RequestStats | null;
  usage: { used: number; size: number } | null;
  exited: boolean;
}

interface SessionsState {
  sessions: Record<string, SessionView>;
  order: string[];
  activeId: string | null;
  creating: boolean;
  createAndPrompt(options: CreateSessionOptions, text: string): Promise<void>;
  prompt(id: string, text: string): Promise<void>;
  cancel(id: string): Promise<void>;
  answer(id: string, requestId: string, optionId: string | null): Promise<void>;
  setModel(id: string, model: string): Promise<void>;
  setEffort(id: string, effort: Effort): Promise<void>;
  open(id: string | null): void;
}

function patch(state: SessionsState, id: string, change: (s: SessionView) => Partial<SessionView>) {
  const s = state.sessions[id];
  if (!s) return {};
  return { sessions: { ...state.sessions, [id]: { ...s, ...change(s) } } };
}

export const useSessions = create<SessionsState>((set, get) => ({
  sessions: {},
  order: [],
  activeId: null,
  creating: false,

  async createAndPrompt(options, text) {
    set({ creating: true });
    try {
      const info = await bridge.invoke('session:create', options);
      const view: SessionView = {
        info,
        items: [],
        running: false,
        turnStartedAt: null,
        permissions: [],
        lastMain: null,
        usage: null,
        exited: false,
      };
      set((s) => ({ sessions: { ...s.sessions, [info.id]: view }, order: [info.id, ...s.order], activeId: info.id }));
      await get().prompt(info.id, text);
    } finally {
      set({ creating: false });
    }
  },

  async prompt(id, text) {
    set((s) => patch(s, id, (v) => ({ items: addUser(v.items, text), info: v.info.title === 'New session' ? { ...v.info, title: text.trim().split('\n')[0].slice(0, 80) } : v.info })));
    try {
      await bridge.invoke('session:prompt', id, text);
    } catch (cause) {
      set((s) => patch(s, id, (v) => ({ items: addError(v.items, 'The prompt could not be sent.', String(cause)) })));
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

  open(id) {
    set({ activeId: id });
  },
}));

function onEvent(event: SessionEvent): void {
  const id = event.sessionId;
  useSessions.setState((state) => {
    switch (event.type) {
      case 'update': {
        const u = event.update;
        if (u.sessionUpdate === 'usage_update') return patch(state, id, () => ({ usage: { used: u.used, size: u.size } }));
        return patch(state, id, (v) => ({ items: applyUpdate(v.items, u) }));
      }
      case 'turn-start':
        return patch(state, id, () => ({ running: true, turnStartedAt: Date.now() }));
      case 'turn-end':
        return patch(state, id, (v) => ({
          running: false,
          turnStartedAt: null,
          permissions: [],
          items:
            event.stopReason === 'error'
              ? addError(endTurn(v.items), 'The turn ended with an error.', event.error ?? '')
              : event.stopReason === 'cancelled'
                ? addNotice(v.items, 'Stopped')
                : event.stopReason === 'max_tokens'
                  ? addNotice(v.items, 'The reply hit the output token limit')
                  : endTurn(v.items),
        }));
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
      case 'exit':
        return patch(state, id, (v) => ({
          exited: true,
          running: false,
          items: addError(v.items, 'The harness process stopped.', `exit code ${event.code}\n\n${event.detail}`),
        }));
    }
  });
}

export function startSessionSync(): () => void {
  return bridge.on('session:event', onEvent);
}
