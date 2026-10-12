// where a packaged wrontend keeps its data. Electron's default, %APPDATA%\wrontend, survives moving or replacing the app's
// folder. a file named portable.txt or portable beside wrontend.exe asks for the data to travel with the folder instead,
// in a data folder next to the exe. an explicit --user-data-dir wins over both, and a development run is never portable

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

export const PORTABLE_MARKERS = ['portable.txt', 'portable'];

// the data folder a portable marker beside the exe asks for, or null
export function portableDataFolder(exe: string, exists: (path: string) => boolean = existsSync): string | null {
  const folder = dirname(exe);
  return PORTABLE_MARKERS.some((marker) => exists(join(folder, marker))) ? join(folder, 'data') : null;
}

// has to run before anything reads the userData path. Electron refuses a folder that does not exist yet
export function usePortableData(): void {
  if (!app.isPackaged || app.commandLine.hasSwitch('user-data-dir')) return;
  const folder = portableDataFolder(process.execPath);
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  app.setPath('userData', folder);
}
