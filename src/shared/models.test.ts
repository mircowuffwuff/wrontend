import { describe, expect, it } from 'vitest';
import { pullSize, sameModel, type Quant } from './models';
import { tokensPerSecond } from './proxy';

const GB = 1e9;
const quant: Quant = { tag: 'UD-IQ3_S', name: 'hf.co/a/b:UD-IQ3_S', file: 'b-UD-IQ3_S.gguf', sizeBytes: 12 * GB, sha256: null, fit: 'gpu' };

describe('pullSize', () => {
  it('counts the projector from the start, before Ollama announces it', () => {
    expect(pullSize({ status: 'installing', step: 'Downloading', bytes: 1 * GB, total: 12 * GB }, quant, 0.9 * GB)).toBe(12.9 * GB);
  });

  it('trusts Ollama once it says more than the repo did', () => {
    expect(pullSize({ status: 'installing', step: 'Downloading', bytes: 13.5 * GB, total: 14 * GB }, quant, 0.9 * GB)).toBe(14 * GB);
  });
});

describe('sameModel', () => {
  it('ignores case and takes huggingface.co for hf.co', () => {
    expect(sameModel('huggingface.co/Unsloth/Qwen:Q4', 'hf.co/unsloth/qwen:q4')).toBe(true);
    expect(sameModel('hf.co/a/b:Q4', 'hf.co/a/b:Q5')).toBe(false);
  });
});

describe('tokensPerSecond', () => {
  const stats = { kind: 'main' as const, model: 'm', status: 200, inputTokens: 1, firstTokenMs: 1, historyHasThinking: false, error: null };

  it('divides the output by the time it took', () => {
    expect(tokensPerSecond({ ...stats, outputTokens: 60, generationMs: 2000 })).toBe(30);
  });

  it('is null for a reply that was not measured', () => {
    expect(tokensPerSecond({ ...stats, outputTokens: null, generationMs: 2000 })).toBeNull();
    expect(tokensPerSecond({ ...stats, outputTokens: 60, generationMs: 0 })).toBeNull();
  });
});
