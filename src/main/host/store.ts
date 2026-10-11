// sessions on disk: one JSON file per session in wrontend's data folder, written whole and atomically

import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StoredSession } from '@shared/session';

export class SessionStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  list(): StoredSession[] {
    const sessions: StoredSession[] = [];
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json')) continue;
      try {
        sessions.push(JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as StoredSession);
      } catch {
        // a file that does not parse is skipped, never deleted: it may be repairable by hand
      }
    }
    return sessions.sort((a, b) => b.info.createdAt - a.info.createdAt);
  }

  read(id: string): StoredSession | null {
    try {
      return JSON.parse(readFileSync(this.file(id), 'utf8')) as StoredSession;
    } catch {
      return null;
    }
  }

  // a crash mid-write leaves the previous version, never half a file
  save(session: StoredSession): void {
    const target = this.file(session.info.id);
    const temp = `${target}.tmp`;
    writeFileSync(temp, JSON.stringify(session));
    renameSync(temp, target);
  }

  remove(id: string): void {
    rmSync(this.file(id), { force: true });
  }

  private file(id: string): string {
    if (!/^[a-f0-9-]+$/i.test(id)) throw new Error(`not a session id: ${id}`);
    return join(this.dir, `${id}.json`);
  }
}
