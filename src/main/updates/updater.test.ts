import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { UpdatesState } from '@shared/updates';
import { ComponentEngine } from '../components/engine';
import { fakeNpm, type FakeNpmOptions } from '../components/fake-npm';
import { NpmDriver, type CatalogEntry } from '../components/npm-driver';
import { ComponentStore } from '../components/store';
import { tempFolder } from '../temp-folder';
import { npmUpdates } from './npm-source';
import { Updater, type Found, type UpdateSource } from './updater';

const TOOL: Found = { id: 'tool', name: 'Tool', current: '1.0.0', available: '1.1.0', component: 'tool' };

function source(group: UpdateSource['group'], check: () => Promise<Found[]>): UpdateSource {
  return { group, check };
}

function setup(sources: UpdateSource[], install: (component: string) => Promise<void> = async () => {}) {
  const file = join(tempFolder('wrontend-updates-'), 'updates.json');
  const states: UpdatesState[] = [];
  const updater = new Updater(sources, file, install, (s) => states.push(s));
  return { file, updater, states };
}

describe('the updater', () => {
  it('lists what each source finds, in the order of its groups, and says when it checked', async () => {
    const { updater, states } = setup([
      source('models', async () => [{ id: 'm', name: 'M', current: 'a', available: 'b', component: 'pull:m' }]),
      source('harnesses', async () => [TOOL]),
    ]);
    const checking = updater.check();
    expect(updater.state().checking).toBe(true);
    await checking;
    const state = updater.state();
    expect(state.entries.map((e) => e.id)).toEqual(['tool', 'm']);
    expect(state.entries[0]).toEqual({ id: 'tool', group: 'harnesses', name: 'Tool', current: '1.0.0', available: '1.1.0', pinned: false, state: null });
    expect(state.checking).toBe(false);
    expect(state.checkedAt).not.toBeNull();
    expect(states.at(-1)).toEqual(state);
  });

  it('keeps the other sources and the last answer when one cannot be reached', async () => {
    let reachable = true;
    const { updater } = setup([
      source('harnesses', async () => [TOOL]),
      source('models', async () => {
        if (!reachable) throw new Error('offline');
        return [{ id: 'm', name: 'M', current: 'a', available: 'b', component: 'pull:m' }];
      }),
    ]);
    await updater.check();
    reachable = false;
    await updater.check();
    const state = updater.state();
    expect(state.entries.map((e) => e.id)).toEqual(['tool', 'm']);
    expect(state.failures).toEqual([{ group: 'models', error: 'offline' }]);
    reachable = true;
    await updater.check();
    expect(updater.state().failures).toEqual([]);
  });

  it('runs one check at a time', async () => {
    let calls = 0;
    const { updater } = setup([source('harnesses', async () => (calls++, []))]);
    await Promise.all([updater.check(), updater.check()]);
    expect(calls).toBe(1);
  });

  it('hides a skipped version until a newer one appears, and remembers it across starts', async () => {
    let available = '1.1.0';
    const sources = [source('harnesses', async () => [{ ...TOOL, available }])];
    const { updater, file } = setup(sources);
    await updater.check();
    updater.skip('tool');
    expect(updater.state().entries).toEqual([]);

    const again = new Updater(sources, file, async () => {});
    await again.check();
    expect(again.state().entries).toEqual([]);
    available = '1.2.0';
    await again.check();
    expect(again.state().entries.map((e) => e.available)).toEqual(['1.2.0']);
  });

  it('keeps a pinned entry, marked, until it is unpinned', async () => {
    const { updater, file } = setup([source('harnesses', async () => [TOOL])]);
    await updater.check();
    updater.pin('tool', true);
    expect(updater.state().entries[0].pinned).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ skipped: {}, pinned: ['tool'] });
    updater.pin('tool', false);
    expect(updater.state().entries[0].pinned).toBe(false);
  });

  it('sets an update up through its component, shows its progress, and drops the entry once it is done', async () => {
    const installed: string[] = [];
    let finish = () => {};
    const { updater } = setup([source('harnesses', async () => [TOOL])], (component) => {
      installed.push(component);
      return new Promise((resolve) => (finish = resolve));
    });
    await updater.check();
    const updating = updater.update('tool');
    updater.componentChanged('tool', { status: 'installing', step: 'Downloading Tool 1.1.0', bytes: 5 });
    expect(updater.state().entries[0].state).toEqual({ status: 'installing', step: 'Downloading Tool 1.1.0', bytes: 5 });
    updater.componentChanged('tool', { status: 'installed', version: '1.1.0' });
    finish();
    await updating;
    expect(installed).toEqual(['tool']);
    expect(updater.state().entries).toEqual([]);
  });

  it('applies an update a source sets up itself, with its progress and failure on the entry', async () => {
    let fail = true;
    const ollama: UpdateSource = {
      group: 'ollama',
      check: async () => [{ id: 'ollama', name: 'Ollama', current: '0.40.2', available: '0.40.3', component: 'ollama' }],
      apply: async () => {
        if (fail) throw new Error('Ollama did not answer');
      },
    };
    const installed: string[] = [];
    const { updater } = setup([ollama], async (c) => void installed.push(c));
    await updater.check();
    await expect(updater.update('ollama')).rejects.toThrow('Ollama did not answer');
    expect(updater.state().entries[0].state).toEqual({ status: 'failed', error: 'Ollama could not be updated.', detail: 'Ollama did not answer' });
    fail = false;
    await updater.update('ollama');
    expect(updater.state().entries).toEqual([]);
    expect(installed).toEqual([]);
  });

  it('updates all but the pinned, and restarts Ollama once the others are done', async () => {
    const order: string[] = [];
    const ollama: UpdateSource = {
      group: 'ollama',
      check: async () => [{ id: 'ollama', name: 'Ollama', current: '0.40.2', available: '0.40.3', component: 'ollama' }],
      apply: async () => void order.push('ollama'),
    };
    const models = source('models', async () => [
      { id: 'model:a', name: 'a', current: '1', available: '2', component: 'pull:a' },
      { id: 'model:b', name: 'b', current: '1', available: '2', component: 'pull:b' },
    ]);
    const { updater } = setup([ollama, models], async (c) => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(c);
    });
    await updater.check();
    updater.pin('model:b', true);
    await updater.updateAll();
    expect(order).toEqual(['pull:a', 'ollama']);
    expect(updater.state().entries.map((e) => e.id)).toEqual(['model:b']);
  });

  it('keeps a failed update on its entry', async () => {
    const { updater } = setup([source('harnesses', async () => [TOOL])], async () => {
      throw new Error('npm failed');
    });
    await updater.check();
    const updating = updater.update('tool');
    updater.componentChanged('tool', { status: 'failed', error: 'Tool could not be set up.', detail: 'E404' });
    await expect(updating).rejects.toThrow('npm failed');
    expect(updater.state().entries[0].state).toEqual({ status: 'failed', error: 'Tool could not be set up.', detail: 'E404' });
  });
});

