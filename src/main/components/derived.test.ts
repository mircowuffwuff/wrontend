import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ModelDetails, ModelSummary } from '@shared/ollama';
import type { CreateRequest } from '../ollama/client';
import { deleteModel, derivedId, derivedName, DerivedModels, isDerived, routeModel, type DeletingOllama, type DerivedOllama } from './derived';
import { ComponentEngine } from './engine';
import { RENDERERS, rendererFor } from './renderers';
import { ComponentStore } from './store';

const HF = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S';
const COPY = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S-wrontend-derived';

const qwen38: Omit<ModelDetails, 'name'> = {
  capabilities: ['completion', 'tools', 'thinking'],
  hasRenderer: false,
  contextLength: 262144,
  architecture: 'qwen35',
  baseModel: 'Qwen/Qwen3.8-27B',
  basename: 'Qwen3.8-27B',
};

// an Ollama in memory: a create adds the copy to the list, with the renderer it was given; a delete takes a model off it
function fakeOllama(version = '0.40.3') {
  const models: ModelSummary[] = [];
  const details = new Map<string, ModelDetails>();
  const creates: CreateRequest[] = [];
  // every delete and unload, in order
  const calls: string[] = [];
  const loaded = new Set<string>();
  const state = { version, failCreate: false, failDelete: null as string | null };
  const add = (name: string, digest: string, d: Omit<ModelDetails, 'name'>) => {
    const at = models.findIndex((m) => m.name === name);
    const summary = { name, digest, sizeBytes: 1, family: d.architecture, parameterSize: null, quantization: null };
    if (at >= 0) models[at] = summary;
    else models.push(summary);
    details.set(name, { name, ...d });
  };
  const ollama: DerivedOllama = {
    version: async () => state.version,
    models: async () => models.map((m) => ({ ...m })),
    show: async (name) => {
      const d = details.get(name);
      if (!d) throw new Error(`model '${name}' not found`);
      return d;
    },
    create: async (request) => {
      creates.push(request);
      await new Promise((r) => setTimeout(r, 20));
      if (state.failCreate) throw new Error('renderer "qwen3.8" is not known');
      const from = details.get(request.from)!;
      add(request.model, `copy-of-${models.find((m) => m.name === request.from)!.digest}`, { ...from, hasRenderer: !!request.renderer });
    },
    delete: async (name) => {
      calls.push(`delete ${name}`);
      if (state.failDelete === name) throw new Error('permission denied');
      const at = models.findIndex((m) => m.name === name);
      if (at < 0) throw new Error(`model '${name}' not found`);
      models.splice(at, 1);
      details.delete(name);
    },
  };
  const deleting: DeletingOllama = {
    loaded: async () => [...loaded].map((name) => ({ name, sizeBytes: 1, vramBytes: 1, contextLength: null })),
    unload: async (name) => {
      calls.push(`unload ${name}`);
      loaded.delete(name);
    },
    delete: ollama.delete,
  };
  return { ollama, deleting, add, creates, calls, loaded, state };
}

function setup(options: { enabled?: boolean; readOnly?: boolean; version?: string } = {}) {
  const fake = fakeOllama(options.version);
  fake.add(HF, 'aaaaaaaaaaaaaaaa', qwen38);
  const store = new ComponentStore(mkdtempSync(join(tmpdir(), 'wrontend-derived-')));
  const settings = { enabled: options.enabled ?? true };
  const derived = new DerivedModels(fake.ollama, store, RENDERERS, { enabled: () => settings.enabled, readOnly: options.readOnly, listMs: 0 });
  const engine = new ComponentEngine([derived]);
  return { ...fake, store, derived, engine, settings };
}

describe('derived names', () => {
  it('keep host, namespace and model, and mark only the tag', () => {
    expect(derivedName(HF)).toBe(COPY);
    expect(derivedName('qwen3.8:27b')).toBe('qwen3.8:27b-wrontend-derived');
    expect(derivedName('mymodel')).toBe('mymodel:latest-wrontend-derived');
    expect(derivedName('gpu-box:8080/team/m:q4')).toBe('gpu-box:8080/team/m:q4-wrontend-derived');
    expect(isDerived(COPY)).toBe(true);
    expect(isDerived(HF)).toBe(false);
  });

  it('cut a tag too long for the mark, keeping two long tags apart', () => {
    const a = derivedName(`m:${'x'.repeat(75)}a`);
    const b = derivedName(`m:${'x'.repeat(75)}b`);
    expect(a.split(':')[1]).toHaveLength(80);
    expect(a).not.toBe(b);
    expect(isDerived(a)).toBe(true);
  });
});

