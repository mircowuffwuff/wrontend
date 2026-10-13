import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempFolder } from '../temp-folder';
import { DefaultsStore } from './defaults';

const file = () => join(tempFolder('wrontend-defaults-'), 'defaults.json');

describe('the defaults of a new session', () => {
  it('start with nothing picked and thinking on', () => {
    expect(new DefaultsStore(file()).value).toEqual({ harness: null, model: null, effort: 'on' });
  });

  it('keep what was picked across a restart', () => {
    const path = file();
    new DefaultsStore(path).update({ harness: 'claude-code', model: 'qwen', effort: 'off' });
    new DefaultsStore(path).update({ model: null });
    expect(new DefaultsStore(path).value).toEqual({ harness: 'claude-code', model: null, effort: 'off' });
  });

  it('fall back where the file holds something else', () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ harness: 3, model: 'qwen', effort: 'max' }));
    expect(new DefaultsStore(path).value).toEqual({ harness: null, model: 'qwen', effort: 'on' });
  });
});
