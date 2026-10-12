// the model browser: whether it is open, and the downloads under way, which outlive it

import { create } from 'zustand';
import type { ComponentState } from '@shared/components';
import { bridge } from '../bridge';

interface BrowserState {
  open: boolean;
  // by model name: downloads under way and the ones that failed
  pulls: Record<string, ComponentState>;
  show(): void;
  close(): void;
}

export const useBrowser = create<BrowserState>((set) => ({
  open: false,
  pulls: {},
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function startPullSync(): () => void {
  void bridge.invoke('models:pulls').then((list) => useBrowser.setState({ pulls: Object.fromEntries(list.map((p) => [p.name, p.state])) }));
  return bridge.on('models:pull-changed', ({ name, state }) =>
    useBrowser.setState((s) => {
      const pulls = { ...s.pulls };
      if (state.status === 'installing' || state.status === 'failed') pulls[name] = state;
      else delete pulls[name];
      return { pulls };
    }),
  );
}

// the downloads a restart of Ollama would cut off
export function downloading(): string[] {
  return Object.entries(useBrowser.getState().pulls)
    .filter(([, state]) => state.status === 'installing')
    .map(([name]) => name);
}
