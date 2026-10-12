import { describe, expect, it } from 'vitest';
import type { ComponentState } from '@shared/components';
import type { PullProgress } from '../ollama/client';
import { CancelledError, ComponentEngine } from './engine';
import { ModelPulls, pullId, type PullingOllama } from './pull';

const NAME = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S';

// a pull in memory: the weights and a projector arrive in steps, unless it is told to fail or is aborted
function fakeOllama(options: { fail?: string; stepMs?: number } = {}) {
  const present = new Set<string>();
  const started: string[] = [];
  const ollama: PullingOllama = {
    async pull(name, onProgress: (p: PullProgress) => void, signal) {
      started.push(name);
      onProgress({ status: 'pulling manifest' });
      for (let n = 1; n <= 4; n++) {
        await new Promise((r) => setTimeout(r, options.stepMs ?? 5));
        if (signal?.aborted) throw new Error('This operation was aborted');
        onProgress({ status: 'pulling weights', digest: 'sha256:weights', total: 1200, completed: n * 300 });
        onProgress({ status: 'pulling projector', digest: 'sha256:projector', total: 100, completed: n * 25 });
      }
      if (options.fail) throw new Error(options.fail);
      onProgress({ status: 'verifying sha256 digest' });
      onProgress({ status: 'writing manifest' });
      onProgress({ status: 'success' });
      present.add(name);
    },
  };
  return { ollama, present, started };
}

function setup(options: { fail?: string; stepMs?: number } = {}) {
  const fake = fakeOllama(options);
  const states: ComponentState[] = [];
  const pulls = new ModelPulls(fake.ollama, (name) => fake.present.has(name), 0);
  const engine = new ComponentEngine([pulls], (_id, state) => states.push(state));
  return { ...fake, pulls, engine, states };
}

describe('model pulls', () => {
  it('report the layers’ bytes together, then the model is installed', async () => {
    const { engine, states } = setup();
    expect(engine.state(pullId(NAME))).toEqual({ status: 'missing' });
    await engine.install(pullId(NAME));
    const downloading = states.filter((s) => s.status === 'installing' && s.step === 'Downloading');
    expect(downloading.at(-1)).toMatchObject({ bytes: 1300, total: 1300 });
    expect(states.some((s) => s.status === 'installing' && s.step === 'Verifying')).toBe(true);
    expect(engine.state(pullId(NAME))).toEqual({ status: 'installed', version: null });
  });

  it('fail with Ollama’s reason', async () => {
    const { engine } = setup({ fail: 'pull model manifest: file does not exist' });
    await expect(engine.install(pullId(NAME))).rejects.toThrow(`Ollama could not download ${NAME}.`);
    expect(engine.state(pullId(NAME))).toMatchObject({ status: 'failed', detail: 'pull model manifest: file does not exist' });
  });

  it('stop when cancelled, and leave the model as it was', async () => {
    const { engine } = setup({ stepMs: 20 });
    const pulling = engine.install(pullId(NAME));
    await new Promise((r) => setTimeout(r, 30));
    engine.cancel(pullId(NAME));
    await expect(pulling).rejects.toBeInstanceOf(CancelledError);
    expect(engine.state(pullId(NAME))).toEqual({ status: 'missing' });
  });

  it('never start a pull cancelled while it waited its turn', async () => {
    const { engine, started } = setup({ stepMs: 10 });
    const first = engine.install(pullId('a:1'));
    const second = engine.install(pullId('b:1'));
    engine.cancel(pullId('b:1'));
    await first;
    await expect(second).rejects.toBeInstanceOf(CancelledError);
    expect(started).toEqual(['a:1']);
    expect(engine.state(pullId('b:1'))).toEqual({ status: 'missing' });
  });
});
