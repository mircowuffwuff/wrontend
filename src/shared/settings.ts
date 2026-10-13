// wrontend's own settings, kept in one JSON file in its data folder, and Ollama's server settings, which live elsewhere

import { BACKGROUND_POLICIES, type BackgroundPolicy } from './proxy';

// the values a choice may take; a settings file holding anything else gets the default back
export const CHOICES = {
  appearance: {
    theme: ['system', 'light', 'dark'],
  },
  proxy: {
    backgroundPolicy: BACKGROUND_POLICIES,
  },
} as const;

type Choice<S extends keyof typeof CHOICES, K extends keyof (typeof CHOICES)[S]> = (typeof CHOICES)[S][K] extends readonly (infer V)[] ? V : never;

export interface Settings {
  appearance: {
    // the main process applies it to the whole app: the page's prefers-color-scheme and the native parts of the window follow
    theme: Choice<'appearance', 'theme'>;
  };
  ollama: {
    // where wrontend finds Ollama; empty means OLLAMA_HOST, or Ollama's own default
    address: string;
  };
  models: {
    // a thinking model without a renderer is routed to a copy of it with one, where wrontend knows the renderer
    derive: boolean;
  };
  proxy: {
    backgroundPolicy: BackgroundPolicy;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: 'system' },
  ollama: { address: '' },
  models: { derive: true },
  proxy: { backgroundPolicy: 'local-titles' },
};

export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

// the server settings Ollama reads from its environment at start, so each needs a restart.
// they are the user's environment variables, where Ollama's docs put them and where its tray app finds them too
export const OLLAMA_SERVER_VARS = [
  'OLLAMA_MODELS',
  'OLLAMA_CONTEXT_LENGTH',
  'OLLAMA_NUM_PARALLEL',
  'OLLAMA_FLASH_ATTENTION',
  'OLLAMA_KV_CACHE_TYPE',
  'OLLAMA_KEEP_ALIVE',
] as const;

export type OllamaServerVar = (typeof OLLAMA_SERVER_VARS)[number];

// null is unset: Ollama uses its own default
export type OllamaServerValues = Record<OllamaServerVar, string | null>;

export interface OllamaServerState {
  // null when wrontend can store them and restart Ollama here; otherwise why not
  unsupported: string | null;
  values: OllamaServerValues;
  // saved since Ollama last started, so not yet in effect
  pending: OllamaServerVar[];
}

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  dataFolder: string;
  sessions: number;
}
