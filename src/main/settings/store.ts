// the settings file: read once at start, written whole and atomically on every change.
// a value the file holds but this version does not know is dropped; a missing one takes its default

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { CHOICES, DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings';

export class SettingsStore {
  private current: Settings;

  constructor(
    private readonly file: string,
    private readonly onChange: (settings: Settings) => void = () => {},
  ) {
    this.current = merge(DEFAULT_SETTINGS, read(file));
  }

  get value(): Settings {
    return this.current;
  }

  update(patch: SettingsPatch): Settings {
    this.current = merge(this.current, patch);
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.current, null, 2));
    renameSync(temp, this.file);
    this.onChange(this.current);
    return this.current;
  }
}

function read(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // missing or unreadable: the defaults stand, and the next change writes a good file
    return {};
  }
}

// takes from the patch only the keys the base has, only values of the same type as the base's, and for a choice only one of its values
export function merge(base: Settings, patch: unknown): Settings {
  if (!isObject(patch)) return base;
  const out = structuredClone(base) as unknown as Record<string, Record<string, unknown>>;
  const choices = CHOICES as unknown as Record<string, Record<string, readonly unknown[]> | undefined>;
  for (const [section, values] of Object.entries(out)) {
    const incoming = patch[section];
    if (!isObject(incoming)) continue;
    for (const key of Object.keys(values)) {
      const value = incoming[key];
      if (!(key in incoming) || typeof value !== typeof values[key]) continue;
      const allowed = choices[section]?.[key];
      if (allowed && !allowed.includes(value)) continue;
      values[key] = value;
    }
  }
  return out as unknown as Settings;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
