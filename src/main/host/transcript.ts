// turns the stream of ACP session updates into the session's transcript

import { randomUUID } from 'node:crypto';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { EditedFile, ToolItem, TranscriptItem } from '@shared/session';

// unique across launches: a stored transcript's items and a reopened session's new ones never share an id
const nextId = (prefix: string) => `${prefix}-${randomUUID()}`;

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

// an update the transcript does not show leaves it as it is, the same array
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

// the files a turn changed, at its end; a turn that changed none adds nothing
export function addEdits(items: TranscriptItem[], files: EditedFile[]): TranscriptItem[] {
  if (!files.length) return items;
  return [...closeThought(items, Date.now()), { kind: 'edits', id: nextId('f'), files }];
}

export function addNotice(items: TranscriptItem[], text: string): TranscriptItem[] {
  return [...closeThought(items, Date.now()), { kind: 'notice', id: nextId('n'), text }];
}

// where two versions of a transcript part: the index of the first item that is not the same object in both. the reducers
// above keep every item they do not change, so everything before it is unchanged
export function firstChange(before: TranscriptItem[], after: TranscriptItem[]): number {
  const length = Math.min(before.length, after.length);
  for (let i = 0; i < length; i++) if (before[i] !== after[i]) return i;
  return length;
}
