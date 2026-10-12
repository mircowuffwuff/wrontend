// copies of Ollama models with a renderer, as components. a thinking model without a renderer loses its earlier reasoning inside
// Ollama; the same weights with Ollama's built-in renderer and parser keep it, cost no download and run at the same speed. so when
// wrontend knows the renderer for a picked model's family, it makes that copy once and the proxy routes the pick to it. the user
// keeps seeing and picking the original's name.
// a copy's version is the original's digest with the renderer and parser: the original pulled again, or a corrected table row,
// makes the copy out of date, and the next pick makes it again under the same name

import { createHash } from 'node:crypto';
import type { ComponentState } from '@shared/components';
import type { ModelDetails, ModelReasoning, ModelSummary } from '@shared/ollama';
import type { CreateRequest } from '../ollama/client';
import type { ComponentEngine, Driver } from './engine';
import { InstallError } from './npm';
import { rendererFor, type RendererTable } from './renderers';
import type { ComponentStore } from './store';
import { compareVersions } from './version';

export const DERIVED_MARK = '-wrontend-derived';
const ID_PREFIX = 'derived:';
// Ollama's limit on a name's tag
const TAG_LIMIT = 80;

const LOST = 'Ollama drops this model’s earlier reasoning';

export interface DerivedOllama {
  version(): Promise<string>;
  models(): Promise<ModelSummary[]>;
  show(name: string): Promise<ModelDetails>;
  create(request: CreateRequest): Promise<void>;
}

export interface DerivedOptions {
  // the setting that turns the copies off
  enabled: () => boolean;
  // the smoke test reads the user's models but never writes into their Ollama
  readOnly?: boolean;
  // how long a read of Ollama's model list stands before the next request reads it again
  listMs?: number;
}

type Plan =
  | { kind: 'kept' }
  | { kind: 'lost'; reason: string }
  | { kind: 'derive'; name: string; renderer: string; parser: string; version: string };

// what a model needs, whatever the setting says and before its copy has a name and version
type Analysis = Exclude<Plan, { kind: 'derive' }> | { kind: 'derive'; renderer: string; parser: string };

interface Listing {
  models: ModelSummary[];
  version: string;
}

export function derivedId(original: string): string {
  return ID_PREFIX + original;
}

// the copy keeps its original's host, namespace and model, so a list groups it with the original's other tags; only the tag
// carries wrontend's mark. a tag too long for the mark is cut, and keeps a hash of the whole so two copies never share a name
export function derivedName(original: string): string {
  const { base, tag } = splitName(original);
  if (tag.length + DERIVED_MARK.length <= TAG_LIMIT) return `${base}:${tag}${DERIVED_MARK}`;
  const hash = createHash('sha256').update(tag).digest('hex').slice(0, 8);
  return `${base}:${tag.slice(0, TAG_LIMIT - DERIVED_MARK.length - hash.length - 1)}-${hash}${DERIVED_MARK}`;
}

export function isDerived(name: string): boolean {
  return splitName(name).tag.endsWith(DERIVED_MARK);
}

// the tag follows the last colon after the last slash; a host may carry a port, hf.co:443/..., before it
function splitName(name: string): { base: string; tag: string } {
  const colon = name.indexOf(':', name.lastIndexOf('/') + 1);
  return colon < 0 ? { base: name, tag: 'latest' } : { base: name.slice(0, colon), tag: name.slice(colon + 1) };
}

export class DerivedModels implements Driver {
  readonly kind = 'ollama-create';
  private listing: { at: number; value: Promise<Listing> } | null = null;
  // the names in Ollama's model list as last read, for a state asked for synchronously
  private present = new Set<string>();
  private readonly analyses = new Map<string, Promise<Analysis>>();

  constructor(
    private readonly ollama: DerivedOllama,
    private readonly store: ComponentStore,
    private readonly table: RendererTable,
    private readonly options: DerivedOptions,
  ) {}

  owns(id: string): boolean {
    return id.startsWith(ID_PREFIX);
  }

  state(id: string): ComponentState {
    const version = this.store.recorded(id);
    return version && this.present.has(derivedName(id.slice(ID_PREFIX.length))) ? { status: 'installed', version } : { status: 'missing' };
  }

  // whether the copy in Ollama is the one the plan wants
  current(original: string, version: string): boolean {
    const state = this.state(derivedId(original));
    return state.status === 'installed' && state.version === version;
  }

  // the model a copy was made from, for a name that is one of wrontend's copies
  originalOf(name: string): string | null {
    if (!isDerived(name)) return null;
    const id = this.store.ids().find((i) => this.owns(i) && derivedName(i.slice(ID_PREFIX.length)) === name);
    return id ? id.slice(ID_PREFIX.length) : null;
  }

