// the choices on the new-session screen before the first prompt -- the last harness, model and effort are remembered

import { create } from 'zustand';
import type { Effort } from '@shared/proxy';

const KEY = 'wrontend.draft';

interface Remembered {
  harness: string | null;
  model: string | null;
  effort: Effort;
}

function load(): Remembered {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Remembered>;
    return { harness: saved.harness ?? null, model: saved.model ?? null, effort: saved.effort === 'off' ? 'off' : 'on' };
  } catch {
    return { harness: null, model: null, effort: 'on' };
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
  setHarness(harness: string): void;
  setModel(model: string): void;
  setEffort(effort: Effort): void;
  setFolder(folder: string): void;
}

export const useDraft = create<DraftState>((set, get) => {
  const remember = (change: Partial<Remembered>) => {
    set(change);
    const { harness, model, effort } = get();
    save({ harness, model, effort });
  };
  return {
    ...load(),
    folder: null,
    setHarness: (harness) => remember({ harness }),
    setModel: (model) => remember({ model }),
    setEffort: (effort) => remember({ effort }),
    setFolder(folder) {
      set({ folder });
    },
  };
});
