// the smoke test's stand-ins for finding and pulling models: a Hugging Face answered from memory, a pull that reports
// progress and downloads nothing, and a fixed machine, so the test never depends on the network or on the hardware it runs on

import type { Hardware, RepoSummary } from '@shared/models';
import type { PullProgress } from '../ollama/client';
import type { PullingOllama } from '../components/pull';
import type { InstalledModels, ManifestReader } from '../updates/model-source';
import type { ModelSource, RepoFile } from './huggingface';

const GB = 1e9;

const REPOS: RepoSummary[] = [
  { id: 'smoke-test/Qwen3.8-27B-GGUF', downloads: 6_488_262, likes: 5026, updatedAt: '2026-08-20T12:04:25.000Z', architecture: 'qwen35', parameters: 27.3e9 },
  { id: 'unsloth/gemma-4-12b-it-GGUF', downloads: 2_104_377, likes: 1840, updatedAt: '2026-09-02T08:11:00.000Z', architecture: 'gemma4', parameters: 12.2e9 },
  { id: 'bartowski/Qwen3.6-35B-A3B-GGUF', downloads: 911_204, likes: 702, updatedAt: '2026-06-14T17:40:00.000Z', architecture: 'qwen35moe', parameters: 35.1e9 },
];

const FILES: RepoFile[] = [
  ['BF16/Qwen3.8-27B-BF16-00001-of-00002.gguf', 50.0],
  ['Qwen3.8-27B-UD-IQ2_XXS.gguf', 7.3],
  ['Qwen3.8-27B-UD-IQ3_XXS.gguf', 10.9],
  ['Qwen3.8-27B-UD-IQ3_S.gguf', 12.0],
  ['Qwen3.8-27B-UD-Q3_K_XL.gguf', 13.1],
  ['Qwen3.8-27B-UD-IQ4_XS.gguf', 14.3],
  ['Qwen3.8-27B-UD-Q4_K_M.gguf', 16.5],
  ['Qwen3.8-27B-UD-Q5_K_M.gguf', 19.8],
  ['Qwen3.8-27B-UD-Q8_K_XL.gguf', 31.5],
  ['Qwen3.8-27B-BF16.gguf', 54.7],
  ['imatrix_unsloth.gguf', 0.01],
  ['mmproj-BF16.gguf', 0.93],
].map(([path, gb]) => ({ path: path as string, sizeBytes: Math.round((gb as number) * GB), sha256: null }));

export const fakeSource: ModelSource = {
  async search(query) {
    const q = query.trim().toLowerCase();
    return REPOS.filter((r) => !q || r.id.toLowerCase().includes(q));
  },
  async files(repo) {
    if (repo !== REPOS[0].id) throw new Error('Hugging Face has no such repo.');
    return FILES;
  },
};

export const fakeHardware: Hardware = { gpuBytes: 15.2 * 2 ** 30, ramBytes: 32 * 2 ** 30, contextLength: 65536, source: 'ollama' };

// four seconds of a download that gets halfway, then the refusal a failed pull ends in
export const fakePulling: PullingOllama = {
  async pull(_name, onProgress: (progress: PullProgress) => void, signal) {
    const total = 12 * GB;
    onProgress({ status: 'pulling manifest' });
    for (let n = 1; n <= 40; n++) {
      await new Promise((r) => setTimeout(r, 100));
      if (signal?.aborted) throw new Error('aborted');
      onProgress({ status: 'pulling d847e2c1e4aa', digest: 'sha256:d847e2c1e4aa', total, completed: (total * n) / 80 });
    }
    throw new Error('this run downloads nothing');
  },
};

// the updater's view of Ollama in the smoke test: one model, whose registry has a newer upload of its weights since
export const fakeInstalled: InstalledModels = {
  async models() {
    return [{ name: 'hf.co/smoke-test/Qwen3.8-27B-GGUF:UD-Q4_K_M', digest: '1'.repeat(64) }];
  },
  async blobs() {
    return ['a'.repeat(64), 'b'.repeat(64)];
  },
};

export const fakeManifests: ManifestReader = async () => ({
  digest: '2'.repeat(64),
  layers: [
    { mediaType: 'application/vnd.ollama.image.model', digest: `sha256:${'c'.repeat(64)}`, size: Math.round(12.0 * GB) },
    { mediaType: 'application/vnd.ollama.image.projector', digest: `sha256:${'b'.repeat(64)}`, size: Math.round(0.93 * GB) },
    { mediaType: 'application/vnd.ollama.image.template', digest: `sha256:${'d'.repeat(64)}`, size: 410 },
  ],
});
