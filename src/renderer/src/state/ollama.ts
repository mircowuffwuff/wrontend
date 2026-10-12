// Ollama's status and model list, as main reports them

import { create } from 'zustand';
import type { ModelEntry, OllamaStatus } from '@shared/ollama';
import { bridge } from '../bridge';

interface OllamaState {
  status: OllamaStatus | null;
  models: ModelEntry[];
  // wrontend is restarting Ollama: its being unreachable meanwhile is expected
  restarting: boolean;
  refreshModels(): Promise<void>;
}

// a copy being made changes the list several times in a row; only the latest read is kept
let reads = 0;

export const useOllama = create<OllamaState>((set) => ({
  status: null,
  models: [],
  restarting: false,
  async refreshModels() {
    const read = ++reads;
    const models = await bridge.invoke('ollama:models').catch(() => []);
    if (read === reads) set({ models });
  },
}));

export function startOllamaSync(): () => void {
  void bridge.invoke('ollama:status').then((status) => useOllama.setState({ status }));
  void useOllama.getState().refreshModels();
  const offRestarting = bridge.on('ollama:restarting', (restarting) => useOllama.setState({ restarting }));
  const offModels = bridge.on('ollama:models-changed', () => void useOllama.getState().refreshModels());
  const offStatus = bridge.on('ollama:status', (status) => {
    const wasReachable = useOllama.getState().status?.reachable;
    useOllama.setState({ status });
    if (status.reachable && !wasReachable) void useOllama.getState().refreshModels();
  });
  return () => {
    offRestarting();
    offModels();
    offStatus();
  };
}
