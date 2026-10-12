// turns the stream of ACP session updates into the items the transcript shows

import type { PlanEntry, SessionUpdate, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolKind } from '@agentclientprotocol/sdk';
import type { EditedFile } from '@shared/session';

export interface ToolItem {
  kind: 'tool';
  id: string;
  title: string;
  toolKind: ToolKind | null;
  status: ToolCallStatus;
  content: ToolCallContent[];
  // where the call worked; a harness may give each diff the line it starts on here
  locations?: ToolCallLocation[];
  rawInput: unknown;
}

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string; startedAt: number; endedAt: number | null }
  | ToolItem
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  // the files a finished turn changed, each as one diff from before the turn to after it
  | { kind: 'edits'; id: string; files: EditedFile[] }
  | { kind: 'error'; id: string; message: string; detail: string }
  | { kind: 'notice'; id: string; text: string };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function textOf(content: { type: string; text?: string }): string {
  return content.type === 'text' ? (content.text ?? '') : '';
}

// a thought ends when anything else arrives after it
function closeThought(items: TranscriptItem[], now: number): TranscriptItem[] {
  const last = items[items.length - 1];
  if (last?.kind === 'thought' && last.endedAt === null) {
    return [...items.slice(0, -1), { ...last, endedAt: now }];
  }
  return items;
}

export function applyUpdate(items: TranscriptItem[], update: SessionUpdate, now = Date.now()): TranscriptItem[] {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(update.content);
      const closed = closeThought(items, now);
      const last = closed[closed.length - 1];
      if (last?.kind === 'assistant') return [...closed.slice(0, -1), { ...last, text: last.text + text }];
      return [...closed, { kind: 'assistant', id: nextId('a'), text }];
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content);
      const last = items[items.length - 1];
      if (last?.kind === 'thought' && last.endedAt === null) return [...items.slice(0, -1), { ...last, text: last.text + text }];
      return [...items, { kind: 'thought', id: nextId('t'), text, startedAt: now, endedAt: null }];
    }
    case 'user_message_chunk': {
      const text = textOf(update.content);
      const last = items[items.length - 1];
      if (last?.kind === 'user') return [...items.slice(0, -1), { ...last, text: last.text + text }];
      return [...items, { kind: 'user', id: nextId('u'), text }];
    }
    case 'tool_call': {
      const closed = closeThought(items, now);
      const tool: ToolItem = {
        kind: 'tool',
        id: update.toolCallId,
        title: update.title,
        toolKind: update.kind ?? null,
        status: update.status ?? 'pending',
        content: update.content ?? [],
        locations: update.locations ?? [],
        rawInput: update.rawInput,
      };
      const at = closed.findIndex((i) => i.kind === 'tool' && i.id === update.toolCallId);
      if (at === -1) return [...closed, tool];
      return closed.map((i, n) => (n === at ? tool : i));
    }
    case 'tool_call_update': {
      return items.map((i) => {
        if (i.kind !== 'tool' || i.id !== update.toolCallId) return i;
        return {
          ...i,
          title: update.title ?? i.title,
          toolKind: update.kind ?? i.toolKind,
          status: update.status ?? i.status,
          content: update.content ?? i.content,
          locations: update.locations ?? i.locations,
          rawInput: update.rawInput ?? i.rawInput,
        };
      });
    }
    case 'plan': {
      const at = items.findIndex((i) => i.kind === 'plan');
      const plan: TranscriptItem = { kind: 'plan', id: at === -1 ? nextId('p') : items[at].id, entries: update.entries };
      if (at === -1) return [...closeThought(items, now), plan];
      return items.map((i, n) => (n === at ? plan : i));
    }
    default:
      return items;
  }
}

export function addUser(items: TranscriptItem[], text: string): TranscriptItem[] {
  return [...items, { kind: 'user', id: nextId('u'), text }];
}

export function addError(items: TranscriptItem[], message: string, detail = ''): TranscriptItem[] {
  return [...closeThought(items, Date.now()), { kind: 'error', id: nextId('e'), message, detail }];
}

export function endTurn(items: TranscriptItem[], now = Date.now()): TranscriptItem[] {
  return closeThought(items, now);
}

// the card of the files a turn changed, at its end; a turn that changed none has no card
export function addEdits(items: TranscriptItem[], files: EditedFile[]): TranscriptItem[] {
  if (!files.length) return items;
  return [...closeThought(items, Date.now()), { kind: 'edits', id: nextId('f'), files }];
}

// a quiet line in the transcript, such as a turn the user stopped
export function addNotice(items: TranscriptItem[], text: string): TranscriptItem[] {
  return [...closeThought(items, Date.now()), { kind: 'notice', id: nextId('n'), text }];
}

// consecutive tool calls between two pieces of text are shown as one group
export type Block = { kind: 'item'; item: Exclude<TranscriptItem, ToolItem> } | { kind: 'tools'; id: string; tools: ToolItem[] };

export function group(items: TranscriptItem[]): Block[] {
  const blocks: Block[] = [];
  for (const item of items) {
    if (item.kind === 'tool') {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'tools') last.tools.push(item);
      else blocks.push({ kind: 'tools', id: `g-${item.id}`, tools: [item] });
    } else {
      blocks.push({ kind: 'item', item });
    }
  }
  return blocks;
}
