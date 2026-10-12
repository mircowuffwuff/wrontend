// the files one turn changed: its tool calls are kept as they stream in, and at the turn's end each changed file is read
// back once to give one diff from before the turn to after it

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import type { SessionUpdate, ToolCallContent, ToolCallLocation, ToolCallStatus } from '@agentclientprotocol/sdk';
import { editedFile, placeDiffs, type PlacedDiff } from '@shared/diffs';
import type { EditedFile } from '@shared/session';

// a larger file is not read back; its card shows each edit's own diff
const MAX_READ = 2 * 1024 * 1024;

interface Call {
  status: ToolCallStatus;
  content: ToolCallContent[];
  locations: ToolCallLocation[];
}

export class TurnEdits {
  private readonly calls = new Map<string, Call>();

  note(update: SessionUpdate): void {
    if (update.sessionUpdate === 'tool_call') {
      this.calls.set(update.toolCallId, { status: update.status ?? 'pending', content: update.content ?? [], locations: update.locations ?? [] });
    } else if (update.sessionUpdate === 'tool_call_update') {
      const call = this.calls.get(update.toolCallId) ?? { status: 'pending', content: [], locations: [] };
      this.calls.set(update.toolCallId, {
        status: update.status ?? call.status,
        content: update.content ?? call.content,
        locations: update.locations ?? call.locations,
      });
    }
  }

  // every changed path with its diffs, in the order they were made; a call that did not complete changed nothing
  private byPath(): Map<string, PlacedDiff[]> {
    const paths = new Map<string, PlacedDiff[]>();
    for (const call of this.calls.values()) {
      if (call.status !== 'completed') continue;
      for (const diff of placeDiffs(call.content, call.locations)) {
        const list = paths.get(diff.path);
        if (list) list.push(diff);
        else paths.set(diff.path, [diff]);
      }
    }
    return paths;
  }

  // a path the harness gave relative is read from the session's folder
  async files(folder: string): Promise<EditedFile[]> {
    const files: EditedFile[] = [];
    for (const [path, diffs] of this.byPath()) {
      const file = editedFile(path, await readBack(isAbsolute(path) ? path : resolve(folder, path)), diffs);
      if (file) files.push(file);
    }
    return files;
  }
}

async function readBack(path: string): Promise<string | null> {
  try {
    if ((await stat(path)).size > MAX_READ) return null;
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}
