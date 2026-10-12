import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { addEdits, addUser, applyUpdate, group, type TranscriptItem } from './transcript';

const text = (t: string) => ({ type: 'text' as const, text: t });

function run(updates: SessionUpdate[]): TranscriptItem[] {
  return updates.reduce<TranscriptItem[]>((items, u, n) => applyUpdate(items, u, 1000 + n), addUser([], 'hi'));
}

describe('applyUpdate', () => {
  it('merges chunks, closes a thought when text follows, and groups tool calls', () => {
    const items = run([
      { sessionUpdate: 'agent_thought_chunk', content: text('let me ') },
      { sessionUpdate: 'agent_thought_chunk', content: text('think') },
      { sessionUpdate: 'agent_message_chunk', content: text('Sure, ') },
      { sessionUpdate: 'agent_message_chunk', content: text('reading it.') },
      { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Read a.ts', kind: 'read', status: 'pending' },
      { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'Edit a.ts', kind: 'edit', status: 'pending' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: text('Done.') },
    ]);
    expect(items.map((i) => i.kind)).toEqual(['user', 'thought', 'assistant', 'tool', 'tool', 'assistant']);
    expect(items[1]).toMatchObject({ text: 'let me think', startedAt: 1000, endedAt: 1002 });
    expect(items[2]).toMatchObject({ text: 'Sure, reading it.' });
    expect(items[3]).toMatchObject({ id: 'a', status: 'completed' });
    expect(group(items).map((b) => (b.kind === 'tools' ? `tools:${b.tools.length}` : b.item.kind))).toEqual([
      'user',
      'thought',
      'assistant',
      'tools:2',
      'assistant',
    ]);
  });

  it('keeps one plan and updates it in place', () => {
    const items = run([
      { sessionUpdate: 'plan', entries: [{ content: 'one', priority: 'high', status: 'pending' }] },
      { sessionUpdate: 'agent_message_chunk', content: text('working') },
      { sessionUpdate: 'plan', entries: [{ content: 'one', priority: 'high', status: 'completed' }] },
    ]);
    const plans = items.filter((i) => i.kind === 'plan');
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ entries: [{ status: 'completed' }] });
  });
});

describe('addEdits', () => {
  const file = { path: 'a.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b'] }], whole: true };

  it('ends the turn in a card of its files, and adds none for a turn that changed nothing', () => {
    const items = run([{ sessionUpdate: 'agent_message_chunk', content: text('Done.') }]);
    expect(addEdits(items, [])).toBe(items);
    const ended = addEdits(items, [file]);
    expect(ended.map((i) => i.kind)).toEqual(['user', 'assistant', 'edits']);
    expect(group(ended).map((b) => (b.kind === 'tools' ? 'tools' : b.item.kind))).toEqual(['user', 'assistant', 'edits']);
  });

  it('keeps the locations a tool call reports', () => {
    const items = run([
      { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Edit a.ts', kind: 'edit', status: 'pending', locations: [{ path: 'a.ts' }] },
      { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed', locations: [{ path: 'a.ts', line: 12 }] },
    ]);
    expect(items[1]).toMatchObject({ locations: [{ path: 'a.ts', line: 12 }] });
  });
});
