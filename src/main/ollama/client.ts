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
  constructor(readonly baseUrl: string, private readonly timeoutMs = 3000) {}

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return (await res.json()) as T;
  }

  async version(): Promise<string> {
    return (await this.get<{ version: string }>('/api/version')).version;
  }

  async models(): Promise<ModelSummary[]> {
    const { models } = await this.get<{ models: TagsModel[] }>('/api/tags');
    return models.map((m) => ({
      name: m.name,
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
}

// /api/show has no renderer field -- a renderer shows only as a RENDERER line in the generated Modelfile
export function parseShow(name: string, s: ShowResponse): ModelDetails {
  const info = s.model_info ?? {};
  const contextKey = Object.keys(info).find((k) => k.endsWith('.context_length'));
  const context = contextKey ? info[contextKey] : null;
  return {
    name,
    capabilities: s.capabilities ?? [],
    hasRenderer: /^RENDERER\s+\S+/m.test(s.modelfile ?? ''),
    contextLength: typeof context === 'number' ? context : null,
  };
}

interface TagsModel {
  name: string;
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
