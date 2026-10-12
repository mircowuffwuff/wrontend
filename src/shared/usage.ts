// a session's usage log: one line per prompt the user sent and per request the proxy measured. the log outlives its
// session, so each line carries everything the stats read from it, never pointing into the session's own record

import type { RequestStats } from './proxy';

interface UsageBase {
  at: number;
  harness: string;
  folderId: string;
}

export type UsageRecord = (UsageBase & { type: 'prompt'; model: string }) | (UsageBase & { type: 'request'; stats: RequestStats });

export interface SessionUsage {
  sessionId: string;
  records: UsageRecord[];
}

// what the new-session stats card shows, summed up in main from every session's usage log
export const STATS_RANGES = ['all', '30d', '7d'] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

export interface ModelUsage {
  model: string;
  messages: number;
  tokens: number;
  // generation speed over every measured reply: output tokens over the time from the first token to the last
  tokensPerSecond: number | null;
  // the average wait from a request reaching the proxy to its first token
  firstTokenMs: number | null;
}

export interface RangeUsage {
  sessions: number;
  messages: number;
  // input and output of every request, background requests included
  tokens: number;
  activeDays: number;
  // the local hour, 0 to 23, in which the most messages were sent
  peakHour: number | null;
  favoriteModel: string | null;
  // the most tokens first
  models: ModelUsage[];
}

export interface UsageSummary {
  ranges: Record<StatsRange, RangeUsage>;
  // messages per local day, keyed YYYY-MM-DD; days with none are left out
  activity: Record<string, number>;
}
