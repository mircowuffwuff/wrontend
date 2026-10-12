// turns the stream of ACP session updates into the items the transcript shows, and those into the blocks it draws

import type { PlanEntry, SessionUpdate, ToolCallContent, ToolCallStatus, ToolKind } from '@agentclientprotocol/sdk';

export interface ToolItem {
  kind: 'tool';
  id: string;
  title: string;
  toolKind: ToolKind | null;
  status: ToolCallStatus;
  content: ToolCallContent[];
  rawInput: unknown;
}

export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string; startedAt: number; endedAt: number | null }
  | ToolItem
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
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

// a quiet line in the transcript, such as a turn the user stopped
export function addNotice(items: TranscriptItem[], text: string): TranscriptItem[] {
  return [...closeThought(items, Date.now()), { kind: 'notice', id: nextId('n'), text }];
}

export type FileDiff = Extract<ToolCallContent, { type: 'diff' }>;

// one file a turn changed, with every diff its tool calls carried, in order. a harness sends the changed stretches
// of a file rather than the whole file -- Claude Code sends each hunk with a little context -- so two edits to one
// file stay two diffs and cannot be merged into one
export interface EditedFile {
  path: string;
  diffs: FileDiff[];
}

// consecutive tool calls between two pieces of text are shown as one group, and a finished turn that changed files
// ends in a card of those files
export type Block =
  | { kind: 'item'; item: Exclude<TranscriptItem, ToolItem> }
  | { kind: 'tools'; id: string; tools: ToolItem[] }
  | { kind: 'edits'; id: string; files: EditedFile[] };

export function group(items: TranscriptItem[], running = false): Block[] {
  const blocks: Block[] = [];
  // where the turn being read starts in blocks, and the files its completed tool calls changed
  let start = 0;
  let edits = new Map<string, EditedFile>();
  let editsId = '';

  const closeTurn = () => {
    if (edits.size === 0) return;
    // the card sums up the turn's work, so a Stopped line or an error that ended the turn stays below it
    let at = blocks.length;
    while (at > start) {
      const prev = blocks[at - 1];
      if (prev.kind !== 'item' || (prev.item.kind !== 'notice' && prev.item.kind !== 'error')) break;
      at--;
    }
    blocks.splice(at, 0, { kind: 'edits', id: editsId, files: [...edits.values()] });
  };

  for (const item of items) {
    if (item.kind === 'user') {
      closeTurn();
      edits = new Map();
      start = blocks.length;
    }
    if (item.kind === 'tool') {
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'tools') last.tools.push(item);
      else blocks.push({ kind: 'tools', id: `g-${item.id}`, tools: [item] });
      // a failed or rejected call changed nothing
      if (item.status !== 'completed') continue;
      for (const c of item.content) {
        if (c.type !== 'diff') continue;
        if (edits.size === 0) editsId = `f-${item.id}`;
        const file = edits.get(c.path);
        if (file) file.diffs.push(c);
        else edits.set(c.path, { path: c.path, diffs: [c] });
      }
    } else {
      blocks.push({ kind: 'item', item });
    }
  }
  // the turn still running has no card yet
  if (!running) closeTurn();
  return blocks;
}
