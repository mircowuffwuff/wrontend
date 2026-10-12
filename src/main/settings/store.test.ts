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
        appearance: { theme: 'dark', textSize: 'huge', width: 3, motion: 'reduced', extra: true },
        ollama: { address: 'http://box:11434' },
        stranger: { a: 1 },
      }),
    );
    const { value } = new SettingsStore(path);
    expect(value.appearance).toEqual({ theme: 'dark', textSize: 'medium', width: 'medium', motion: 'reduced' });
    expect(value.ollama.address).toBe('http://box:11434');
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
    const store = new SettingsStore(path, (s) => seen.push(s.appearance.width));
    store.update({ appearance: { width: 'wide' } });
    expect(seen).toEqual(['wide']);
    expect(JSON.parse(readFileSync(path, 'utf8')).appearance.width).toBe('wide');
    expect(new SettingsStore(path).value.appearance).toEqual({ ...DEFAULT_SETTINGS.appearance, width: 'wide' });
  });
});
