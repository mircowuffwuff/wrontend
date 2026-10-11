// the contract between main and the renderer -- every channel, its arguments and its result

import type { ModelDetails, ModelSummary, OllamaStatus } from './ollama';
import type { Effort } from './proxy';
import type { CreatedSession, CreateSessionOptions, SessionEvent, StoredSession } from './session';

export interface InvokeMap {
  'window:minimize': { args: []; result: void };
  'window:toggle-maximize': { args: []; result: void };
  'dialog:pick-folder': { args: []; result: string | null };
  'app:autoprompt': { args: []; result: { harness: string; folder: string; model: string; text: string } | null };
  'ollama:status': { args: []; result: OllamaStatus };
  'ollama:models': { args: []; result: ModelSummary[] };
  'ollama:show': { args: [name: string]; result: ModelDetails | null };
  'session:stored': { args: []; result: StoredSession[] };
  'session:create': { args: [options: CreateSessionOptions]; result: CreatedSession };
  'session:save-items': { args: [id: string, items: unknown[]]; result: void };
  'session:delete': { args: [id: string]; result: void };
  'session:prompt': { args: [id: string, text: string]; result: void };
  'session:cancel': { args: [id: string]; result: void };
  'session:answer': { args: [id: string, requestId: string, optionId: string | null]; result: void };
  'session:set-model': { args: [id: string, model: string]; result: void };
  'session:set-effort': { args: [id: string, effort: Effort]; result: void };
  'session:set-mode': { args: [id: string, modeId: string]; result: void };
}

export interface EventMap {
  'ollama:status': OllamaStatus;
  'session:event': SessionEvent;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;

export interface WrontendBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeMap[K]['args']): Promise<InvokeMap[K]['result']>;
  // returns the function that unsubscribes
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
  platform: NodeJS.Platform;
}
