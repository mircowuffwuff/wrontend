// sums every session's usage log up into what the new-session stats card shows. a message is a prompt the user sent or a
// reply the model sent -- every main request answered without an error, each step of a tool loop included. days and hours
// are local time, as the person reading the card lives them; a range of 30 days is today and the 29 days before it

import type { ModelUsage, RangeUsage, SessionUsage, StatsRange, UsageRecord, UsageSummary } from '@shared/usage';

const RANGE_DAYS: Record<StatsRange, number | null> = { all: null, '30d': 30, '7d': 7 };

export function summarize(usage: SessionUsage[], now = Date.now()): UsageSummary {
  const activity: Record<string, number> = {};
  for (const { records } of usage) {
    for (const r of records) if (messageModel(r) !== null) activity[dayKey(r.at)] = (activity[dayKey(r.at)] ?? 0) + 1;
  }
  const ranges = {} as Record<StatsRange, RangeUsage>;
  for (const [range, days] of Object.entries(RANGE_DAYS) as [StatsRange, number | null][]) {
    const from = days === null ? -Infinity : startOfDay(now, days - 1);
    ranges[range] = summarizeRange(usage, from);
  }
  return { ranges, activity };
}

interface ModelTally {
  messages: number;
  tokens: number;
  outputTokens: number;
  generationMs: number;
  firstTokenMs: number;
  firstTokens: number;
}

function summarizeRange(usage: SessionUsage[], from: number): RangeUsage {
  let sessions = 0;
  let messages = 0;
  let tokens = 0;
  const days = new Set<string>();
  const hours = new Array<number>(24).fill(0);
  const models = new Map<string, ModelTally>();
  const tally = (model: string) => {
    let t = models.get(model);
    if (!t) models.set(model, (t = { messages: 0, tokens: 0, outputTokens: 0, generationMs: 0, firstTokenMs: 0, firstTokens: 0 }));
    return t;
  };

  for (const { records } of usage) {
    const inRange = records.filter((r: UsageRecord) => r.at >= from);
    if (inRange.length > 0) sessions++;
    for (const r of inRange) {
      const model = messageModel(r);
      if (model !== null) {
        messages++;
        days.add(dayKey(r.at));
        hours[new Date(r.at).getHours()]++;
        tally(model).messages++;
      }
      if (r.type === 'prompt') continue;
      const s = r.stats;
      const t = tally(s.model);
      const used = (s.inputTokens ?? 0) + (s.outputTokens ?? 0);
      tokens += used;
      t.tokens += used;
      if (s.error || s.status !== 200) continue;
      if (s.outputTokens && s.generationMs) {
        t.outputTokens += s.outputTokens;
        t.generationMs += s.generationMs;
      }
      if (s.kind === 'main' && s.firstTokenMs !== null) {
        t.firstTokenMs += s.firstTokenMs;
        t.firstTokens++;
      }
    }
  }

  const byModel: ModelUsage[] = [...models].map(([model, t]) => ({
    model,
    messages: t.messages,
    tokens: t.tokens,
    tokensPerSecond: t.generationMs > 0 ? (t.outputTokens * 1000) / t.generationMs : null,
    firstTokenMs: t.firstTokens > 0 ? t.firstTokenMs / t.firstTokens : null,
  }));
  byModel.sort((a, b) => b.tokens - a.tokens || b.messages - a.messages);
  const favorite = [...byModel].sort((a, b) => b.messages - a.messages || b.tokens - a.tokens)[0];
  const peak = Math.max(...hours);
  return {
    sessions,
    messages,
    tokens,
    activeDays: days.size,
    peakHour: peak > 0 ? hours.indexOf(peak) : null,
    favoriteModel: favorite && favorite.messages > 0 ? favorite.model : null,
    models: byModel,
  };
}

// the model a message went to or came from, or null for a record that is no message
function messageModel(r: UsageRecord): string | null {
  if (r.type === 'prompt') return r.model;
  const s = r.stats;
  return s.kind === 'main' && s.status === 200 && !s.error ? s.model : null;
}

export function dayKey(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// local midnight, this many days before the day of now
function startOfDay(now: number, daysBack: number): number {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysBack).getTime();
}
