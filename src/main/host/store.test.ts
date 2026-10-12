import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ProxyServer } from '../proxy/server';
import { tempFolder } from '../temp-folder';
import { AgentHost } from './agent-host';
import { FolderStore, SessionStore, type SessionRecord } from './store';

const ID = '0f8e7a3c-5b1d-4c2e-9a6f-1d2e3f4a5b6c';
const OTHER = '9a6f1d2e-3f4a-4b6c-8f8e-7a3c5b1d4c2e';

function record(id: string, folderId: string, createdAt = 1): SessionRecord {
  return {
    info: { id, harness: 'fake', folderId, model: 'm', effort: 'on', title: 'A session', createdAt },
    harnessSessionId: null,
    modes: null,
    items: [{ kind: 'user', text: 'hello' }],
  };
}

describe('project folders on disk', () => {
  it('makes a record the first time a path is seen and finds it again after a restart', () => {
    const dir = tempFolder('wrontend-folders-');
    const first = new FolderStore(dir).ensure('C:\\work\\project');
    expect(existsSync(join(dir, first.id, 'folder.json'))).toBe(true);
    const again = new FolderStore(dir);
    expect(again.ensure('C:\\work\\project').id).toBe(first.id);
    expect(again.get(first.id)?.path).toBe('C:\\work\\project');
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it.runIf(process.platform === 'win32')('takes a path that differs only in case for the same folder, as Windows does', () => {
    const folders = new FolderStore(tempFolder('wrontend-folders-'));
    expect(folders.ensure('c:\\WORK\\Project').id).toBe(folders.ensure('C:\\work\\project').id);
  });

  it('gives different paths different records', () => {
    const folders = new FolderStore(tempFolder('wrontend-folders-'));
    expect(folders.ensure('C:\\work\\one').id).not.toBe(folders.ensure('C:\\work\\two').id);
  });
});

describe('sessions on disk', () => {
  it('keeps each session in a directory of its own and lists them newest first', () => {
    const dir = tempFolder('wrontend-sessions-');
    const store = new SessionStore(dir);
    store.save(record(ID, 'f', 1));
    store.save(record(OTHER, 'f', 2));
    expect(existsSync(join(dir, ID, 'session.json'))).toBe(true);
    expect(new SessionStore(dir).list().map((s) => s.info.id)).toEqual([OTHER, ID]);
  });

  it('removes everything a deleted session keeps except its usage, and lists it no more', () => {
    const dir = tempFolder('wrontend-sessions-');
    const store = new SessionStore(dir);
    store.save(record(ID, 'f'));
    writeFileSync(join(dir, ID, 'usage.jsonl'), '{}\n');
    mkdirSync(join(dir, ID, 'captures'));
    writeFileSync(join(dir, ID, 'captures', 'one.json'), '{}');
    store.remove(ID);
    expect(readdirSync(join(dir, ID))).toEqual(['usage.jsonl']);
    expect(store.list()).toEqual([]);
  });

  it('leaves no directory behind for a deleted session that used nothing', () => {
    const dir = tempFolder('wrontend-sessions-');
    const store = new SessionStore(dir);
    store.save(record(ID, 'f'));
    store.remove(ID);
    expect(existsSync(join(dir, ID))).toBe(false);
    store.remove(ID);
  });

  it('skips a record that does not parse, and leaves it in place', () => {
    const dir = tempFolder('wrontend-sessions-');
    mkdirSync(join(dir, ID));
    writeFileSync(join(dir, ID, 'session.json'), '{ not json');
    expect(new SessionStore(dir).list()).toEqual([]);
    expect(existsSync(join(dir, ID, 'session.json'))).toBe(true);
  });

  it('refuses an id that could name a path outside its directory', () => {
    expect(() => new SessionStore(tempFolder('wrontend-sessions-')).remove('..')).toThrow();
  });
});

describe('usage on disk', () => {
  const stats = { kind: 'main', model: 'm', status: 200, inputTokens: 10, outputTokens: 6, firstTokenMs: 5, generationMs: 50, historyHasThinking: false, error: null } as const;

  it('appends a line per record and reads them back per session, a deleted session included', () => {
    const dir = tempFolder('wrontend-sessions-');
    const store = new SessionStore(dir);
    store.save(record(ID, 'f'));
    store.appendUsage(ID, { at: 1, harness: 'fake', folderId: 'f', type: 'prompt', model: 'm' });
    store.appendUsage(ID, { at: 2, harness: 'fake', folderId: 'f', type: 'request', stats });
    store.appendUsage(OTHER, { at: 3, harness: 'fake', folderId: 'f', type: 'prompt', model: 'm' });
    store.remove(ID);
    const usage = new SessionStore(dir).usage().sort((a, b) => a.records[0].at - b.records[0].at);
    expect(usage.map((u) => [u.sessionId, u.records.map((r) => r.type)])).toEqual([
      [ID, ['prompt', 'request']],
      [OTHER, ['prompt']],
    ]);
  });

  it('skips half a line left by a crash mid-append', () => {
    const dir = tempFolder('wrontend-sessions-');
    const store = new SessionStore(dir);
    store.appendUsage(ID, { at: 1, harness: 'fake', folderId: 'f', type: 'prompt', model: 'm' });
    appendFileSync(join(dir, ID, 'usage.jsonl'), '{"at":2,"harn');
    expect(store.usage()[0].records).toHaveLength(1);
  });
});

describe('the host reading its records', () => {
  it("gives each session its folder's path, and skips one whose folder has no record", () => {
    const data = tempFolder('wrontend-host-');
    const folder = new FolderStore(join(data, 'folders')).ensure('C:\\work\\project');
    const sessions = new SessionStore(join(data, 'sessions'));
    sessions.save(record(ID, folder.id));
    sessions.save(record(OTHER, 'a-folder-with-no-record'));
    const host = new AgentHost({} as ProxyServer, data, () => null, () => {});
    const stored = host.stored();
    expect(stored.map((s) => s.info.id)).toEqual([ID]);
    expect(stored[0].info.folder).toBe('C:\\work\\project');
  });
});
