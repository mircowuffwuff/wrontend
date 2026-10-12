// what the updater found out of date, as the renderer sees it

import type { ComponentState } from './components';

// the panel's groups, in the order it shows them
export const UPDATE_GROUPS = ['harnesses', 'ollama', 'models'] as const;
export type UpdateGroup = (typeof UPDATE_GROUPS)[number];

export interface UpdateEntry {
  // stable across checks: what a skip and a pin are kept under
  id: string;
  group: UpdateGroup;
  name: string;
  // null where nothing names the installed version
  current: string | null;
  available: string;
  // what the update downloads, where that is known before it starts
  bytes?: number;
  // the user keeps it as it is: shown muted, left out of Update All, and the icon does not count it
  pinned: boolean;
  // while it updates, and when the update failed
  state: ComponentState | null;
}

export interface UpdatesState {
  entries: UpdateEntry[];
  checking: boolean;
  // when the last check finished, in milliseconds since the epoch
  checkedAt: number | null;
  // the groups whose check failed, and why
  failures: { group: UpdateGroup; error: string }[];
}

// what colours the sidebar's icon
export function outdated(state: UpdatesState): UpdateEntry[] {
  return state.entries.filter((e) => !e.pinned);
}
