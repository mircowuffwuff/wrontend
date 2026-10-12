// Back and Forward through the screens opened, as a browser keeps them -- in memory only, gone when the app closes

// a session's id, or null for the new-session screen
export type Screen = string | null;

export interface History {
  past: Screen[];
  future: Screen[];
}

export const NO_HISTORY: History = { past: [], future: [] };

// opening a screen ends whatever lay ahead, as following a link does
export function visit(history: History, current: Screen, next: Screen): History {
  if (next === current) return history;
  return { past: [...history.past, current], future: [] };
}

export function back(history: History, current: Screen): { history: History; screen: Screen } | null {
  if (history.past.length === 0) return null;
  const screen = history.past[history.past.length - 1];
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, screen };
}

export function forward(history: History, current: Screen): { history: History; screen: Screen } | null {
  if (history.future.length === 0) return null;
  const screen = history.future[0];
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, screen };
}

// a deleted session leaves the history; the screens either side of it can then meet, and one step between the same
// screen twice would go nowhere, so they merge
export function forget(history: History, current: Screen, id: string): History {
  const squeeze = (list: Screen[]) => {
    const out: Screen[] = [];
    for (const s of list) if (s !== id && (out.length === 0 || out[out.length - 1] !== s)) out.push(s);
    return out;
  };
  const past = squeeze(history.past);
  const future = squeeze(history.future);
  while (past.length > 0 && past[past.length - 1] === current) past.pop();
  while (future.length > 0 && future[0] === current) future.shift();
  return { past, future };
}
