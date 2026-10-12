// the npm driver: installs a catalog entry's package with real npm into the store's versioned folders, and resolves an
// installed component to the program a harness runs.
// a component installs at npm's latest version, never below the floor -- the oldest version wrontend knows works. a pin
// would make every new adapter release wait for a wrontend release

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ComponentState } from '@shared/components';
import type { Driver } from './engine';
import { bootstrapNpm, findSystemNpm, InstallError, runNpm, wrontendNpm, type Npm } from './npm';
import type { ComponentStore } from './store';
import { compareVersions } from './version';

export interface CatalogEntry {
  id: string;
  name: string;
  // the npm package, and the program in its bin the harness runs
  npm: string;
  bin: string;
  floor: string;
}

export interface NpmDriverOptions {
  // which npm installs: the system's, else wrontend's own, else a fresh download
  findNpm?: (store: ComponentStore) => Promise<Npm>;
  // how often an install's progress is measured
  tickMs?: number;
}

export class NpmDriver implements Driver {
  readonly kind = 'npm';
  private readonly findNpm: (store: ComponentStore) => Promise<Npm>;

  constructor(
    private readonly store: ComponentStore,
    private readonly catalog: CatalogEntry[],
    private readonly options: NpmDriverOptions = {},
  ) {
    this.findNpm = options.findNpm ?? defaultNpm;
    store.sweep();
  }

  owns(id: string): boolean {
    return this.catalog.some((e) => e.id === id);
  }

  state(id: string): ComponentState {
    const active = this.store.active(id);
    return active && this.program(id) ? { status: 'installed', version: active.version } : { status: 'missing' };
  }

  // the script of the active version's program, or null when the component is not installed
  program(id: string): string | null {
    const entry = this.entry(id);
    const active = this.store.active(id);
    return active ? binIn(active.dir, entry) : null;
  }

  async install(id: string, report: (step: string, bytes: number) => void): Promise<void> {
    const entry = this.entry(id);
    const cache = join(this.store.root, '.npm-cache');
    let version: string | null = null;
    try {
      report('Preparing npm', 0);
      const npm = await this.findNpm(this.store);

      report('Looking up the latest version', 0);
      const found = await runNpm(npm, ['view', `${entry.npm}@latest`, 'version', '--json', ...quiet(cache)], this.store.root);
      version = latestFrom(found);
      if (compareVersions(version, entry.floor) < 0) {
        throw new InstallError(`npm offers ${entry.name} ${version}, older than the ${entry.floor} wrontend needs.`, `${entry.npm}@latest is ${version}`);
      }

      // a version installed before, and switched away from, is switched back to
      if (this.store.versions(id).includes(version) && binIn(this.store.dir(id, version), entry)) {
        this.store.activate(id, version);
        return;
      }
      const dir = this.store.begin(id, version);
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: `wrontend-${id}`, private: true }, null, 2));
      const step = `Downloading ${entry.name} ${version}`;
      report(step, 0);
      const measure = this.measure(dir, (bytes) => report(step, bytes));
      try {
        await runNpm(npm, ['install', `${entry.npm}@${version}`, '--save-exact', '--ignore-scripts', ...quiet(cache)], dir);
      } finally {
        measure.stop();
      }
      if (!binIn(dir, entry)) throw new InstallError(`npm installed ${entry.name} ${version}, but its program is missing.`, `${entry.npm} has no bin called ${entry.bin}`);
      this.store.finish(id, version);
    } catch (cause) {
      if (version) this.store.abandon(id, version);
      throw cause instanceof InstallError ? cause : new InstallError(`${entry.name} could not be set up.`, String((cause as Error).stack ?? cause));
    } finally {
      // the downloads are unpacked into the version's folder; a second copy of them is not kept
      rmSync(cache, { recursive: true, force: true });
    }
  }

  // npm reports no download progress: what it has unpacked into the version's folder is measured instead, which ends at the
  // installed size
  private measure(dir: string, report: (bytes: number) => void): { stop(): void } {
    let stopped = false;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void sizeOf(dir)
        .then((bytes) => {
          if (!stopped) report(bytes);
        })
        .finally(() => (busy = false));
    }, this.options.tickMs ?? 1000);
    return {
      stop() {
        stopped = true;
        clearInterval(timer);
      },
    };
  }

  private entry(id: string): CatalogEntry {
    const entry = this.catalog.find((e) => e.id === id);
    if (!entry) throw new Error(`no npm component called ${id}`);
    return entry;
  }
}

async function defaultNpm(store: ComponentStore): Promise<Npm> {
  return (await findSystemNpm()) ?? wrontendNpm(store) ?? (await bootstrapNpm(store));
}

// npm view's answer for one version: a string from npm 11, a list of one from npm 12
export function latestFrom(output: string): string {
  const parsed = JSON.parse(output) as unknown;
  const version = Array.isArray(parsed) ? parsed.at(-1) : parsed;
  if (typeof version !== 'string') throw new InstallError('npm did not say which version is the latest.', output);
  return version;
}

// npm's own chatter off, and the downloads in a cache of wrontend's that is removed afterwards
function quiet(cache: string): string[] {
  return ['--no-audit', '--no-fund', '--no-update-notifier', '--loglevel=error', `--cache=${cache}`];
}

function binIn(dir: string, entry: CatalogEntry): string | null {
  const root = join(dir, 'node_modules', ...entry.npm.split('/'));
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { bin?: string | Record<string, string> };
    const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[entry.bin];
    if (!bin) return null;
    const script = join(root, bin);
    return existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

async function sizeOf(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { recursive: true, withFileTypes: true });
    const sizes = await Promise.all(
      entries.filter((e) => e.isFile()).map((e) => stat(join(e.parentPath, e.name)).then((s) => s.size, () => 0)),
    );
    return sizes.reduce((a, b) => a + b, 0);
  } catch {
    return 0;
  }
}
