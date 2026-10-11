// wrontend's settings as main keeps them, whether the Settings dialog is open, and the appearance applied to the page

import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings';
import { bridge } from '../bridge';

interface SettingsState {
  settings: Settings;
  // the open section of the Settings dialog, or null while it is closed
  section: string | null;
  open(section?: string): void;
  close(): void;
  update(patch: SettingsPatch): Promise<void>;
}

export const useSettings = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  section: null,
  open: (section = 'general') => set({ section }),
  close: () => set({ section: null }),
  async update(patch) {
    set({ settings: await bridge.invoke('settings:set', patch) });
  },
}));

// the theme is main's to apply, since the native window buttons follow it; the rest is the page's
function apply({ appearance }: Settings): void {
  const root = document.documentElement;
  root.dataset.textSize = appearance.textSize;
  root.dataset.width = appearance.width;
  root.dataset.motion = appearance.motion;
}

export function startSettingsSync(): () => void {
  void bridge.invoke('settings:get').then((settings) => {
    useSettings.setState({ settings });
    apply(settings);
  });
  return bridge.on('settings:changed', (settings) => {
    useSettings.setState({ settings });
    apply(settings);
  });
}

// what invoke's rejection says, without Electron's wrapping around the thrower's message
export function errorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
