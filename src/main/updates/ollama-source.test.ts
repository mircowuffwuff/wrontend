import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tempFolder } from '../temp-folder';
import { offeredVersion, ollamaUpdates, waitingInstaller, type OllamaUpdateOptions } from './ollama-source';

function options(overrides: Partial<OllamaUpdateOptions>): OllamaUpdateOptions {
  return {
    waiting: async () => 'd384a27112bf12543fb2',
    running: async () => '0.40.2',
    offered: async () => '0.40.3',
    restart: async () => {},
    ...overrides,
  };
}

describe('a waiting installer', () => {
  it('is an OllamaSetup.exe in a hash folder of updates_v2', () => {
    const folder = join(tempFolder('wrontend-ollama-'), 'updates_v2');
    expect(waitingInstaller(folder)).toBeNull();
    expect(waitingInstaller(null)).toBeNull();
    mkdirSync(join(folder, 'aaaa'), { recursive: true });
    expect(waitingInstaller(folder)).toBeNull();
    mkdirSync(join(folder, 'd384a271'));
    writeFileSync(join(folder, 'd384a271', 'OllamaSetup.exe'), '');
    expect(waitingInstaller(folder)).toBe('d384a271');
  });
});

describe('the version ollama.com offers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads the release tag off the installer it points at', async () => {
    const fetch = vi.fn(async () => Response.json({ url: 'https://github.com/ollama/ollama/releases/download/v0.40.3/OllamaSetup.exe' }));
    vi.stubGlobal('fetch', fetch);
    expect(await offeredVersion('0.40.2', 'amd64')).toBe('0.40.3');
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe('https://ollama.com/api/update?os=windows&arch=amd64&version=0.40.2');
  });

  it('is nothing when the version asked about is the latest', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 204 }));
    expect(await offeredVersion('0.40.3')).toBeNull();
  });

  it('fails when ollama.com cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(offeredVersion('0.40.3')).rejects.toThrow('ollama.com could not be reached');
  });
});

describe('the Ollama source', () => {
  it('offers the waiting update with the version it brings', async () => {
    expect(await ollamaUpdates(options({})).check()).toEqual([{ id: 'ollama', name: 'Ollama', current: '0.40.2', available: '0.40.3', component: 'ollama' }]);
  });

  it('offers nothing while no installer waits, and asks ollama.com nothing then', async () => {
    const offered = vi.fn(async () => '0.40.3');
    expect(await ollamaUpdates(options({ waiting: async () => null, offered })).check()).toEqual([]);
    expect(offered).not.toHaveBeenCalled();
  });

  it('offers nothing when the running Ollama is already the latest', async () => {
    expect(await ollamaUpdates(options({ offered: async () => null })).check()).toEqual([]);
  });

  it('offers the installer as it is while Ollama is not running', async () => {
    const [found] = await ollamaUpdates(options({ running: () => Promise.reject(new Error('fetch failed')) })).check();
    expect(found).toMatchObject({ current: null, available: 'update d384a271' });
  });

  it('updates by restarting Ollama', async () => {
    const restart = vi.fn(async () => {});
    const source = ollamaUpdates(options({ restart }));
    await source.apply!((await source.check())[0]);
    expect(restart).toHaveBeenCalledOnce();
  });
});
