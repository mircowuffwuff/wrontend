// wrontend's own settings, kept in one JSON file in its data folder

import { BACKGROUND_POLICIES, type BackgroundPolicy } from './proxy';

// the values a choice may take; a settings file holding anything else gets the default back
export const CHOICES = {
  appearance: {
    theme: ['system', 'light', 'dark'],
    textSize: ['small', 'medium', 'large'],
    width: ['narrow', 'medium', 'wide'],
    motion: ['system', 'reduced'],
  },
  proxy: {
    backgroundPolicy: BACKGROUND_POLICIES,
  },
} as const;

type Choice<S extends keyof typeof CHOICES, K extends keyof (typeof CHOICES)[S]> = (typeof CHOICES)[S][K] extends readonly (infer V)[] ? V : never;

export interface Settings {
  appearance: {
    theme: Choice<'appearance', 'theme'>;
    textSize: Choice<'appearance', 'textSize'>;
    width: Choice<'appearance', 'width'>;
    motion: Choice<'appearance', 'motion'>;
  };
  ollama: {
    // where wrontend finds Ollama; empty means OLLAMA_HOST, or Ollama's own default
    address: string;
  };
  proxy: {
    backgroundPolicy: BackgroundPolicy;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  appearance: { theme: 'system', textSize: 'medium', width: 'medium', motion: 'system' },
  ollama: { address: '' },
  proxy: { backgroundPolicy: 'local-titles' },
};

export type SettingsPatch = { [K in keyof Settings]?: Partial<Settings[K]> };

export interface AboutInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  dataFolder: string;
  sessions: number;
}
