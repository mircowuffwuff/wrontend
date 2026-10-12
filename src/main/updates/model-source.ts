// models in Ollama: one is out of date when its registry serves a different manifest under the same name. GGUF uploads carry
// no versions, but Ollama's digest for a model is the sha256 of the manifest it pulled -- from registry.ollama.ai for a
// library model, from Hugging Face's registry for an hf.co one -- so hashing the manifest served now tells whether a pull
// of the same name would change anything. a new template or new parameters count too: the pull fetches only what changed.
// a model no registry serves under its name -- one made with /api/create, wrontend's own copies -- has nothing to update

import { createHash } from 'node:crypto';
import { isDerived } from '../components/derived';
import { pullId } from '../components/pull';
import type { Found, UpdateSource } from './updater';

const MANIFEST_TYPE = 'application/vnd.docker.distribution.manifest.v2+json';
const TIMEOUT_MS = 15_000;

export interface Manifest {
  // the sha256 of the manifest as served, in hex: what Ollama's model list calls the model's digest
  digest: string;
  layers: { mediaType: string; digest: string; size: number }[];
}

export interface InstalledModels {
  models(): Promise<{ name: string; digest: string }[]>;
  // the sha256 of each file the model is made from, in hex: its weights and projector
  blobs(name: string): Promise<string[]>;
}

// null when the registry serves no model of that name
export type ManifestReader = (name: string) => Promise<Manifest | null>;

// where Ollama pulls a model from: a bare name is in the library, a namespaced one on registry.ollama.ai, and anything with a
// host in front from that host; hf.co is Hugging Face's own registry, which hf.co redirects to
export function manifestUrl(name: string): string {
  const slash = name.lastIndexOf('/');
  const colon = name.lastIndexOf(':');
  const [base, tag] = colon > slash ? [name.slice(0, colon), name.slice(colon + 1)] : [name, 'latest'];
  const parts = base.split('/');
  let host = 'registry.ollama.ai';
  let path = parts;
  if (parts.length === 1) path = ['library', parts[0]];
  else if (parts.length > 2) {
    host = /^(hf\.co|huggingface\.co)(:443)?$/i.test(parts[0]) ? 'huggingface.co' : parts[0];
    path = parts.slice(1);
  }
  return `https://${host}/v2/${path.join('/')}/manifests/${tag}`;
}

export async function readManifest(name: string): Promise<Manifest | null> {
  const url = manifestUrl(name);
  const host = new URL(url).host;
  const res = await fetch(url, { headers: { accept: MANIFEST_TYPE }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
    throw new Error(`${host} could not be reached`);
  });
  // Hugging Face answers a tag that names no quant with 400, and a repo it has none of -- or one gated or private -- with 401
  if (res.status === 404 || res.status === 400 || res.status === 401) return null;
  if (!res.ok) throw new Error(`${host} answered ${res.status} for ${name}`);
  const body = Buffer.from(await res.arrayBuffer());
  const parsed = JSON.parse(body.toString('utf8')) as { layers?: Manifest['layers'] };
  return { digest: createHash('sha256').update(body).digest('hex'), layers: parsed.layers ?? [] };
}

export function modelUpdates(ollama: InstalledModels, read: ManifestReader = readManifest): UpdateSource {
  return {
    group: 'models',
    async check() {
      // with Ollama not running there is nothing to compare, and the sidebar already says so
      const models = (await ollama.models().catch(() => [])).filter((m) => !isDerived(m.name));
      const found = await Promise.all(
        models.map(async (model): Promise<Found | null> => {
          const manifest = await read(model.name);
          if (!manifest || manifest.digest === hex(model.digest)) return null;
          const have = new Set((await ollama.blobs(model.name)).map(hex));
          // the template and parameters are a few bytes; the weights and projector are what a pull downloads
          const bytes = manifest.layers
            .filter((l) => /\.(model|projector)$/.test(l.mediaType) && !have.has(hex(l.digest)))
            .reduce((sum, l) => sum + l.size, 0);
          return { id: `model:${model.name}`, name: model.name, current: hex(model.digest), available: manifest.digest, component: pullId(model.name), bytes };
        }),
      );
      return found.filter((f) => f !== null);
    },
  };
}

function hex(digest: string): string {
  return digest.replace(/^sha256:/, '').toLowerCase();
}
