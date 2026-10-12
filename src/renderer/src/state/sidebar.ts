// the sidebar's own state: whether it shows, remembered

import { create } from 'zustand';

const KEY = 'wrontend.sidebar';

interface Remembered {
  hidden: boolean;
}

function load(): Remembered {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { hidden: saved.hidden === true };
  } catch {
    return { hidden: false };
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
}

export const useSidebar = create<SidebarState>((set, get) => {
  const remember = (change: Partial<Remembered>) => {
    set(change);
    const { hidden } = get();
    save({ hidden });
  };
  return {
    ...load(),
    toggle: () => remember({ hidden: !get().hidden }),
  };
});
