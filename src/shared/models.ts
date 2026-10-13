// GGUF models on Hugging Face as wrontend finds them, what fits on this machine, and their downloads into Ollama

import type { ComponentState } from './components';

// a model being downloaded into Ollama, or one whose download failed
export interface PullEntry {
  name: string;
  state: ComponentState;
}

// a GGUF repo in the search results
export interface RepoSummary {
  // owner/name, as Hugging Face writes it
  id: string;
  downloads: number;
  likes: number;
  // ISO time of the repo's last change
  updatedAt: string | null;
  // from the GGUF metadata Hugging Face reads: qwen35, gemma4, ...
  architecture: string | null;
  parameters: number | null;
}

// whether a quant runs on this machine, at the context length Ollama uses
export type Fit = 'gpu' | 'partial' | 'too-large';

export interface Quant {
  // the tag Ollama pulls it by: hf.co/<repo>:<tag>
  tag: string;
  // the model's name in Ollama once pulled
  name: string;
  file: string;
  sizeBytes: number;
  // the file's sha256, which equals the blob digest Ollama stores for it
  sha256: string | null;
  // null when wrontend cannot tell: an Ollama on another machine, or memory it could not read
  fit: Fit | null;
}

// Ollama keeps an hf.co pull under the name it was pulled by, in the case it was written in; huggingface.co is the same host
export function sameModel(a: string, b: string): boolean {
  const plain = (n: string) => n.toLowerCase().replace(/^huggingface\.co\//, 'hf.co/');
  return plain(a) === plain(b);
}

export interface RepoDetails {
  id: string;
  quants: Quant[];
  // the projector that comes with every pull of a vision model, counted in each quant's fit
  projectorBytes: number;
  // the largest quant short of full precision that fits fully on the GPU, else the smallest one that fits
  recommended: string | null;
  hardware: Hardware | null;
}

// what a quant's download comes to. Ollama announces each layer only as it starts on it, so the projector's size arrives
// once the weights are done; the repo's file sizes say the whole from the start
export function pullSize(state: ComponentState & { status: 'installing' }, quant: Quant, projectorBytes: number): number {
  return Math.max(state.total ?? 0, quant.sizeBytes + projectorBytes, state.bytes, 1);
}

export interface Hardware {
  // the GPU memory Ollama can use
  gpuBytes: number;
  ramBytes: number;
  // the context length Ollama loads models with
  contextLength: number;
  // where gpuBytes was read: Ollama's own log, or the display adapter's registry entry
  source: 'ollama' | 'registry';
}
