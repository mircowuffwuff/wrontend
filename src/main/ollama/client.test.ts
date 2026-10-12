import { describe, expect, it } from 'vitest';
import { parseShow, resolveBaseUrl } from './client';

describe('resolveBaseUrl', () => {
  it.each([
    [undefined, 'http://127.0.0.1:11434'],
    ['', 'http://127.0.0.1:11434'],
    ['0.0.0.0', 'http://127.0.0.1:11434'],
    ['0.0.0.0:11500', 'http://127.0.0.1:11500'],
    [':11500', 'http://127.0.0.1:11500'],
    ['localhost:11434', 'http://localhost:11434'],
    ['http://gpu-box:8080', 'http://gpu-box:8080'],
    ['https://ollama.example', 'https://ollama.example'],
  ])('%s gives %s', (host, expected) => {
    expect(resolveBaseUrl(host)).toBe(expected);
  });
});

describe('parseShow', () => {
  it('finds a renderer only in the generated Modelfile', () => {
    const details = parseShow('m', {
      capabilities: ['completion', 'tools', 'thinking'],
      modelfile: 'FROM /blobs/sha256-x\nRENDERER qwen3.8\nPARSER qwen3.5\n',
      model_info: { 'qwen35.context_length': 262144, 'general.architecture': 'qwen35' },
    });
    expect(details).toEqual({
      name: 'm',
      capabilities: ['completion', 'tools', 'thinking'],
      hasRenderer: true,
      contextLength: 262144,
      architecture: 'qwen35',
      baseModel: null,
      basename: null,
    });
  });

  it('reads the base model a GGUF was made from as a Hugging Face repo id', () => {
    const details = parseShow('m', {
      model_info: {
        'general.basename': 'Qwen3.8-27B',
        'general.base_model.0.repo_url': 'https://huggingface.co/Qwen/Qwen3.8-27B',
      },
    });
    expect(details.baseModel).toBe('Qwen/Qwen3.8-27B');
    expect(details.basename).toBe('Qwen3.8-27B');
    expect(parseShow('m', { model_info: { 'general.base_model.0.repo_url': 'https://example.com/Qwen/Qwen3.8-27B' } }).baseModel).toBeNull();
  });

  it('reports a model without a renderer', () => {
    expect(parseShow('m', { modelfile: 'FROM /blobs/sha256-x\nTEMPLATE "{{ .Prompt }}"\n' }).hasRenderer).toBe(false);
  });
});