describe('the renderer table', () => {
  it('tells families with the same architecture apart by their base model', () => {
    expect(rendererFor(RENDERERS, qwen38)?.renderer).toBe('qwen3.8');
    expect(rendererFor(RENDERERS, { ...qwen38, baseModel: 'Qwen/Qwen3.5-27B' })?.renderer).toBe('qwen3.5');
    expect(rendererFor(RENDERERS, { ...qwen38, architecture: 'qwen4exp' })).toBeNull();
  });

  it('falls back to the basename when a GGUF names no base model', () => {
    expect(rendererFor(RENDERERS, { ...qwen38, baseModel: null })?.renderer).toBe('qwen3.8');
    expect(rendererFor(RENDERERS, { ...qwen38, baseModel: null, basename: 'Qwen3.8' })?.renderer).toBe('qwen3.8');
    expect(rendererFor(RENDERERS, { ...qwen38, baseModel: null, basename: 'Llama-4' })).toBeNull();
  });
});

describe('derived models', () => {
  it('makes a copy with the renderer once, routes the pick to it and hides it from the list', async () => {
    const { derived, engine, creates, store } = setup();
    expect(await routeModel(engine, derived, HF)).toBe(COPY);
    expect(creates).toEqual([{ model: COPY, from: HF, renderer: 'qwen3.8', parser: 'qwen3.5' }]);
    expect(store.recorded(derivedId(HF))).toBe('aaaaaaaaaaaa+qwen3.8+qwen3.5');
    expect(engine.state(derivedId(HF))).toEqual({ status: 'installed', version: 'aaaaaaaaaaaa+qwen3.8+qwen3.5' });

    expect(await routeModel(engine, derived, HF)).toBe(COPY);
    expect(creates).toHaveLength(1);
    expect((await derived.models()).map((m) => m.name)).toEqual([HF]);
    expect(derived.originalOf(COPY)).toBe(HF);
    expect(derived.originalOf(HF)).toBeNull();
    expect(await derived.reasoning(engine, HF)).toEqual({ status: 'derived', state: { status: 'installed', version: 'aaaaaaaaaaaa+qwen3.8+qwen3.5' } });
  });

  it('makes one copy when requests arrive together', async () => {
    const { derived, engine, creates } = setup();
    const routes = await Promise.all([routeModel(engine, derived, HF), routeModel(engine, derived, HF), routeModel(engine, derived, HF)]);
    expect(routes).toEqual([COPY, COPY, COPY]);
    expect(creates).toHaveLength(1);
  });

  it('makes the copy again when the original is pulled again', async () => {
    const { derived, engine, creates, add } = setup();
    await routeModel(engine, derived, HF);
    add(HF, 'bbbbbbbbbbbbbbbb', qwen38);
    expect(await routeModel(engine, derived, HF)).toBe(COPY);
    expect(creates).toHaveLength(2);
    expect(engine.state(derivedId(HF))).toMatchObject({ version: 'bbbbbbbbbbbb+qwen3.8+qwen3.5' });
  });

  it('leaves alone a model that keeps its reasoning, and passes an unknown name on', async () => {
    const { derived, engine, creates, add } = setup();
    add('qwen3.8:27b', 'c', { ...qwen38, hasRenderer: true });
    add('plain:7b', 'd', { ...qwen38, capabilities: ['completion'] });
    expect(await routeModel(engine, derived, 'qwen3.8:27b')).toBe('qwen3.8:27b');
    expect(await routeModel(engine, derived, 'plain:7b')).toBe('plain:7b');
    expect(await routeModel(engine, derived, 'missing:1b')).toBe('missing:1b');
    expect(await derived.reasoning(engine, 'qwen3.8:27b')).toEqual({ status: 'kept' });
    expect(creates).toHaveLength(0);
  });

  it('says why a thinking model without a renderer keeps no reasoning', async () => {
    const { derived, engine, add, settings } = setup();
    add('hf.co/x/Other-GGUF:Q4', 'e', { ...qwen38, architecture: 'llama', baseModel: 'meta/Llama-9' });
    expect(await derived.reasoning(engine, 'hf.co/x/Other-GGUF:Q4')).toMatchObject({ status: 'lost', reason: expect.stringContaining('knows no renderer') });
    settings.enabled = false;
    expect(await derived.reasoning(engine, HF)).toMatchObject({ status: 'lost', reason: expect.stringContaining('turned off in Settings') });
    expect(await routeModel(engine, derived, HF)).toBe(HF);

    const old = setup({ version: '0.31.0' });
    expect(await old.derived.reasoning(old.engine, HF)).toMatchObject({ status: 'lost', reason: expect.stringContaining('needs Ollama 0.32.12 or newer') });
  });

  it('falls back to the pick when Ollama cannot make the copy, and tries again only when asked to', async () => {
    const { derived, engine, creates, state } = setup();
    state.failCreate = true;
    expect(await routeModel(engine, derived, HF)).toBe(HF);
    expect(engine.state(derivedId(HF))).toMatchObject({ status: 'failed', detail: 'renderer "qwen3.8" is not known' });
    expect(await routeModel(engine, derived, HF)).toBe(HF);
    expect(creates).toHaveLength(1);

    state.failCreate = false;
    expect(await routeModel(engine, derived, HF, true)).toBe(COPY);
    expect(creates).toHaveLength(2);
  });

  it('writes nothing into Ollama when read-only', async () => {
    const { derived, engine, creates } = setup({ readOnly: true });
    expect(await routeModel(engine, derived, HF)).toBe(HF);
    expect(creates).toHaveLength(0);
    expect(engine.state(derivedId(HF))).toMatchObject({ status: 'failed' });
  });
});

