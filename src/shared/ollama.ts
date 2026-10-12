// what main knows about Ollama, in the shape the renderer receives it

import type { ComponentState } from './components';

export interface LoadedModel {
  name: string;
  sizeBytes: number;
  vramBytes: number;
  contextLength: number | null;
}

export interface OllamaStatus {
  baseUrl: string;
  reachable: boolean;
  version: string | null;
  loaded: LoadedModel[];
}

export interface ModelSummary {
  name: string;
  // the manifest's digest: a model pulled again, or replaced, gets a new one
  digest: string;
  sizeBytes: number;
  family: string | null;
  parameterSize: string | null;
  quantization: string | null;
}

export interface ModelDetails {
  name: string;
  capabilities: string[];
  // a thinking model without one loses its earlier reasoning inside Ollama
  hasRenderer: boolean;
  contextLength: number | null;
  // the GGUF's general.architecture, e.g. qwen35
  architecture: string | null;
  // the model it was made from, as a Hugging Face repo id such as Qwen/Qwen3.8-27B, from the GGUF's base-model metadata
  baseModel: string | null;
  // the GGUF's general.basename, e.g. Qwen3.8-27B
  basename: string | null;
}

// whether a model keeps its earlier reasoning in Ollama, and what wrontend does about it
export type ModelReasoning =
  // not a thinking model, or one with a renderer
  | { status: 'kept' }
  // wrontend routes the model to a copy of it with a renderer, in this state
  | { status: 'derived'; state: ComponentState }
  // reason says why wrontend cannot keep it
  | { status: 'lost'; reason: string };

// a model as the model picker lists it
export interface ModelEntry extends ModelSummary {
  reasoning: ModelReasoning;
}