  // Ollama's models without wrontend's copies, which are listed under their originals' names
  async models(): Promise<ModelSummary[]> {
    return (await this.list()).models.filter((m) => !isDerived(m.name));
  }

  async plan(original: string): Promise<Plan> {
    const { models, version } = await this.list();
    const model = models.find((m) => m.name === original);
    // a name Ollama does not have is passed on as it is, and Ollama says so
    if (!model || isDerived(original)) return { kind: 'kept' };
    const key = `${original}@${model.digest}@${version}`;
    let analysis = this.analyses.get(key);
    if (!analysis) {
      analysis = this.analyse(original, version);
      this.analyses.set(key, analysis);
      analysis.catch(() => this.analyses.delete(key));
    }
    const found = await analysis;
    if (found.kind !== 'derive') return found;
    if (!this.options.enabled()) return { kind: 'lost', reason: `${LOST}. Copies with a renderer are turned off in Settings.` };
    const { renderer, parser } = found;
    return { kind: 'derive', name: derivedName(original), renderer, parser, version: `${model.digest.slice(0, 12)}+${renderer}+${parser}` };
  }

  async install(id: string, report: (step: string, bytes: number) => void): Promise<void> {
    const original = id.slice(ID_PREFIX.length);
    const plan = await this.plan(original);
    if (plan.kind !== 'derive') throw new InstallError(`wrontend makes no copy of ${original}.`, plan.kind === 'lost' ? plan.reason : 'it keeps its reasoning as it is');
    if (this.options.readOnly) throw new InstallError(`A copy of ${original} with a renderer was not made.`, 'this run writes nothing into Ollama');
    report(`Deriving a copy with the ${plan.renderer} renderer`, 0);
    try {
      await this.ollama.create({ model: plan.name, from: original, renderer: plan.renderer, parser: plan.parser });
    } catch (cause) {
      throw new InstallError(`Ollama could not make a copy of ${original} with a renderer.`, (cause as Error).message);
    } finally {
      this.listing = null;
    }
    const made = await this.ollama.show(plan.name);
    if (!made.hasRenderer) throw new InstallError(`Ollama made a copy of ${original}, but without its renderer.`, `${plan.name} has no RENDERER line`);
    this.store.activate(id, plan.version);
    await this.list();
  }

  // what the model picker says about a model
  async reasoning(engine: ComponentEngine, original: string): Promise<ModelReasoning> {
    const plan = await this.plan(original);
    if (plan.kind === 'kept') return { status: 'kept' };
    if (plan.kind === 'lost') return { status: 'lost', reason: plan.reason };
    return { status: 'derived', state: engine.state(derivedId(original)) };
  }

  private list(): Promise<Listing> {
    const now = Date.now();
    if (this.listing && now - this.listing.at < (this.options.listMs ?? 2000)) return this.listing.value;
    const value = Promise.all([this.ollama.models(), this.ollama.version()]).then(([models, version]) => {
      this.present = new Set(models.map((m) => m.name));
      return { models, version };
    });
    this.listing = { at: now, value };
    value.catch(() => {
      if (this.listing?.value === value) this.listing = null;
    });
    return value;
  }

  private async analyse(original: string, ollamaVersion: string): Promise<Analysis> {
    const details = await this.ollama.show(original);
    if (!details.capabilities.includes('thinking') || details.hasRenderer) return { kind: 'kept' };
    const family = rendererFor(this.table, details);
    if (!family) return { kind: 'lost', reason: `${LOST}, and wrontend knows no renderer for it.` };
    if (compareVersions(ollamaVersion, family.requires) < 0) {
      return { kind: 'lost', reason: `${LOST}. Its renderer needs Ollama ${family.requires} or newer.` };
    }
    return { kind: 'derive', renderer: family.renderer, parser: family.parser };
  }
}

// the model a request for the user's pick goes to: its copy with a renderer where wrontend makes one, else the pick itself. a
// copy still being made is waited for, since it takes seconds and the turn would lose its reasoning without it. a copy that
// failed is tried again only on retry -- a pick in the picker -- and not by every request
export async function routeModel(engine: ComponentEngine, derived: DerivedModels, original: string, retry = false): Promise<string> {
  const plan = await derived.plan(original);
  if (plan.kind !== 'derive') return original;
  if (derived.current(original, plan.version)) return plan.name;
  const id = derivedId(original);
  if (!retry && engine.state(id).status === 'failed') return original;
  try {
    await engine.install(id);
    return plan.name;
  } catch {
    return original;
  }
}
