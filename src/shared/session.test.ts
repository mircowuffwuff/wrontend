import { describe, expect, it } from 'vitest';
import { applySessionChange, contextUse, type SessionChange, type SessionState } from './session';

const session = (id: string, over: Partial<SessionState> = {}): SessionState => ({
  info: { id, harness: 'fake', folderId: 'f', folder: 'C:/work', model: 'm', effort: 'on', title: id, createdAt: 0 },
  items: [],
  turnStartedAt: null,
  permissions: [],
  modes: null,
  commands: [],
  usage: null,
  lastMain: null,
  ...over,
});

const user = (id: string, text: string) => ({ kind: 'user' as const, id, text });

describe('applySessionChange', () => {
  it('puts an added session first, replaces the transcript from a change’s index on, and drops a removed one', () => {
    let list = [session('a')];
    list = applySessionChange(list, { type: 'added', session: session('b') });
    expect(list.map((s) => s.info.id)).toEqual(['b', 'a']);
    list = applySessionChange(list, { type: 'updated', id: 'a', fields: { turnStartedAt: 5 }, items: { from: 0, items: [user('1', 'x'), user('2', 'y')] } });
    list = applySessionChange(list, { type: 'updated', id: 'a', fields: {}, items: { from: 1, items: [user('2', 'yz')] } });
    expect(list[1]).toMatchObject({ turnStartedAt: 5, items: [{ text: 'x' }, { text: 'yz' }] });
    list = applySessionChange(list, { type: 'removed', id: 'b' });
    expect(list.map((s) => s.info.id)).toEqual(['a']);
  });

  // a mirror listens before it reads the list, so the changes it heard in between are applied to a list that has them
  it('ends where main is when changes already in the list are applied again', () => {
    const changes: SessionChange[] = [
      { type: 'added', session: session('a') },
      { type: 'updated', id: 'a', fields: {}, items: { from: 0, items: [user('1', 'x')] } },
      { type: 'updated', id: 'a', fields: {}, items: { from: 1, items: [user('2', 'y')] } },
      { type: 'updated', id: 'a', fields: { turnStartedAt: null }, items: { from: 0, items: [user('1', 'x!'), user('2', 'y')] } },
    ];
    const main = changes.reduce(applySessionChange, [] as SessionState[]);
    const listedMidway = changes.slice(0, 3).reduce(applySessionChange, [] as SessionState[]);
    expect(changes.reduce(applySessionChange, listedMidway)).toEqual(main);
  });
});

describe('contextUse', () => {
  const loaded = [{ name: 'm', sizeBytes: 1, vramBytes: 1, contextLength: 8192 }];
  const lastMain = {
    kind: 'main' as const,
    model: 'm',
    status: 200,
    inputTokens: 1000,
    outputTokens: 24,
    firstTokenMs: 1,
    generationMs: 1,
    historyHasThinking: false,
    error: null,
  };

  it('takes what the harness reports first', () => {
    expect(contextUse(session('a', { usage: { used: 300, size: 4096 }, lastMain }), loaded)).toEqual({ used: 300, size: 4096 });
  });

  it('falls back on the last request against the window Ollama loaded the model with', () => {
    expect(contextUse(session('a', { lastMain }), loaded)).toEqual({ used: 1024, size: 8192 });
    expect(contextUse(session('a'), [])).toEqual({ used: null, size: null });
  });
});
