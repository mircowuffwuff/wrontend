// installed components on disk: every version in its own folder, <root>/<id>/<version>/, and a manifest of which is active.
// an update is a new folder and a switch, a rollback is switching back. a version being installed lives in <version>.partial
// until it is whole, so a crash halfway leaves nothing the resolver would pick up

import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PARTIAL = '.partial';

interface Manifest {
  active: Record<string, string>;
}

export class ComponentStore {
  private manifest: Manifest;
  readonly root: string;

  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    // full long-form paths: a Windows 8.3 short path such as C:\Users\ABCDEF~1 makes Node's file watcher in a harness abort
    this.root = realpathSync.native(root);
    this.manifest = this.read();
  }

  // the active version, if its folder is still there
  active(id: string): { version: string; dir: string } | null {
    const version = this.manifest.active[id];
    if (!version) return null;
    const dir = this.dir(id, version);
    return existsSync(dir) ? { version, dir } : null;
  }

  versions(id: string): string[] {
    const folder = join(this.root, id);
    if (!existsSync(folder)) return [];
    return readdirSync(folder, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.endsWith(PARTIAL))
      .map((e) => e.name);
  }

  dir(id: string, version: string): string {
    return join(this.root, id, version);
  }

  // an empty folder to install the version into
  begin(id: string, version: string): string {
    const partial = this.dir(id, version) + PARTIAL;
    rmSync(partial, { recursive: true, force: true });
    mkdirSync(partial, { recursive: true });
    return partial;
  }

  // the installed version takes its place and becomes the active one
  finish(id: string, version: string): string {
    const dir = this.dir(id, version);
    rmSync(dir, { recursive: true, force: true });
    renameSync(dir + PARTIAL, dir);
    this.activate(id, version);
    return dir;
  }

  abandon(id: string, version: string): void {
    rmSync(this.dir(id, version) + PARTIAL, { recursive: true, force: true });
  }

  activate(id: string, version: string): void {
    this.manifest.active[id] = version;
    const file = join(this.root, 'components.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(this.manifest, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  // what a run that ended mid-install left behind
  sweep(): void {
    for (const id of readdirSync(this.root, { withFileTypes: true })) {
      if (!id.isDirectory()) continue;
      for (const entry of readdirSync(join(this.root, id.name), { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.endsWith(PARTIAL)) rmSync(join(this.root, id.name, entry.name), { recursive: true, force: true });
      }
    }
  }

  private read(): Manifest {
    try {
      const parsed = JSON.parse(readFileSync(join(this.root, 'components.json'), 'utf8')) as Partial<Manifest>;
      const active = Object.fromEntries(Object.entries(parsed.active ?? {}).filter(([, v]) => typeof v === 'string'));
      return { active };
    } catch {
      return { active: {} };
    }
  }
}
