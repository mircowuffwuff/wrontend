import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ComponentState } from '@shared/components';
import { tempFolder } from '../temp-folder';
import { ComponentEngine } from './engine';
import { NpmDriver, latestFrom, type CatalogEntry } from './npm-driver';
import { fakeNpm, type FakeNpmOptions } from './fake-npm';
import { ComponentStore } from './store';
import { compareVersions } from './version';

const ENTRY: CatalogEntry = { id: 'tool', name: 'Tool', npm: '@scope/tool', bin: 'tool', floor: '1.2.0' };

function setup(fake: FakeNpmOptions) {
  const root = tempFolder('wrontend-components-');
  const store = new ComponentStore(join(root, 'components'));
  const states: ComponentState[] = [];
  const options = { ...fake };
  const npm = new NpmDriver(store, [ENTRY], { findNpm: async () => fakeNpm(join(root, 'npm'), options), tickMs: 50 });
  const engine = new ComponentEngine([npm], (_, s) => states.push(s));
  return { root, store, engine, npm, states, options };
}

describe('versions', () => {
  it('compares numerically, with a prerelease below its release', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('1.2.0-beta.1', '1.2.0')).toBe(-1);
    expect(compareVersions('v22.1.0', '22.0.0')).toBe(1);
  });

  it('reads npm view as npm 11 and npm 12 print it', () => {
    expect(latestFrom('"0.89.1"')).toBe('0.89.1');
    expect(latestFrom('[\n  "0.89.1"\n]')).toBe('0.89.1');
    expect(() => latestFrom('{}')).toThrow();
  });
});

describe('the npm driver', () => {
  it('installs the latest version into its own folder, makes it active and resolves its program', async () => {
    const { store, engine, npm, states } = setup({ latest: '1.3.0', chunks: 3 });
    expect(engine.state('tool')).toEqual({ status: 'missing' });
    expect(npm.program('tool')).toBeNull();

    await engine.install('tool');

    expect(engine.state('tool')).toEqual({ status: 'installed', version: '1.3.0' });
    expect(npm.program('tool')).toBe(join(store.root, 'tool', '1.3.0', 'node_modules', '@scope', 'tool', 'dist', 'index.js'));
    expect(JSON.parse(readFileSync(join(store.root, 'components.json'), 'utf8'))).toEqual({ active: { tool: '1.3.0' } });
    const steps = states.filter((s) => s.status === 'installing').map((s) => s.status === 'installing' && s.step);
    expect(steps).toContain('Downloading Tool 1.3.0');
    expect(states.some((s) => s.status === 'installing' && s.bytes > 0)).toBe(true);
    expect(states.at(-1)).toEqual({ status: 'installed', version: '1.3.0' });
    expect(existsSync(join(store.root, '.npm-cache'))).toBe(false);
  });

  it('keeps an earlier version beside a newer one and switches back to it without installing', async () => {
    const { store, engine, options } = setup({ latest: '1.2.0' });
    await engine.install('tool');
    options.latest = '1.4.0';
    await engine.install('tool');
    expect(store.versions('tool').sort()).toEqual(['1.2.0', '1.4.0']);

    options.latest = '1.2.0';
    options.fail = true; // an install would fail: the switch back must not install
    await engine.install('tool');
    expect(engine.state('tool')).toEqual({ status: 'installed', version: '1.2.0' });
  });

  it('keeps the version an update replaced and removes older ones', async () => {
    const { store, engine, options } = setup({ latest: '1.2.0' });
    await engine.install('tool');
    options.latest = '1.3.0';
    await engine.install('tool');
    options.latest = '1.4.0';
    await engine.install('tool');
    expect(store.versions('tool').sort()).toEqual(['1.3.0', '1.4.0']);
    expect(existsSync(store.dir('tool', '1.2.0'))).toBe(false);
  });

  it('tells the latest version without installing it', async () => {
    const { store, npm, root } = setup({ latest: '1.3.0' });
    expect(await npm.latest('tool')).toBe('1.3.0');
    expect(store.versions('tool')).toEqual([]);
    expect(existsSync(join(store.root, '.npm-cache'))).toBe(false);
    expect(existsSync(join(root, 'npm'))).toBe(true);
  });

  it('refuses a latest version below the floor', async () => {
    const { engine } = setup({ latest: '1.1.9' });
    await expect(engine.install('tool')).rejects.toThrow('older than the 1.2.0 wrontend needs');
    expect(engine.state('tool')).toMatchObject({ status: 'failed' });
  });

  it('reports npm’s own reason, keeps its output, and leaves no half-installed folder', async () => {
    const { store, engine, npm } = setup({ latest: '1.3.0', fail: true });
    await expect(engine.install('tool')).rejects.toThrow('404 Not Found');
    const state = engine.state('tool');
    expect(state).toMatchObject({ status: 'failed', error: '404 Not Found - GET https://registry.npmjs.org/@scope/tool@1.3.0' });
    expect(state.status === 'failed' && state.detail).toContain('npm error code E404');
    expect(readdirSync(join(store.root, 'tool'))).toEqual([]);
    expect(npm.program('tool')).toBeNull();
  });

  it('runs one install at a time, and a second call for the same component waits for the first', async () => {
    const { engine } = setup({ latest: '1.3.0', chunks: 2 });
    const first = engine.install('tool');
    const second = engine.install('tool');
    expect(second).toBe(first);
    await first;
    expect(engine.state('tool')).toEqual({ status: 'installed', version: '1.3.0' });
  });

  it('clears what a run that ended mid-install left behind', () => {
    const root = tempFolder('wrontend-components-');
    mkdirSync(join(root, 'tool', '1.3.0.partial', 'node_modules'), { recursive: true });
    mkdirSync(join(root, 'tool', '1.2.0'), { recursive: true });
    new NpmDriver(new ComponentStore(root), [ENTRY]);
    expect(readdirSync(join(root, 'tool'))).toEqual(['1.2.0']);
  });
});
