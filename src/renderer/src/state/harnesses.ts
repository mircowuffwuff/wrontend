// the harnesses to pick from and whether each is set up, as main reports them

import { create } from 'zustand';
import type { HarnessEntry } from '@shared/components';
import { bridge } from '../bridge';

interface HarnessesState {
  list: HarnessEntry[];
  // sets a harness up; a failure arrives as its state
  install(id: string): Promise<void>;
}

export const useHarnesses = create<HarnessesState>(() => ({
  list: [],
  install: (id) => bridge.invoke('harness:install', id),
}));

export function startHarnessSync(): () => void {
  void bridge.invoke('harness:list').then((list) => useHarnesses.setState({ list }));
  return bridge.on('harness:changed', (entry) =>
    useHarnesses.setState((s) => ({ list: s.list.map((h) => (h.id === entry.id ? entry : h)) })),
  );
}

export function isReady(entry: HarnessEntry | undefined): boolean {
  return entry?.state.status === 'installed';
}
