// Claude Code for the harness tests, installed the way the app installs it and kept between runs in node_modules/.cache.
// the first run downloads it, through the system's npm or one wrontend downloads

import { join } from 'node:path';
import { CATALOG } from './catalog';
import { ComponentEngine } from './engine';
import { NpmDriver } from './npm-driver';
import { ComponentStore } from './store';

export async function installedProgram(id: string): Promise<string> {
  const npm = new NpmDriver(new ComponentStore(join(__dirname, '..', '..', '..', 'node_modules', '.cache', 'wrontend', 'components')), CATALOG);
  if (!npm.program(id)) await new ComponentEngine([npm]).install(id);
  return npm.program(id)!;
}
