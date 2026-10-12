// the model browser's source: GGUF repos on Hugging Face, through its public API. Ollama's library has no search API, and
// Hugging Face's also gives each file's sha256, which is the digest Ollama stores for a pulled blob -- what the updater compares

import type { Fit, Hardware, Quant, RepoDetails, RepoSummary } from '@shared/models';

const API = 'https://huggingface.co/api';

export interface RepoFile {
  path: string;
  sizeBytes: number;
  sha256: string | null;
}

// where the browser reads repos and their files; the smoke test answers from memory
export interface ModelSource {
  search(query: string): Promise<RepoSummary[]>;
  files(repo: string): Promise<RepoFile[]>;
}

export class HuggingFace implements ModelSource {
  constructor(private readonly timeoutMs = 15_000) {}

  // an empty query lists the most downloaded GGUF repos. GGUF also carries speech, image and embedding models, which a harness
  // cannot talk to; a repo's pipeline tag says which it is, though many chat models carry none, so only the others are dropped
  async search(query: string): Promise<RepoSummary[]> {
    const params = new URLSearchParams({ filter: 'gguf', sort: 'downloads', direction: '-1', limit: '60' });
    if (query.trim()) params.set('search', query.trim());
    for (const field of ['gguf', 'downloads', 'likes', 'lastModified', 'pipeline_tag']) params.append('expand[]', field);
    const repos = await this.get<ApiRepo[]>(`/models?${params}`);
    return repos.filter((r) => !r.pipeline_tag || CHAT.has(r.pipeline_tag)).slice(0, 40).map((r) => ({
      id: r.id,
      downloads: r.downloads ?? 0,
      likes: r.likes ?? 0,
      updatedAt: r.lastModified ?? null,
      architecture: r.gguf?.architecture ?? null,
      parameters: typeof r.gguf?.total === 'number' ? r.gguf.total : null,
    }));
  }

  // the files at the repo's top level: Ollama pulls a quant by its tag, and finds no file in a subfolder that way
  async files(repo: string): Promise<RepoFile[]> {
    const entries = await this.get<ApiEntry[]>(`/models/${repo}/tree/main`);
    return entries
      .filter((e) => e.type === 'file')
      .map((e) => ({ path: e.path, sizeBytes: e.lfs?.size ?? e.size ?? 0, sha256: e.lfs?.oid ?? null }));
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${API}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (res.status === 404) throw new Error('Hugging Face has no such repo.');
    if (!res.ok) throw new Error(`Hugging Face answered ${res.status}.`);
    return (await res.json()) as T;
  }
}

// the quant at the end of a GGUF file's name: Qwen3.8-27B-UD-IQ3_S.gguf -> UD-IQ3_S, model.Q4_K_M.gguf -> Q4_K_M
const QUANT = /[-._]((?:UD-)?(?:I?Q\d+(?:_[A-Z0-9]+)*|TQ\d(?:_\d)?|BF16|F16|F32|MXFP4(?:_[A-Z0-9]+)*))$/i;
// one part of a quant split across files, which Ollama does not pull by tag
const SHARD = /-\d{5}-of-\d{5}\.gguf$/i;

export function quantTag(file: string): string | null {
  if (file.includes('/') || !file.toLowerCase().endsWith('.gguf') || SHARD.test(file)) return null;
  const name = file.toLowerCase();
  // projectors ride along with the pull, the importance matrix is for quantising, an MTP file is a draft model for another
  if (name.includes('mmproj') || name.includes('imatrix') || name.startsWith('mtp-')) return null;
  return QUANT.exec(file.slice(0, -'.gguf'.length))?.[1] ?? null;
}

// the space a model needs beyond its file: the context's cache and the runner's buffers. a rule fitted on Qwen3.8 27B quants
// at a 64K context on a 16 GB card -- IQ3_S with its projector runs fully on the GPU, Q3_K_XL with its projector does not --
// and an estimate for any other model, whose cache per token differs with its architecture
export function headroom(contextLength: number): number {
  return 1.5e9 + 1.5e9 * (contextLength / 65536);
}

export function fitOf(sizeBytes: number, projectorBytes: number, hardware: Hardware): Fit {
  const need = sizeBytes + projectorBytes + headroom(hardware.contextLength);
  if (need <= hardware.gpuBytes) return 'gpu';
  // what spills over runs from RAM, which also holds the system and every other program: a quarter is left to them
  if (need <= hardware.gpuBytes + hardware.ramBytes * 0.75) return 'partial';
  return 'too-large';
}

// the projector a pull brings along. a repo often offers it in several precisions, and the pull takes the BF16 one where there
// is one; with neither BF16 nor F16 the largest is counted, so a fit is never claimed on too little
export function projectorOf(files: RepoFile[]): RepoFile | null {
  const projectors = files.filter((f) => !f.path.includes('/') && f.path.toLowerCase().includes('mmproj'));
  const named = (precision: string) => projectors.find((f) => new RegExp(`[-_.]${precision}\\.gguf$`, 'i').test(f.path));
  return named('BF16') ?? named('F16') ?? projectors.sort((a, b) => b.sizeBytes - a.sizeBytes)[0] ?? null;
}

export function repoDetails(repo: string, files: RepoFile[], hardware: Hardware | null): RepoDetails {
  const projectorBytes = projectorOf(files)?.sizeBytes ?? 0;
  const quants: Quant[] = [];
  for (const file of files) {
    const tag = quantTag(file.path);
    if (!tag) continue;
    const name = `hf.co/${repo}:${tag}`;
    quants.push({
      tag,
      name,
      file: file.path,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      fit: hardware ? fitOf(file.sizeBytes, projectorBytes, hardware) : null,
    });
  }
  quants.sort((a, b) => a.sizeBytes - b.sizeBytes);
  const fitting = quants.filter((q) => q.fit === 'gpu');
  return { id: repo, quants, projectorBytes, recommended: fitting.at(-1)?.tag ?? null, hardware };
}

const CHAT = new Set(['text-generation', 'image-text-to-text']);

interface ApiRepo {
  id: string;
  pipeline_tag?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  gguf?: { total?: number; architecture?: string };
}

interface ApiEntry {
  type: 'file' | 'directory';
  path: string;
  size?: number;
  lfs?: { oid: string; size: number };
}
