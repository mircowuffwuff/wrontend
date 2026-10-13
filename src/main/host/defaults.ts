// the harness, model and effort picked last, which a new session starts with: one small file in wrontend's data folder,
// written whole on every change. a value the file holds that is not one of these falls back

import type { SessionDefaults } from '@shared/session';
import { readJson, writeWhole } from './store';

export class DefaultsStore {
  private current: SessionDefaults;

  constructor(private readonly file: string) {
    this.current = valid(readJson(file));
  }

  get value(): SessionDefaults {
    return this.current;
  }

  update(patch: Partial<SessionDefaults>): SessionDefaults {
    this.current = valid({ ...this.current, ...patch });
    writeWhole(this.file, this.current);
    return this.current;
  }
}

function valid(raw: unknown): SessionDefaults {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    harness: typeof r.harness === 'string' ? r.harness : null,
    model: typeof r.model === 'string' ? r.model : null,
    effort: r.effort === 'off' ? 'off' : 'on',
  };
}
