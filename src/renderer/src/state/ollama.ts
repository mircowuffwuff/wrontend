// Ollama's status and model list, as main reports them

import { create } from 'zustand';
import type { ModelSummary, OllamaStatus } from '@shared/ollama';
import { bridge } from '../bridge';

interface OllamaState {
  status: OllamaStatus | null;
  models: ModelSummary[];
  refreshModels(): Promise<void>;
}

export const useOllama = create<OllamaState>((set) => ({
  status: null,
  models: [],
  async refreshModels() {
    try {
      set({ models: await bridge.invoke('ollama:models') });
    } catch {
      set({ models: [] });
    }
  },
}));

export function startOllamaSync(): () => void {
  void bridge.invoke('ollama:status').then((status) => useOllama.setState({ status }));
  void useOllama.getState().refreshModels();
  return bridge.on('ollama:status', (status) => {
    const wasReachable = useOllama.getState().status?.reachable;
    useOllama.setState({ status });
    if (status.reachable && !wasReachable) void useOllama.getState().refreshModels();
  });
}
