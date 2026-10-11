// what main knows about Ollama, in the shape the renderer receives it

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
}
