// the updater panel: whether it is open, and what main last found out of date

import { create } from 'zustand';
import type { UpdatesState } from '@shared/updates';
import { bridge } from '../bridge';

interface UpdaterState {
  open: boolean;
  updates: UpdatesState;
  show(): void;
  close(): void;
}

export const useUpdates = create<UpdaterState>((set) => ({
  open: false,
  updates: { entries: [], checking: false, checkedAt: null, failures: [] },
  show: () => set({ open: true }),
  close: () => set({ open: false }),
}));

export function startUpdatesSync(): () => void {
  void bridge.invoke('updates:state').then((updates) => useUpdates.setState({ updates }));
  return bridge.on('updates:changed', (updates) => useUpdates.setState({ updates }));
}
