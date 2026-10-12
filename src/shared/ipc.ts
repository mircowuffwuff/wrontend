// the contract between main and the renderer -- every channel, its arguments and its result

import type { HarnessEntry } from './components';
import type { PullEntry, RepoDetails, RepoSummary } from './models';
import type { ModelDetails, ModelEntry, OllamaStatus } from './ollama';
import type { Effort } from './proxy';
import type { CreatedSession, CreateSessionOptions, SessionEvent, StoredSession } from './session';
import type { AboutInfo, OllamaServerState, OllamaServerValues, Settings, SettingsPatch } from './settings';
import type { UpdatesState } from './updates';

export interface InvokeMap {
  'window:minimize': { args: []; result: void };
  'window:toggle-maximize': { args: []; result: void };
  'dialog:pick-folder': { args: []; result: string | null };
  'app:autoprompt': { args: []; result: { harness: string; folder: string; model: string; text: string } | null };
  'app:about': { args: []; result: AboutInfo };
  'app:open-data-folder': { args: []; result: void };
  'settings:get': { args: []; result: Settings };
  'settings:set': { args: [patch: SettingsPatch]; result: Settings };
  'ollama:status': { args: []; result: OllamaStatus };
  // Ollama's models with what wrontend does about their reasoning; wrontend's own copies are listed under their originals
  'ollama:models': { args: []; result: ModelEntry[] };
  // a model was picked: its copy with a renderer is made now, where it needs one, rather than on the first request
  'ollama:prepare': { args: [name: string]; result: void };
  'ollama:show': { args: [name: string]; result: ModelDetails | null };
  // deletes a model from Ollama with wrontend's copy of it; refused while a session is working with it
  'ollama:delete': { args: [name: string]; result: void };
  // the address wrontend uses when Settings names none
  'ollama:default-address': { args: []; result: string };
  'ollama:server': { args: []; result: OllamaServerState };
  'ollama:set-server': { args: [changes: Partial<OllamaServerValues>]; result: OllamaServerState };
  'ollama:restart': { args: []; result: void };
  // the model browser: GGUF repos on Hugging Face, the most downloaded first
  'models:search': { args: [query: string]; result: RepoSummary[] };
  // a repo's quants, each with its size and whether it fits on this machine
  'models:repo': { args: [repo: string]; result: RepoDetails };
  // downloads a model into Ollama; its progress arrives as models:pull-changed
  'models:pull': { args: [name: string]; result: void };
  'models:cancel-pull': { args: [name: string]; result: void };
  // the downloads under way, and the ones that failed
  'models:pulls': { args: []; result: PullEntry[] };
  // the harnesses to pick from, each with whether it is set up
  'harness:list': { args: []; result: HarnessEntry[] };
  // sets a harness up; its progress arrives as harness:changed
  'harness:install': { args: [id: string]; result: void };
  // what is out of date, as the last check found it
  'updates:state': { args: []; result: UpdatesState };
  // checks again now; the result arrives as updates:changed
  'updates:check': { args: []; result: void };
  // answers at once: the update reports itself as updates:changed, and a failure stays on its row
  'updates:install': { args: [id: string]; result: void };
  // every row not pinned; Ollama's restart comes once the others are done
  'updates:install-all': { args: []; result: void };
  // hides the row until a newer version than the one it offers appears
  'updates:skip': { args: [id: string]; result: void };
  'updates:pin': { args: [id: string, pinned: boolean]; result: void };
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
  'ollama:restarting': boolean;
  'settings:changed': Settings;
  'session:event': SessionEvent;
  'harness:changed': HarnessEntry;
  // something about a model's copy changed: the model list is read again
  'ollama:models-changed': void;
  'models:pull-changed': PullEntry;
  'updates:changed': UpdatesState;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;

export interface WrontendBridge {
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeMap[K]['args']): Promise<InvokeMap[K]['result']>;
  // returns the function that unsubscribes
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
  platform: NodeJS.Platform;
}
