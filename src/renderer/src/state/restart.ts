// a restart of Ollama cuts off every reply being written and every download: it asks first when anything is under way, and
// goes ahead without asking when nothing is. Settings' Restart Ollama and the updater's Update and Restart both ask here

import { downloading } from './browser';
import { confirm } from './confirm';
import { useOllama } from './ollama';
import { useSessions } from './sessions';

export async function confirmRestart(title: string, action: string): Promise<boolean> {
  if (!useOllama.getState().status?.reachable) return true;
  const working = Object.values(useSessions.getState().sessions).filter((s) => s.running);
  const pulls = downloading();
  if (working.length + pulls.length === 0) return true;
  let message = 'These replies and downloads stop. A download goes on from where it stopped when started again:';
  if (pulls.length === 0) message = working.length === 1 ? 'This session is working, and its reply stops:' : 'These sessions are working, and their replies stop:';
  else if (working.length === 0) message = `${pulls.length === 1 ? 'This download stops' : 'These downloads stop'}. A download goes on from where it stopped when started again:`;
  return confirm({ title, message, items: [...working.map((s) => s.info.title), ...pulls.map((name) => `Downloading ${name}`)], action });
}