const ENTRY: CatalogEntry = { id: 'tool', name: 'Tool', npm: '@scope/tool', bin: 'tool', floor: '1.0.0' };

function npmSetup(fake: FakeNpmOptions) {
  const root = tempFolder('wrontend-components-');
  const store = new ComponentStore(join(root, 'components'));
  const options = { ...fake };
  const npm = new NpmDriver(store, [ENTRY], { findNpm: async () => fakeNpm(join(root, 'npm'), options) });
  const engine = new ComponentEngine([npm]);
  return { store, npm, engine, options };
}

describe('the npm source', () => {
  it('offers nothing for a component that is not installed', async () => {
    const { store, npm } = npmSetup({ latest: '1.1.0' });
    expect(await npmUpdates(npm, store, [ENTRY]).check()).toEqual([]);
  });

  it('offers a newer latest than the active version, and nothing once it is installed', async () => {
    const { store, npm, engine, options } = npmSetup({ latest: '1.0.0' });
    await engine.install('tool');
    const check = npmUpdates(npm, store, [ENTRY]);
    expect(await check.check()).toEqual([]);
    options.latest = '1.1.0';
    expect(await check.check()).toEqual([{ id: 'tool', name: 'Tool', current: '1.0.0', available: '1.1.0', component: 'tool' }]);
    await engine.install('tool');
    expect(await check.check()).toEqual([]);
  });
});
