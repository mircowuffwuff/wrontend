import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@shared/settings';
import { tempFolder } from '../temp-folder';
import { SettingsStore } from './store';

const file = () => join(tempFolder('wrontend-settings-'), 'settings.json');

describe('the settings file', () => {
  it('starts from the defaults when there is no file', () => {
    expect(new SettingsStore(file()).value).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps known values and drops unknown keys, wrong types and values that are not a choice', () => {
    const path = file();
    writeFileSync(
      path,
      JSON.stringify({
        appearance: { theme: 'dark', extra: true },
        models: { derive: 'no' },
        proxy: { backgroundPolicy: 'sometimes' },
        ollama: { address: 'http://box:11434' },
        stranger: { a: 1 },
      }),
    );
    const { value } = new SettingsStore(path);
    expect(value.appearance).toEqual({ theme: 'dark' });
    expect(value.ollama.address).toBe('http://box:11434');
    expect(value.models.derive).toBe(true);
    expect(value.proxy.backgroundPolicy).toBe(DEFAULT_SETTINGS.proxy.backgroundPolicy);
    expect(value).not.toHaveProperty('stranger');
  });

  it('survives a file that does not parse', () => {
    const path = file();
    writeFileSync(path, '{ not json');
    expect(new SettingsStore(path).value).toEqual(DEFAULT_SETTINGS);
  });

  it('writes a change through and reports it', () => {
    const path = file();
    const seen: string[] = [];
    const store = new SettingsStore(path, (s) => seen.push(s.appearance.theme));
    store.update({ appearance: { theme: 'light' } });
    expect(seen).toEqual(['light']);
    expect(JSON.parse(readFileSync(path, 'utf8')).appearance.theme).toBe('light');
    expect(new SettingsStore(path).value.appearance).toEqual({ theme: 'light' });
  });
});
