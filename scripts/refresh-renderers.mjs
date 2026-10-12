// reads the renderer and parser of each row's official Ollama builds from the registry and writes them into the renderer table.
// an official build names both in the config blob of its manifest, a few hundred bytes -- no weights are downloaded.
// a row whose builds disagree, or whose architecture is not the row's, is reported and left as it is.
//
//   node scripts/refresh-renderers.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REGISTRY = 'https://registry.ollama.ai/v2/library';
const TABLE = join(import.meta.dirname, '..', 'src', 'main', 'components', 'renderers.json');

async function config(official) {
  const [name, tag = 'latest'] = official.split(':');
  const manifest = await fetch(`${REGISTRY}/${name}/manifests/${tag}`, {
    headers: { accept: 'application/vnd.docker.distribution.manifest.v2+json' },
  });
  if (!manifest.ok) throw new Error(`${official}: the registry answered ${manifest.status}`);
  const digest = (await manifest.json()).config.digest;
  const blob = await fetch(`${REGISTRY}/${name}/blobs/${digest}`);
  if (!blob.ok) throw new Error(`${official}: its config blob answered ${blob.status}`);
  return blob.json();
}

function newer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0) ? a : b;
  }
  return a;
}

const table = JSON.parse(readFileSync(TABLE, 'utf8'));
let problems = 0;
for (const row of table.families) {
  const configs = await Promise.all(row.official.map(config));
  const pairs = new Set(configs.map((c) => `${c.renderer} ${c.parser}`));
  const foreign = configs.filter((c) => !row.architectures.includes(c.model_family));
  if (pairs.size !== 1 || configs.some((c) => !c.renderer || !c.parser) || foreign.length) {
    problems++;
    console.log(`${row.base}: left as it is -- ${[...pairs].join(' / ')}${foreign.length ? `, architecture ${foreign.map((c) => c.model_family).join(', ')}` : ''}`);
    continue;
  }
  const next = {
    renderer: configs[0].renderer,
    parser: configs[0].parser,
    requires: configs.map((c) => c.requires ?? '0.0.0').reduce(newer),
  };
  const changed = Object.keys(next).filter((k) => row[k] !== next[k]);
  Object.assign(row, next);
  console.log(`${row.base}: ${next.renderer} ${next.parser}, Ollama ${next.requires}${changed.length ? ` -- changed: ${changed.join(', ')}` : ''}`);
}
writeFileSync(TABLE, `${JSON.stringify(table, null, 2)}\n`);
process.exitCode = problems ? 1 : 0;
