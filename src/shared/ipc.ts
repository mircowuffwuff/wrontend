// the contract between the main process and the renderer -- every channel, its arguments and its result

import type { HarnessEntry } from './components';
import type { PullEntry, RepoDetails, RepoSummary } from './models';
import type { ModelDetails, ModelEntry, OllamaStatus, RestartImpact } from './ollama';
import type { Effort } from './proxy';
import type { CreateSessionOptions, Quote, SessionChange, SessionDefaults, SessionState } from './session';
import type { AboutInfo, OllamaServerState, OllamaServerValues, Settings, SettingsPatch } from './settings';
import type { UpdatesState } from './updates';
import type { UsageSummary } from './usage';

export interface InvokeMap {
  // the system's folder picker; null when it was cancelled
  'dialog:pick-folder': { args: []; result: string | null };
  'app:about': { args: []; result: AboutInfo };
  'app:open-data-folder': { args: []; result: void };
  'settings:get': { args: []; result: Settings };
  // an Ollama address that does not parse is refused
  'settings:set': { args: [patch: SettingsPatch]; result: Settings };
  'ollama:status': { args: []; result: OllamaStatus };
  // Ollama's models with what wrontend does about their reasoning; wrontend's own copies are listed under their originals
  'ollama:models': { args: []; result: ModelEntry[] };
  // a model's capabilities, context length and lineage; null when Ollama does not have it or cannot be reached
  'ollama:show': { args: [name: string]; result: ModelDetails | null };
  // deletes a model from Ollama with wrontend's copy of it; refused while a session's turn runs on it or its copy is being
  // made. a session using it needs another model for its next prompt
  'ollama:delete': { args: [name: string]; result: void };
  // the address wrontend uses when Settings names none
  'ollama:default-address': { args: []; result: string };
  'ollama:server': { args: []; result: OllamaServerState };
  'ollama:set-server': { args: [changes: Partial<OllamaServerValues>]; result: OllamaServerState };
  // what a restart would cut off now, to ask about first; nothing while Ollama is not running
  'ollama:restart-impact': { args: []; result: RestartImpact };
  'ollama:restart': { args: []; result: void };
  // GGUF repos on Hugging Face, the most downloaded first; an empty query lists the most downloaded of all
  'models:search': { args: [query: string]; result: RepoSummary[] };
  // a repo's quants, each with its size and whether it fits on this machine
  'models:repo': { args: [repo: string]; result: RepoDetails };
  // downloads a model into Ollama; answers at once, and its progress arrives as models:pull-changed
  'models:pull': { args: [name: string]; result: void };
  'models:cancel-pull': { args: [name: string]; result: void };
  // the downloads under way, and the ones that failed
  'models:pulls': { args: []; result: PullEntry[] };
  // the harnesses to pick from, each with whether it is set up
  'harness:list': { args: []; result: HarnessEntry[] };
  // sets a harness up, or tries again after a failure; its progress arrives as harness:changed
  'harness:install': { args: [id: string]; result: void };
  // what is out of date, as the last check found it
  'updates:state': { args: []; result: UpdatesState };
  // checks again now; the result arrives as updates:changed
  'updates:check': { args: []; result: void };
  // answers at once: the update reports itself as updates:changed, and a failure stays on its entry
  'updates:install': { args: [id: string]; result: void };
  // every entry not pinned; Ollama's restart comes once the others are done
  'updates:install-all': { args: []; result: void };
  // drops the entry until a newer version than the one it offers appears
  'updates:skip': { args: [id: string]; result: void };
  'updates:pin': { args: [id: string, pinned: boolean]; result: void };
  // every session, newest first; session:changed keeps a copy of it in step
  'session:list': { args: []; result: SessionState[] };
  // what a new session starts with. picking a model makes its copy with a renderer, where it needs one; picking a harness
  // that is not set up sets it up
  'session:defaults': { args: []; result: SessionDefaults };
  'session:set-defaults': { args: [patch: Partial<SessionDefaults>]; result: SessionDefaults };
  // starts the session's harness in the folder; it becomes the new defaults
  'session:create': { args: [options: CreateSessionOptions]; result: SessionState };
  'session:rename': { args: [id: string, title: string]; result: void };
  'session:delete': { args: [id: string]; result: void };
  // the quotes go first, each with its reply, then the text. the turn's progress arrives as session:changed
  'session:prompt': { args: [id: string, text: string, quotes?: Quote[]]; result: void };
  'session:cancel': { args: [id: string]; result: void };
  // a null option dismisses the request
  'session:answer': { args: [id: string, requestId: string, optionId: string | null]; result: void };
  // applies from the session's next request; a copy with a renderer is made now, where the model needs one
  'session:set-model': { args: [id: string, model: string]; result: void };
  'session:set-effort': { args: [id: string, effort: Effort]; result: void };
  'session:set-mode': { args: [id: string, modeId: string]; result: void };
  // every session's usage summed up, deleted sessions' included
  'stats:summary': { args: []; result: UsageSummary };
}

export interface EventMap {
  'ollama:status': OllamaStatus;
  // wrontend is restarting Ollama: its being unreachable meanwhile is expected
  'ollama:restarting': boolean;
  'settings:changed': Settings;
  'session:changed': SessionChange;
  'session:defaults-changed': SessionDefaults;
  'harness:changed': HarnessEntry;
  // something about a model or its copy changed: the model list is worth reading again
  'ollama:models-changed': void;
  'models:pull-changed': PullEntry;
  'updates:changed': UpdatesState;
}

export type InvokeChannel = keyof InvokeMap;
export type EventChannel = keyof EventMap;

export interface WrontendBridge {
  // rejects with the message its handler in the main process threw
  invoke<K extends InvokeChannel>(channel: K, ...args: InvokeMap[K]['args']): Promise<InvokeMap[K]['result']>;
  // returns the function that unsubscribes
  on<K extends EventChannel>(channel: K, listener: (payload: EventMap[K]) => void): () => void;
  platform: NodeJS.Platform;
}
