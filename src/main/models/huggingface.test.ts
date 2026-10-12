import { describe, expect, it } from 'vitest';
import type { Hardware } from '@shared/models';
import { sameModel } from '@shared/models';
import { fakeHardware, fakeSource } from './fake-source';
import { fitOf, headroom, projectorOf, quantTag, repoDetails } from './huggingface';

const GB = 1e9;

describe('quant tags', () => {
  it.each([
    ['Qwen3.8-27B-UD-IQ3_S.gguf', 'UD-IQ3_S'],
    ['Qwen3.8-27B-Q4_0.gguf', 'Q4_0'],
    ['Qwen3.8-27B-UD-Q8_K_XL.gguf', 'UD-Q8_K_XL'],
    ['model.Q4_K_M.gguf', 'Q4_K_M'],
    ['gemma-4-12b-it-q4_k_m.gguf', 'q4_k_m'],
    ['gpt-oss-120b-MXFP4_MOE.gguf', 'MXFP4_MOE'],
    ['Qwen3.8-27B-BF16.gguf', 'BF16'],
  ])('%s pulls as %s', (file, tag) => {
    expect(quantTag(file)).toBe(tag);
  });

  it.each([
    'mmproj-BF16.gguf',
    'imatrix_unsloth.gguf',
    'mtp-Qwen3.8-27B-Q4_0.gguf',
    'Qwen3.8-27B-Q8_0-00001-of-00002.gguf',
    'BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf',
    'Q4_K_M/model-Q4_K_M.gguf',
    'README.md',
    'model.gguf',
  ])('%s is not a quant to pull', (file) => {
    expect(quantTag(file)).toBeNull();
  });
});

describe('fit', () => {
  // the GPU memory Ollama reports for a 16 GB card, at a 64K context
  const card: Hardware = { gpuBytes: 15.2 * 2 ** 30, ramBytes: 32 * 2 ** 30, contextLength: 65536, source: 'ollama' };
  const projector = 0.93 * GB;

  it('matches what runs where on a 16 GB card at 64K', () => {
    expect(fitOf(12.0 * GB, projector, card)).toBe('gpu');
    expect(fitOf(13.1 * GB, 0, card)).toBe('gpu');
    expect(fitOf(13.1 * GB, projector, card)).toBe('partial');
    expect(fitOf(14.3 * GB, projector, card)).toBe('partial');
    expect(fitOf(54.7 * GB, projector, card)).toBe('too-large');
  });

  it('needs more room for a longer context', () => {
    expect(headroom(131072)).toBeGreaterThan(headroom(65536));
    expect(fitOf(12.0 * GB, projector, { ...card, contextLength: 131072 })).toBe('partial');
    expect(fitOf(13.1 * GB, projector, { ...card, contextLength: 8192 })).toBe('gpu');
  });
});

describe('repo details', () => {
  it('lists the quants smallest first, preselects the largest that fits, and counts the projector', async () => {
    const details = repoDetails('smoke-test/Qwen3.8-27B-GGUF', await fakeSource.files('smoke-test/Qwen3.8-27B-GGUF'), fakeHardware);
    expect(details.quants.map((q) => q.tag)).toEqual(['UD-IQ2_XXS', 'UD-IQ3_XXS', 'UD-IQ3_S', 'UD-Q3_K_XL', 'UD-IQ4_XS', 'UD-Q4_K_M', 'UD-Q5_K_M', 'UD-Q8_K_XL', 'BF16']);
    expect(details.projectorBytes).toBe(0.93 * GB);
    expect(details.recommended).toBe('UD-IQ3_S');
    expect(details.quants.find((q) => q.tag === 'UD-IQ3_S')).toMatchObject({ name: 'hf.co/smoke-test/Qwen3.8-27B-GGUF:UD-IQ3_S', fit: 'gpu' });
    expect(details.quants.at(-1)?.fit).toBe('too-large');
  });

  it('recommends up to Q8_0 when the unquantized weights fit too, and those only when nothing smaller does', () => {
    const file = (path: string, gb: number) => ({ path, sizeBytes: gb * GB, sha256: null });
    const small = [file('Qwen3.5-4B-Q4_K_M.gguf', 2.7), file('Qwen3.5-4B-Q8_0.gguf', 4.5), file('Qwen3.5-4B-BF16.gguf', 8.4), file('Qwen3.5-4B-F32.gguf', 16.8)];
    expect(repoDetails('unsloth/Qwen3.5-4B-GGUF', small, fakeHardware).recommended).toBe('Q8_0');
    const unquantized = [file('tiny-F32.gguf', 1.6), file('tiny-BF16.gguf', 0.8)];
    expect(repoDetails('someone/tiny-GGUF', unquantized, fakeHardware).recommended).toBe('BF16');
  });

  it('says nothing about fit without hardware to measure against', async () => {
    const details = repoDetails('smoke-test/Qwen3.8-27B-GGUF', await fakeSource.files('smoke-test/Qwen3.8-27B-GGUF'), null);
    expect(details.quants.every((q) => q.fit === null)).toBe(true);
    expect(details.recommended).toBeNull();
  });
});

describe('the projector', () => {
  const file = (path: string, gb: number) => ({ path, sizeBytes: gb * GB, sha256: null });

  it('is the BF16 one where there is one, as a pull takes it', () => {
    expect(projectorOf([file('mmproj-F16.gguf', 0.672), file('mmproj-BF16.gguf', 0.676), file('mmproj-F32.gguf', 1.334)])?.path).toBe('mmproj-BF16.gguf');
    expect(projectorOf([file('mmproj-F32.gguf', 1.334), file('mmproj-F16.gguf', 0.672)])?.path).toBe('mmproj-F16.gguf');
  });

  it('is counted at its largest when no precision is known, and is absent from a text model', () => {
    expect(projectorOf([file('mmproj-Q8_0.gguf', 0.4), file('mmproj-F32.gguf', 1.334)])?.path).toBe('mmproj-F32.gguf');
    expect(projectorOf([file('model-Q4_K_M.gguf', 2.7), file('sub/mmproj-BF16.gguf', 0.7)])).toBeNull();
  });
});

describe('installed models', () => {
  it('match whatever case and host they were pulled with', () => {
    expect(sameModel('hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S', 'hf.co/unsloth/qwen3.8-27b-gguf:ud-iq3_s')).toBe(true);
    expect(sameModel('huggingface.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S', 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S')).toBe(true);
    expect(sameModel('hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_S', 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS')).toBe(false);
  });
});
