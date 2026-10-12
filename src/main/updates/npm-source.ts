// harnesses published on npm: an installed one is out of date when npm's latest tag points past its active version.
// one not installed has nothing to update -- its first pick installs the latest anyway

import type { CatalogEntry, NpmDriver } from '../components/npm-driver';
import type { ComponentStore } from '../components/store';
import { compareVersions } from '../components/version';
import type { Found, UpdateSource } from './updater';

export function npmUpdates(npm: Pick<NpmDriver, 'latest'>, store: ComponentStore, catalog: CatalogEntry[]): UpdateSource {
  return {
    group: 'harnesses',
    async check() {
      const found: Found[] = [];
      for (const entry of catalog) {
        const current = store.active(entry.id)?.version;
        if (!current) continue;
        const available = await npm.latest(entry.id);
        if (compareVersions(available, current) > 0) found.push({ id: entry.id, name: entry.name, current, available, component: entry.id });
      }
      return found;
    },
  };
}
