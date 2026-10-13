import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import type { TranscriptItem } from '@shared/session';
import { addEdits, addUser, applyUpdate, firstChange } from './transcript';

const text = (t: string) => ({ type: 'text' as const, text: t });

function run(updates: SessionUpdate[]): TranscriptItem[] {
  return updates.reduce<TranscriptItem[]>((items, u, n) => applyUpdate(items, u, 1000 + n), addUser([], 'hi'));
}

describe('applyUpdate', () => {
  it('merges chunks, closes a thought when text follows, and keeps each tool call by its id', () => {
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
    expect(items[4]).toMatchObject({ id: 'b', status: 'pending' });
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

  it('keeps the locations a tool call reports', () => {
    const items = run([
      { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'Edit a.ts', kind: 'edit', status: 'pending', locations: [{ path: 'a.ts' }] },
      { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'completed', locations: [{ path: 'a.ts', line: 12 }] },
    ]);
    expect(items[1]).toMatchObject({ locations: [{ path: 'a.ts', line: 12 }] });
  });

  it('returns the same transcript for an update it does not show', () => {
    const items = run([]);
    expect(applyUpdate(items, { sessionUpdate: 'usage_update', used: 1, size: 2 })).toBe(items);
  });

  it('gives items ids no other transcript has', () => {
    const [a, b] = [run([]), run([])];
    expect(a[0].id).not.toBe(b[0].id);
  });
});

describe('addEdits', () => {
  const file = { path: 'a.ts', hunks: [{ oldStart: 1, newStart: 1, lines: ['-a', '+b'] }], whole: true };

  it('ends the turn in its changed files, and adds nothing for a turn that changed none', () => {
    const items = run([{ sessionUpdate: 'agent_message_chunk', content: text('Done.') }]);
    expect(addEdits(items, [])).toBe(items);
    expect(addEdits(items, [file]).map((i) => i.kind)).toEqual(['user', 'assistant', 'edits']);
  });
});

describe('firstChange', () => {
  it('finds the first item a change replaced, and the end for one that only added', () => {
    const items = run([
      { sessionUpdate: 'agent_message_chunk', content: text('a') },
      { sessionUpdate: 'tool_call', toolCallId: 't', title: 'Run it', kind: 'execute', status: 'pending' },
      { sessionUpdate: 'agent_message_chunk', content: text('b') },
    ]);
    const updated = applyUpdate(items, { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' });
    expect(firstChange(items, updated)).toBe(2);
    const streamed = applyUpdate(items, { sessionUpdate: 'agent_message_chunk', content: text('c') });
    expect(firstChange(items, streamed)).toBe(3);
    const added = addUser(items, 'next');
    expect(firstChange(items, added)).toBe(4);
  });
});
