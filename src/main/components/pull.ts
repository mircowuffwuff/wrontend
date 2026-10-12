// model downloads as components: a model pulled into the user's Ollama, from Hugging Face or Ollama's library. Ollama keeps
// the model, so nothing lands in wrontend's folders and nothing in its manifest; whether a model is there is Ollama's list

import type { ComponentState } from '@shared/components';
import type { PullProgress } from '../ollama/client';
import type { Driver } from './engine';
import { InstallError } from './npm';

const ID_PREFIX = 'pull:';
// Ollama writes a progress line many times a second; the app is told of it this often
const REPORT_MS = 250;

export interface PullingOllama {
  pull(name: string, onProgress: (progress: PullProgress) => void, signal?: AbortSignal): Promise<void>;
}

export function pullId(name: string): string {
  return ID_PREFIX + name;
}

export function pulledName(id: string): string {
  return id.slice(ID_PREFIX.length);
}

export class ModelPulls implements Driver {
  readonly kind = 'ollama-pull';
  private readonly aborts = new Map<string, AbortController>();

  constructor(
    private readonly ollama: PullingOllama,
    // whether Ollama's model list, as last read, has the model
    private readonly present: (name: string) => boolean,
    private readonly reportMs = REPORT_MS,
  ) {}

  owns(id: string): boolean {
    return id.startsWith(ID_PREFIX);
  }

  state(id: string): ComponentState {
    return this.present(pulledName(id)) ? { status: 'installed', version: null } : { status: 'missing' };
  }

  // the layers' sizes add up to the model's: the weights, a projector, and small ones for the template and parameters
  async install(id: string, report: (step: string, bytes: number, total?: number) => void): Promise<void> {
    const name = pulledName(id);
    const controller = new AbortController();
    this.aborts.set(id, controller);
    const layers = new Map<string, { total: number; completed: number }>();
    let step = '';
    let reported = 0;
    const sum = () => {
      let total = 0;
      let completed = 0;
      for (const layer of layers.values()) {
        total += layer.total;
        completed += layer.completed;
      }
      return { total, completed };
    };
    const tell = (next: string) => {
      const now = Date.now();
      if (next === step && now - reported < this.reportMs) return;
      step = next;
      reported = now;
      const { total, completed } = sum();
      report(next, completed, total || undefined);
    };
    report('Starting', 0);
    try {
      await this.ollama.pull(
        name,
        (progress) => {
          if (progress.digest && progress.total) {
            layers.set(progress.digest, { total: progress.total, completed: progress.completed ?? 0 });
            tell('Downloading');
          } else if (progress.status.startsWith('verifying')) tell('Verifying');
          else if (progress.status === 'writing manifest') tell('Finishing');
        },
        controller.signal,
      );
    } catch (cause) {
      if (controller.signal.aborted) throw cause;
      throw new InstallError(`Ollama could not download ${name}.`, (cause as Error).message);
    } finally {
      this.aborts.delete(id);
    }
  }

  cancel(id: string): void {
    this.aborts.get(id)?.abort();
  }
}
