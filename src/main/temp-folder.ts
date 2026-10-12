// a folder in the system's temp folder that lasts as long as the test that made it. on Windows, an npm or harness process
// the test stopped keeps the folder until it has exited, which a harness's whole process tree can take seconds to do: the
// removal retries for a while, and a folder that still will not go is left behind rather than failing a test over its cleanup

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';

export function tempFolder(prefix: string): string {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rm(folder, { recursive: true, force: true, maxRetries: 10 }).catch(() => {}));
  return folder;
}
