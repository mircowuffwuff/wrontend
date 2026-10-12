import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { manifestUrl, modelUpdates, readManifest, type InstalledModels, type Manifest } from './model-source';

const OLD = '1'.repeat(64);
const NEW = '2'.repeat(64);
const WEIGHTS = 'a'.repeat(64);
const PROJECTOR = 'b'.repeat(64);

function installed(models: { name: string; digest: string }[], blobs: string[] = [WEIGHTS, PROJECTOR]): InstalledModels {
  return { models: async () => models, blobs: async () => blobs };
}

function manifest(digest: string, weights = WEIGHTS): Manifest {
  return {
    digest,
    layers: [
      { mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${weights}`, size: 12_000 },
      { mediaType: 'application/vnd.ollama.image.projector', digest: `sha256:${PROJECTOR}`, size: 900 },
      { mediaType: 'application/vnd.ollama.image.template', digest: `sha256:${'d'.repeat(64)}`, size: 4 },
    ],
  };
}

describe('manifest addresses', () => {
  it('finds a model where Ollama pulls it from', () => {
    expect(manifestUrl('qwen3.8:27b-q4_K_M')).toBe('https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b-q4_K_M');
    expect(manifestUrl('qwen3.8')).toBe('https://registry.ollama.ai/v2/library/qwen3.8/manifests/latest');
    expect(manifestUrl('someone/tiny:1b')).toBe('https://registry.ollama.ai/v2/someone/tiny/manifests/1b');
    expect(manifestUrl('hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S')).toBe('https://huggingface.co/v2/unsloth/Qwen3.8-27B-GGUF/manifests/UD-IQ3_S');
    expect(manifestUrl('huggingface.co/unsloth/Qwen3.8-27B-GGUF')).toBe('https://huggingface.co/v2/unsloth/Qwen3.8-27B-GGUF/manifests/latest');
    expect(manifestUrl('registry.example.com:5000/team/model:v2')).toBe('https://registry.example.com:5000/v2/team/model/manifests/v2');
  });
});

describe('reading a manifest', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('hashes the manifest as served, and asks for the manifest type Ollama pulls', async () => {
    const body = JSON.stringify(manifest(''));
    const fetch = vi.fn(async () => new Response(body));
    vi.stubGlobal('fetch', fetch);
    const read = await readManifest('qwen3.8:27b');
    expect(read?.digest).toBe(createHash('sha256').update(body).digest('hex'));
    expect(read?.layers).toHaveLength(3);
    expect(fetch.mock.calls[0]).toMatchObject(['https://registry.ollama.ai/v2/library/qwen3.8/manifests/27b', { headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' } }]);
  });

  it('has nothing for a name the registry does not know, and fails on any other refusal', async () => {
    for (const status of [404, 400, 401]) {
      vi.stubGlobal('fetch', async () => new Response('', { status }));
      expect(await readManifest('hf.co/o/r:my-own-tag')).toBeNull();
    }
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    await expect(readManifest('qwen3.8:27b')).rejects.toThrow('registry.ollama.ai answered 503 for qwen3.8:27b');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    await expect(readManifest('hf.co/o/r:Q4')).rejects.toThrow('huggingface.co could not be reached');
  });
});

describe('the model source', () => {
  it('offers nothing for a model whose registry serves the manifest it was pulled with', async () => {
    const source = modelUpdates(installed([{ name: 'qwen3.8:27b', digest: OLD }]), async () => manifest(OLD));
    expect(await source.check()).toEqual([]);
  });

  it('offers a new upload, with what the pull downloads', async () => {
    const source = modelUpdates(installed([{ name: 'hf.co/o/r:Q4', digest: `sha256:${OLD}` }]), async () => manifest(NEW, 'c'.repeat(64)));
    expect(await source.check()).toEqual([{ id: 'model:hf.co/o/r:Q4', name: 'hf.co/o/r:Q4', current: OLD, available: NEW, component: 'pull:hf.co/o/r:Q4', bytes: 12_000 }]);
  });

  it('offers a new template or parameters over the same weights, with nothing large to download', async () => {
    const source = modelUpdates(installed([{ name: 'qwen3.8:27b', digest: OLD }]), async () => manifest(NEW));
    expect((await source.check())[0].bytes).toBe(0);
  });

  it('has nothing to compare while Ollama is not running', async () => {
    const source = modelUpdates({ models: async () => Promise.reject(new Error('fetch failed')), blobs: async () => [] }, async () => manifest(NEW));
    expect(await source.check()).toEqual([]);
  });

  it('leaves out wrontend’s copies and models no registry serves', async () => {
    const asked: string[] = [];
    const source = modelUpdates(
      installed([
        { name: 'hf.co/o/r:Q4-wrontend-derived', digest: OLD },
        { name: 'my-own-copy:latest', digest: OLD },
      ]),
      async (name) => (asked.push(name), null),
    );
    expect(await source.check()).toEqual([]);
    expect(asked).toEqual(['my-own-copy:latest']);
  });
});
