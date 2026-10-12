import { describe, expect, it } from 'vitest';
import type { RequestStats } from '@shared/proxy';
import type { SessionUsage, UsageRecord } from '@shared/usage';
import { dayKey, summarize } from './usage-summary';

const NOW = new Date(2026, 9, 12, 15, 0).getTime();
const at = (daysAgo: number, hour: number) => new Date(2026, 9, 12 - daysAgo, hour, 30).getTime();
const base = { harness: 'claude-code', folderId: 'f' };

function prompt(when: number, model: string): UsageRecord {
  return { ...base, at: when, type: 'prompt', model };
}

function request(when: number, model: string, stats: Partial<RequestStats> = {}): UsageRecord {
  return {
    ...base,
    at: when,
    type: 'request',
    stats: { kind: 'main', model, status: 200, inputTokens: 1000, outputTokens: 100, firstTokenMs: 400, generationMs: 2000, historyHasThinking: false, error: null, ...stats },
  };
}

const usage: SessionUsage[] = [
  {
    sessionId: 'old',
    records: [prompt(at(40, 9), 'big'), request(at(40, 9), 'big', { outputTokens: 50, generationMs: 5000, firstTokenMs: 3000 })],
  },
  {
    sessionId: 'recent',
    records: [
      prompt(at(3, 18), 'small'),
      request(at(3, 18), 'small'),
      request(at(3, 18), 'small', { kind: 'background', inputTokens: 200, outputTokens: 10, generationMs: 100, firstTokenMs: 9000 }),
      prompt(at(0, 18), 'small'),
      request(at(0, 18), 'small', { status: 500, inputTokens: null, outputTokens: null, error: 'boom' }),
    ],
  },
];

describe('the stats summary', () => {
  it('counts everything in All', () => {
    const all = summarize(usage, NOW).ranges.all;
    expect(all).toMatchObject({ sessions: 2, messages: 5, tokens: 1050 + 1100 + 210, activeDays: 3, peakHour: 18, favoriteModel: 'small' });
  });

  it('counts prompts and the replies to them as messages, but no background or failed request', () => {
    const { models } = summarize(usage, NOW).ranges.all;
    expect(models.map((m) => [m.model, m.messages])).toEqual([
      ['small', 3],
      ['big', 2],
    ]);
  });

  it('leaves out what happened before a range starts', () => {
    const { ranges } = summarize(usage, NOW);
    expect(ranges['30d']).toMatchObject({ sessions: 1, messages: 3, tokens: 1310, activeDays: 2 });
    expect(ranges['7d'].sessions).toBe(1);
  });

  it('starts a range at local midnight', () => {
    const edge: SessionUsage[] = [{ sessionId: 's', records: [prompt(new Date(2026, 9, 6, 0, 0).getTime(), 'm'), prompt(new Date(2026, 9, 5, 23, 59).getTime(), 'm')] }];
    expect(summarize(edge, NOW).ranges['7d'].messages).toBe(1);
  });

  it('measures speed over every good reply, and the first token over main requests only', () => {
    const small = summarize(usage, NOW).ranges.all.models.find((m) => m.model === 'small')!;
    expect(small.tokensPerSecond).toBeCloseTo((110 * 1000) / 2100);
    expect(small.firstTokenMs).toBe(400);
  });

  it('lists the models with the most tokens first', () => {
    expect(summarize(usage, NOW).ranges.all.models.map((m) => m.model)).toEqual(['small', 'big']);
  });

  it('keeps messages per local day', () => {
    expect(summarize(usage, NOW).activity).toEqual({ [dayKey(at(40, 9))]: 2, [dayKey(at(3, 18))]: 2, [dayKey(at(0, 18))]: 1 });
  });

  it('has nothing to name when nothing was sent', () => {
    expect(summarize([], NOW).ranges.all).toEqual({ sessions: 0, messages: 0, tokens: 0, activeDays: 0, peakHour: null, favoriteModel: null, models: [] });
  });
});
