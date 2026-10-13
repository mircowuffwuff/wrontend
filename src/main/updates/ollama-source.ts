// Ollama's own updates: wrontend downloads and installs nothing for Ollama. its tray app checks ollama.com every hour,
// downloads a newer installer into updates_v2\<hash>\OllamaSetup.exe, and runs it the next time it starts hidden -- as at
// login, and as wrontend's Restart Ollama starts it. so the entry appears while such an installer waits, and its update is
// that restart. the version is what ollama.com offers the running Ollama: the tray app asks the same question

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { UpdateSource } from './updater';

const TIMEOUT_MS = 15_000;

export interface OllamaUpdateOptions {
  // the hash folder of an installer the tray app downloaded and waits to run; null where none waits, and for an Ollama
  // that is not on this computer
  waiting: () => Promise<string | null>;
  running: () => Promise<string>;
  // the version ollama.com offers in place of this one, or null when this one is the latest
  offered: (version: string) => Promise<string | null>;
  restart: () => Promise<void>;
}

export function ollamaUpdates(o: OllamaUpdateOptions): UpdateSource {
  return {
    group: 'ollama',
    async check() {
      const installer = await o.waiting();
      if (!installer) return [];
      const current = await o.running().catch(() => null);
      // the running version unknown, the installer is offered as it is; known and already the latest, it has nothing to bring
      const available = current ? await o.offered(current) : null;
      if (current && !available) return [];
      return [{ id: 'ollama', name: 'Ollama', current, available: available ?? `update ${installer.slice(0, 8)}`, component: 'ollama' }];
    },
    apply: () => o.restart(),
  };
}

// the hash folder holding a downloaded installer, if one waits
export function waitingInstaller(folder: string | null): string | null {
  if (!folder || !existsSync(folder)) return null;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory() && existsSync(join(folder, entry.name, 'OllamaSetup.exe'))) return entry.name;
  }
  return null;
}

// ollama.com answers 204 when the version asked about is current, and the release's installer URL when not:
// https://github.com/ollama/ollama/releases/download/v0.40.3/OllamaSetup.exe
export async function offeredVersion(version: string, arch = process.arch === 'arm64' ? 'arm64' : 'amd64'): Promise<string | null> {
  const url = `https://ollama.com/api/update?os=windows&arch=${arch}&version=${encodeURIComponent(version)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
    throw new Error('ollama.com could not be reached');
  });
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`ollama.com answered ${res.status}`);
  const { url: installer } = (await res.json()) as { url?: string };
  const tag = installer ? /\/v([^/]+)\/[^/]+$/.exec(installer) : null;
  if (!tag) throw new Error(`ollama.com offered an installer without a version: ${installer}`);
  return tag[1];
}
