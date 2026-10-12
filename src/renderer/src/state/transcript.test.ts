import { describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { addError, addNotice, addUser, applyUpdate, group, type TranscriptItem } from './transcript';

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
    expect(group(items).map((b) => (b.kind === 'tools' ? `tools:${b.tools.length}` : b.kind === 'item' ? b.item.kind : b.kind))).toEqual([
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

describe('group', () => {
  const diff = (path: string, newText: string) => ({ type: 'diff' as const, path, oldText: 'old', newText });
  const edit = (id: string, status: 'completed' | 'failed', ...content: ReturnType<typeof diff>[]): SessionUpdate => ({
    sessionUpdate: 'tool_call',
    toolCallId: id,
    title: `Edit ${id}`,
    kind: 'edit',
    status,
    content,
  });
  const shape = (items: TranscriptItem[], running = false) => group(items, running).map((b) => (b.kind === 'item' ? b.item.kind : b.kind));

  it('ends a finished turn in a card of the files its completed calls changed, each with its diffs in order', () => {
    const items = run([
      edit('a', 'completed', diff('a.ts', 'one')),
      edit('b', 'failed', diff('b.ts', 'never')),
      edit('c', 'completed', diff('c.ts', 'two'), diff('a.ts', 'three')),
      { sessionUpdate: 'agent_message_chunk', content: text('Done.') },
    ]);
    const blocks = group(items);
    expect(shape(items)).toEqual(['user', 'tools', 'assistant', 'edits']);
    const card = blocks[3];
    expect(card).toMatchObject({ kind: 'edits', id: 'f-a' });
    if (card.kind !== 'edits') return;
    expect(card.files.map((f) => [f.path, f.diffs.map((d) => d.newText)])).toEqual([
      ['a.ts', ['one', 'three']],
      ['c.ts', ['two']],
    ]);
  });

  it('gives the running turn no card, and a turn that changed nothing none', () => {
    const items = run([edit('a', 'completed', diff('a.ts', 'one'))]);
    expect(shape(items, true)).toEqual(['user', 'tools']);
    const next = addUser(items, 'and now?');
    expect(shape(next, true)).toEqual(['user', 'tools', 'edits', 'user']);
    expect(shape(applyUpdate(next, { sessionUpdate: 'agent_message_chunk', content: text('Nothing to change.') }))).toEqual([
      'user',
      'tools',
      'edits',
      'user',
      'assistant',
    ]);
  });

  it('keeps a Stopped line or an error below the card', () => {
    const items = addError(addNotice(run([edit('a', 'completed', diff('a.ts', 'one'))]), 'Stopped'), 'The turn ended with an error.');
    expect(shape(items)).toEqual(['user', 'tools', 'edits', 'notice', 'error']);
  });
});
