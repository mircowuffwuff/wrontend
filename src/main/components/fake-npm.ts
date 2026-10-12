// a stand-in for npm that answers view and install without a network: for the engine's tests and the smoke test.
// install writes a package with the requested name and version and an empty program; slowly, when asked, so progress shows

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { onOwnNode, type Npm } from './npm';

const SCRIPT = `
const fs = require('fs');
const path = require('path');
const [command, spec] = process.argv.slice(2);
if (command === 'view') {
  console.log(JSON.stringify([process.env.FAKE_NPM_LATEST]));
  process.exit(0);
}
if (command !== 'install') process.exit(2);
if (process.env.FAKE_NPM_FAIL) {
  console.error('npm error code E404');
  console.error('npm error 404 Not Found - GET https://registry.npmjs.org/' + spec);
  process.exit(1);
}
const at = spec.lastIndexOf('@');
const name = spec.slice(0, at);
const root = path.join(process.cwd(), 'node_modules', ...name.split('/'));
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const chunks = Number(process.env.FAKE_NPM_CHUNKS || 0);
let written = 0;
const finish = () => {
  fs.writeFileSync(path.join(root, 'dist', 'index.js'), '');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name, version: spec.slice(at + 1), bin: { [name.split('/').pop()]: 'dist/index.js' } }));
};
const tick = () => {
  if (written === chunks) return finish();
  fs.writeFileSync(path.join(root, 'dist', 'part-' + written++), Buffer.alloc(8 * 1024 * 1024));
  setTimeout(tick, 250);
};
tick();
`;

export interface FakeNpmOptions {
  latest: string;
  // 8 MB written every 250 ms, this many times, before the package is whole
  chunks?: number;
  fail?: boolean;
}

export function fakeNpm(dir: string, options: FakeNpmOptions): Npm {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'fake-npm.js');
  writeFileSync(script, SCRIPT);
  const run = onOwnNode(script);
  return {
    source: 'wrontend',
    version: 'fake',
    ...run,
    env: {
      ...run.env,
      FAKE_NPM_LATEST: options.latest,
      FAKE_NPM_CHUNKS: String(options.chunks ?? 0),
      ...(options.fail ? { FAKE_NPM_FAIL: '1' } : {}),
    },
  };
}
