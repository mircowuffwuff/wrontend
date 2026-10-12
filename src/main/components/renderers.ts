// which of Ollama's built-in renderers and parsers a model family uses. Ollama publishes no list of them and /api/show has no
// field for them; an official build names its pair in the config blob of its manifest, which scripts/refresh-renderers.mjs reads
// from the registry into renderers.json for each row's official tags.
// a row matches by the base model a GGUF names -- uploaders such as Unsloth record the Hugging Face repo it was quantised from --
// and by architecture. the architecture alone is not enough: Qwen3.5 and Qwen3.8 are both qwen35 and take different renderers

import type { ModelDetails } from '@shared/ollama';
import shipped from './renderers.json';

export interface RendererFamily {
  // the start of a base model's Hugging Face repo id, e.g. Qwen/Qwen3.8-
  base: string;
  architectures: string[];
  // the official builds the renderer and parser were read from
  official: string[];
  renderer: string;
  parser: string;
  // the oldest Ollama that knows them
  requires: string;
}

export interface RendererTable {
  families: RendererFamily[];
}

export const RENDERERS: RendererTable = shipped;

// a GGUF that names no base model is matched by its basename against the repo part of the row's base, Qwen3.8-27B by Qwen3.8-
export function rendererFor(table: RendererTable, details: Pick<ModelDetails, 'architecture' | 'baseModel' | 'basename'>): RendererFamily | null {
  if (!details.architecture) return null;
  const architecture = details.architecture;
  return (
    table.families.find((f) => {
      if (!f.architectures.includes(architecture)) return false;
      const base = f.base.toLowerCase();
      if (details.baseModel) return details.baseModel.toLowerCase().startsWith(base);
      const repo = base.slice(base.indexOf('/') + 1);
      return !!details.basename && `${details.basename}-`.toLowerCase().startsWith(repo);
    }) ?? null
  );
}
