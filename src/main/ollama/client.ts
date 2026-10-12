// a thin client for the parts of Ollama's HTTP API wrontend reads

import type { LoadedModel, ModelDetails, ModelSummary } from '@shared/ollama';

const DEFAULT_HOST = 'http://127.0.0.1:11434';

// OLLAMA_HOST may be "host", "host:port", ":port", "0.0.0.0:port" or a full URL. a bare host takes Ollama's port; a URL with a scheme is taken as written
export function resolveBaseUrl(host: string | undefined): string {
  if (!host || !host.trim()) return DEFAULT_HOST;
  let value = host.trim();
  const hasScheme = /^https?:\/\//.test(value);
  if (value.startsWith(':')) value = `127.0.0.1${value}`;
  if (!hasScheme) value = `http://${value}`;
  const url = new URL(value);
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (!hasScheme && !url.port) url.port = '11434';
  return url.origin;
}

export class OllamaClient {
  // the address follows Settings, so it changes under a running client
  constructor(public baseUrl: string, private readonly timeoutMs = 3000) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown, timeoutMs = this.timeoutMs, method = 'POST'): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error((await errorOf(res)) ?? `${path} answered ${res.status}`);
    // /api/delete answers with an empty body
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async version(): Promise<string> {
    return (await this.get<{ version: string }>('/api/version')).version;
  }

  async models(): Promise<ModelSummary[]> {
    const { models } = await this.get<{ models: TagsModel[] }>('/api/tags');
    return models.map((m) => ({
      name: m.name,
      digest: m.digest,
      sizeBytes: m.size,
      family: m.details?.family ?? null,
      parameterSize: m.details?.parameter_size ?? null,
      quantization: m.details?.quantization_level ?? null,
    }));
  }

  async loaded(): Promise<LoadedModel[]> {
    const { models } = await this.get<{ models: PsModel[] }>('/api/ps');
    return models.map((m) => ({
      name: m.name,
      sizeBytes: m.size,
      vramBytes: m.size_vram,
      contextLength: m.context_length ?? null,
    }));
  }

  async show(name: string): Promise<ModelDetails> {
    const s = await this.post<ShowResponse>('/api/show', { model: name });
    return parseShow(name, s);
  }

  // the sha256 of each file the model is made from -- its weights and projector -- read off the FROM lines of its Modelfile
  async blobs(name: string): Promise<string[]> {
    const s = await this.post<ShowResponse>('/api/show', { model: name });
    return [...(s.modelfile ?? '').matchAll(/^FROM\s+.*sha256[-:]([0-9a-f]{64})\s*$/gm)].map((m) => m[1]);
  }

  // a model made from another one already in Ollama: new settings over the same weights, so nothing is downloaded and only a
  // manifest and a small layer are written. it takes seconds, longer than a read
  async create(request: CreateRequest): Promise<void> {
    await this.post('/api/create', { ...request, stream: false }, 120_000);
  }

  // downloads a model, reporting each line of Ollama's progress. an aborted pull stops the download; Ollama keeps what it has
  // and the next pull of the same model goes on from there
  async pull(name: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: name, stream: true }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error((await errorOf(res)) ?? `/api/pull answered ${res.status}`);
    const decoder = new TextDecoder();
    let buffered = '';
    let done = false;
    const take = (line: string) => {
      if (!line.trim()) return;
      const progress = JSON.parse(line) as PullProgress & { error?: string };
      if (progress.error) throw new Error(progress.error);
      if (progress.status === 'success') done = true;
      onProgress(progress);
    };
    for await (const chunk of res.body) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline: number;
      while ((newline = buffered.indexOf('\n')) >= 0) {
        take(buffered.slice(0, newline));
        buffered = buffered.slice(newline + 1);
      }
    }
    take(buffered + decoder.decode());
    if (!done) throw new Error('Ollama ended the download before it was complete');
  }

  // removes the model's manifest; Ollama removes a blob once no other model uses it
  async delete(name: string): Promise<void> {
    await this.post('/api/delete', { model: name }, 30_000, 'DELETE');
  }

  // an empty prompt with no keep-alive unloads the model without generating anything
  async unload(name: string): Promise<void> {
    await this.post('/api/generate', { model: name, keep_alive: 0, stream: false }, 30_000);
  }
}

// one line of /api/pull: a layer being downloaded carries its digest, its size and how much of it has arrived
export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

export interface CreateRequest {
  model: string;
  from: string;
  renderer?: string;
  parser?: string;
}

async function errorOf(res: Response): Promise<string | null> {
  try {
    const body = (await res.json()) as { error?: unknown };
    return typeof body.error === 'string' ? body.error : null;
  } catch {
    return null;
  }
}

// /api/show has no renderer field -- a renderer shows only as a RENDERER line in the generated Modelfile
export function parseShow(name: string, s: ShowResponse): ModelDetails {
  const info = s.model_info ?? {};
  const contextKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
  const context = contextKey ? info[contextKey] : null;
  const text = (key: string) => (typeof info[key] === 'string' && info[key] ? (info[key] as string) : null);
  return {
    name,
    capabilities: s.capabilities ?? [],
    hasRenderer: /^RENDERER\s+\S+/m.test(s.modelfile ?? ''),
    contextLength: typeof context === 'number' ? context : null,
    architecture: text('general.architecture'),
    baseModel: repoId(text('general.base_model.0.repo_url')),
    basename: text('general.basename'),
  };
}

// https://huggingface.co/Qwen/Qwen3.8-27B -> Qwen/Qwen3.8-27B; a URL anywhere else names no repo wrontend can match
function repoId(url: string | null): string | null {
  const match = url ? /^https:\/\/huggingface\.co\/([^/]+\/[^/?#]+)\/?$/.exec(url) : null;
  return match ? match[1] : null;
}

interface TagsModel {
  name: string;
  digest: string;
  size: number;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

interface PsModel {
  name: string;
  size: number;
  size_vram: number;
  context_length?: number;
}

export interface ShowResponse {
  capabilities?: string[];
  modelfile?: string;
  model_info?: Record<string, unknown>;
}
