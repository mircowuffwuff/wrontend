// the sidebar's own state: whether it shows and which folder groups are collapsed, both remembered, and the search

import { create } from 'zustand';
import type { SessionInfo } from '@shared/session';

const KEY = 'wrontend.sidebar';

interface Remembered {
  hidden: boolean;
  // folder ids
  collapsed: string[];
}

function load(): Remembered {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { hidden: saved.hidden === true, collapsed: Array.isArray(saved.collapsed) ? saved.collapsed.filter((c) => typeof c === 'string') : [] };
  } catch {
    return { hidden: false, collapsed: [] };
  }
}

function save(r: Remembered): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // storage can be unavailable; the layout then lasts until the app closes
  }
}

interface SidebarState extends Remembered {
  query: string;
  toggle(): void;
  toggleGroup(folderId: string): void;
  search(query: string): void;
}

export const useSidebar = create<SidebarState>((set, get) => {
  const remember = (change: Partial<Remembered>) => {
    set(change);
    const { hidden, collapsed } = get();
    save({ hidden, collapsed });
  };
  return {
    ...load(),
    query: '',
    toggle: () => remember({ hidden: !get().hidden }),
    toggleGroup(folderId) {
      const { collapsed } = get();
      remember({ collapsed: collapsed.includes(folderId) ? collapsed.filter((c) => c !== folderId) : [...collapsed, folderId] });
    },
    search: (query) => set({ query }),
  };
});

export function folderName(folder: string): string {
  return folder.split(/[\\/]/).pop() ?? folder;
}

export interface Group {
  folderId: string;
  folder: string;
  ids: string[];
}

// the sessions grouped by folder, the folder with the newest session first. a search keeps the sessions whose title or
// folder name holds it, and a group left with none goes
export function groupSessions(infos: SessionInfo[], query: string): Group[] {
  const q = query.trim().toLowerCase();
  const groups = new Map<string, Group>();
  for (const info of infos) {
    if (q && !info.title.toLowerCase().includes(q) && !folderName(info.folder).toLowerCase().includes(q)) continue;
    const group = groups.get(info.folderId) ?? { folderId: info.folderId, folder: info.folder, ids: [] };
    group.ids.push(info.id);
    groups.set(info.folderId, group);
  }
  return [...groups.values()];
}