describe('deleting a model', () => {
  it('unloads it, deletes its copy first and forgets the copy', async () => {
    const { derived, engine, deleting, calls, loaded, store } = setup();
    await routeModel(engine, derived, HF);
    loaded.add(COPY);
    await deleteModel(engine, derived, deleting, HF);
    expect(calls).toEqual([`unload ${COPY}`, `delete ${COPY}`, `delete ${HF}`]);
    expect(store.recorded(derivedId(HF))).toBeNull();
    expect(engine.state(derivedId(HF))).toEqual({ status: 'missing' });
    expect(await derived.models()).toEqual([]);
  });

  it('deletes a model that has no copy, and forgets a copy already gone from Ollama', async () => {
    const plain = setup();
    plain.add('llama4:8b', 'bbbb', { ...qwen38, capabilities: ['completion'] });
    await deleteModel(plain.engine, plain.derived, plain.deleting, 'llama4:8b');
    expect(plain.calls).toEqual(['delete llama4:8b']);

    const gone = setup();
    gone.store.activate(derivedId(HF), 'aaaaaaaaaaaa+qwen3.8+qwen3.5');
    await deleteModel(gone.engine, gone.derived, gone.deleting, HF);
    expect(gone.calls).toEqual([`delete ${HF}`]);
    expect(gone.store.recorded(derivedId(HF))).toBeNull();
  });

  it('keeps the original when its copy cannot be deleted', async () => {
    const { derived, engine, deleting, calls, state, store } = setup();
    await routeModel(engine, derived, HF);
    state.failDelete = COPY;
    await expect(deleteModel(engine, derived, deleting, HF)).rejects.toThrow('permission denied');
    expect(calls).toEqual([`delete ${COPY}`]);
    expect(store.recorded(derivedId(HF))).not.toBeNull();
    expect((await derived.models()).map((m) => m.name)).toEqual([HF]);
  });

  it('refuses while the copy is being made', async () => {
    const { derived, engine, deleting, calls, loaded } = setup();
    const making = routeModel(engine, derived, HF);
    await new Promise((r) => setTimeout(r, 5));
    loaded.add(HF);
    await expect(deleteModel(engine, derived, deleting, HF)).rejects.toThrow('is being made');
    expect(calls).toEqual([]);
    expect(await making).toBe(COPY);
  });

  it('deletes nothing when read-only', async () => {
    const { derived, engine, deleting, calls } = setup({ readOnly: true });
    await expect(deleteModel(engine, derived, deleting, HF)).rejects.toThrow('deletes nothing');
    expect(calls).toEqual([]);
  });
});
