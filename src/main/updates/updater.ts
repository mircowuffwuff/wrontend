// the updater: asks each source what is out of date -- on launch, every few hours and when asked -- and sets an update up
// through the component engine, as a first install would. nothing updates by itself.
// the sources are independent: one that cannot be reached leaves the others' rows standing, and says why in the panel.
// the user's choices -- a skipped version, a pinned component -- are kept in a file of their own: they are not settings

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ComponentState } from '@shared/components';
import { UPDATE_GROUPS, type UpdateEntry, type UpdateGroup, type UpdatesState } from '@shared/updates';

export interface Found {
  id: string;
  name: string;
  current: string | null;
  available: string;
  bytes?: number;
  // the engine component an update sets up again
  component: string;
}

export interface UpdateSource {
  group: UpdateGroup;
  check(): Promise<Found[]>;
}

interface Choices {
  // by id: the version the user skipped, offered again once a newer one appears
  skipped: Record<string, string>;
  pinned: string[];
}

export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

export class Updater {
  private readonly found = new Map<UpdateGroup, Found[]>();
  private readonly failures = new Map<UpdateGroup, string>();
  // by component: an update under way, or one that failed
  private readonly progress = new Map<string, ComponentState>();
  private choices: Choices;
  private running: Promise<void> | null = null;
  private checkedAt: number | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sources: UpdateSource[],
    private readonly file: string,
    private readonly install: (component: string) => Promise<void>,
    private readonly onChange: (state: UpdatesState) => void = () => {},
  ) {
    this.choices = read(file);
  }

  start(intervalMs = CHECK_INTERVAL_MS): void {
    void this.check();
    this.timer = setInterval(() => void this.check(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  state(): UpdatesState {
    const entries: UpdateEntry[] = [];
    for (const group of UPDATE_GROUPS) {
      for (const f of this.found.get(group) ?? []) {
        if (this.choices.skipped[f.id] === f.available) continue;
        entries.push({
          id: f.id,
          group,
          name: f.name,
          current: f.current,
          available: f.available,
          ...(f.bytes !== undefined ? { bytes: f.bytes } : {}),
          pinned: this.choices.pinned.includes(f.id),
          state: this.progress.get(f.component) ?? null,
        });
      }
    }
    const failures = [...this.failures].map(([group, error]) => ({ group, error }));
    return { entries, checking: this.running !== null, checkedAt: this.checkedAt, failures };
  }

  // a check asked for while one runs is that one
  check(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.checkAll().finally(() => {
      this.running = null;
      this.checkedAt = Date.now();
      this.changed();
    });
    this.changed();
    return this.running;
  }

  // the row goes once the update is set up; a failure stays on it, from the engine's report
  async update(id: string): Promise<void> {
    const [group, found] = this.lookup(id);
    await this.install(found.component);
    this.found.set(group, (this.found.get(group) ?? []).filter((f) => f.id !== id));
    this.changed();
  }

  skip(id: string): void {
    const [, found] = this.lookup(id);
    this.choices.skipped[id] = found.available;
    this.save();
  }

  pin(id: string, pinned: boolean): void {
    this.choices.pinned = this.choices.pinned.filter((p) => p !== id);
    if (pinned) this.choices.pinned.push(id);
    this.save();
  }

  // the engine's report on any component; only the ones the updater lists show on a row
  componentChanged(component: string, state: ComponentState): void {
    if (state.status === 'installing' || state.status === 'failed') this.progress.set(component, state);
    else if (!this.progress.delete(component)) return;
    if ([...this.found.values()].some((list) => list.some((f) => f.component === component))) this.changed();
  }

  private async checkAll(): Promise<void> {
    await Promise.all(
      this.sources.map(async (source) => {
        try {
          this.found.set(source.group, await source.check());
          this.failures.delete(source.group);
        } catch (cause) {
          // what an earlier check found still stands
          this.failures.set(source.group, (cause as Error).message ?? String(cause));
        }
      }),
    );
  }

  private lookup(id: string): [UpdateGroup, Found] {
    for (const [group, list] of this.found) {
      const found = list.find((f) => f.id === id);
      if (found) return [group, found];
    }
    throw new Error(`nothing called ${id} is out of date`);
  }

  private save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.choices, null, 2));
    renameSync(`${this.file}.tmp`, this.file);
    this.changed();
  }

  private changed(): void {
    this.onChange(this.state());
  }
}

function read(file: string): Choices {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Choices>;
    const skipped = Object.fromEntries(Object.entries(parsed.skipped ?? {}).filter(([, v]) => typeof v === 'string'));
    const pinned = Array.isArray(parsed.pinned) ? parsed.pinned.filter((p): p is string => typeof p === 'string') : [];
    return { skipped, pinned };
  } catch {
    return { skipped: {}, pinned: [] };
  }
}
