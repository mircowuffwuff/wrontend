// polls Ollama and reports its status whenever something about it changes

import type { OllamaStatus } from '@shared/ollama';
import type { OllamaClient } from './client';

export class OllamaMonitor {
  private timer: NodeJS.Timeout | null = null;
  private last: OllamaStatus;
  private lastJson = '';

  constructor(
    private readonly client: OllamaClient,
    private readonly onChange: (status: OllamaStatus) => void,
    private readonly intervalMs = 3000,
  ) {
    this.last = { baseUrl: client.baseUrl, reachable: false, version: null, loaded: [] };
  }

  get status(): OllamaStatus {
    return this.last;
  }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<OllamaStatus> {
    let next: OllamaStatus;
    try {
      const [version, loaded] = await Promise.all([this.client.version(), this.client.loaded()]);
      next = { baseUrl: this.client.baseUrl, reachable: true, version, loaded };
    } catch {
      next = { baseUrl: this.client.baseUrl, reachable: false, version: null, loaded: [] };
    }
    const json = JSON.stringify(next);
    this.last = next;
    if (json !== this.lastJson) {
      this.lastJson = json;
      this.onChange(next);
    }
    return next;
  }
}
