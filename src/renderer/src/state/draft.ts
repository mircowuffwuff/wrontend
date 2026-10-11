// the choices on the new-session screen before the first prompt -- the last model and effort are remembered

import { create } from 'zustand';
import type { Effort } from '@shared/proxy';

const KEY = 'wrontend.draft';

interface Remembered {
  model: string | null;
  effort: Effort;
}

function load(): Remembered {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { model: saved.model ?? null, effort: saved.effort === 'off' ? 'off' : 'on' };
  } catch {
    return { model: null, effort: 'on' };
  }
}

function save(r: Remembered): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    // storage can be unavailable; the choice then lasts until the app closes
  }
}

interface DraftState extends Remembered {
  folder: string | null;
  setModel(model: string): void;
  setEffort(effort: Effort): void;
  setFolder(folder: string): void;
}

export const useDraft = create<DraftState>((set, get) => ({
  ...load(),
  folder: null,
  setModel(model) {
    set({ model });
    save({ model, effort: get().effort });
  },
  setEffort(effort) {
    set({ effort });
    save({ model: get().model, effort });
  },
  setFolder(folder) {
    set({ folder });
  },
}));
