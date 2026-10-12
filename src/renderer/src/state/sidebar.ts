// the sidebar's own state: whether it shows and which folder groups are collapsed, both remembered

import { create } from 'zustand';

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
  toggle(): void;
  toggleGroup(folderId: string): void;
}

export const useSidebar = create<SidebarState>((set, get) => {
  const remember = (change: Partial<Remembered>) => {
    set(change);
    const { hidden, collapsed } = get();
    save({ hidden, collapsed });
  };
  return {
    ...load(),
    toggle: () => remember({ hidden: !get().hidden }),
    toggleGroup(folderId) {
      const { collapsed } = get();
      remember({ collapsed: collapsed.includes(folderId) ? collapsed.filter((c) => c !== folderId) : [...collapsed, folderId] });
    },
  };
});

export function folderName(folder: string): string {
  return folder.split(/[\\/]/).pop() ?? folder;
}
