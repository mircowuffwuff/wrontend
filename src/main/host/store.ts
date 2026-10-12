// wrontend's records on disk: a directory per project folder and one per session, each holding its record as JSON beside
// whatever else belongs to it. a session names its project folder by id; a project folder lists none of its sessions,
// which are found by their link instead, so there is no second list to fall out of step
//
//   folders/<folder id>/folder.json
//   sessions/<session id>/session.json
//   sessions/<session id>/usage.jsonl -- outlives its session: a deleted session's measurements still count
//
// records are written whole and atomically, so a crash mid-write leaves the previous version, never half a file

import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredSession } from '@shared/session';

export interface FolderRecord {
  id: string;
  path: string;
  createdAt: number;
}

// a session as it is written: its project folder only by id, the path coming from the folder's record when it is read
export type SessionRecord = Omit<StoredSession, 'info'> & { info: Omit<StoredSession['info'], 'folder'> };

const USAGE = 'usage.jsonl';

export class FolderStore {
  private readonly folders = new Map<string, FolderRecord>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    for (const id of directories(dir)) {
      const folder = readJson<FolderRecord>(join(dir, id, 'folder.json'));
      if (folder) this.folders.set(folder.id, folder);
    }
  }

  get(id: string): FolderRecord | undefined {
    return this.folders.get(id);
  }

  // the record for this path, made the first time the path is seen. Windows paths compare without case, as Windows does
  ensure(path: string): FolderRecord {
    const key = pathKey(path);
    for (const folder of this.folders.values()) if (pathKey(folder.path) === key) return folder;
    const folder: FolderRecord = { id: randomUUID(), path, createdAt: Date.now() };
    mkdirSync(join(this.dir, folder.id), { recursive: true });
    writeWhole(join(this.dir, folder.id, 'folder.json'), folder);
    this.folders.set(folder.id, folder);
    return folder;
  }
}

export class SessionStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  // a session directory without a session.json is a deleted session whose usage is kept, and is not listed
  list(): SessionRecord[] {
    const sessions: SessionRecord[] = [];
    for (const id of directories(this.dir)) {
      const session = readJson<SessionRecord>(join(this.dir, id, 'session.json'));
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => b.info.createdAt - a.info.createdAt);
  }

  save(session: SessionRecord): void {
    const dir = this.sessionDir(session.info.id);
    mkdirSync(dir, { recursive: true });
    writeWhole(join(dir, 'session.json'), session);
  }

  // everything the session keeps goes except its usage, which the stats go on counting. a session that used nothing
  // leaves no directory behind
  remove(id: string): void {
    const dir = this.sessionDir(id);
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) if (name !== USAGE) rmSync(join(dir, name), { recursive: true, force: true });
    if (!names.includes(USAGE)) rmdirSync(dir);
  }

  private sessionDir(id: string): string {
    if (!/^[a-f0-9-]+$/i.test(id)) throw new Error(`not a session id: ${id}`);
    return join(this.dir, id);
  }
}

function pathKey(path: string): string {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function directories(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

// a record that is missing or does not parse reads as nothing; it is never deleted, since it may be repairable by hand
function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeWhole(file: string, value: unknown): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(value));
  renameSync(temp, file);
}
