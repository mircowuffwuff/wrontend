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
