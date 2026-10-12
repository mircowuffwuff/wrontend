// the stats card on the new-session screen: what has been done with wrontend, over all time or the last 30 or 7 days.
// the numbers come from every session's usage log, deleted sessions' included; the speed per model is wrontend's own
// measurement, which a hosted harness cannot show

import { useEffect, useState } from 'react';
import type { RangeUsage, StatsRange, UsageSummary } from '@shared/usage';
import { bridge } from '../bridge';

const RANGE_LABELS: Record<StatsRange, string> = { all: 'All', '30d': '30d', '7d': '7d' };
const RANGE_DAYS: Record<StatsRange, number | null> = { all: null, '30d': 30, '7d': 7 };
const WEEKS = 26;

const count = (n: number) => n.toLocaleString('en');
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const hour = (h: number) => new Intl.DateTimeFormat('en', { hour: 'numeric' }).format(new Date(2000, 0, 1, h));

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// the last 26 weeks, a column per week from Monday to Sunday, the current week last
function Heatmap({ activity, range }: { activity: Record<string, number>; range: StatsRange }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (WEEKS - 1) * 7);
  const days = RANGE_DAYS[range];
  const from = days === null ? null : new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const cells: { key: string; date: Date; n: number }[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    const key = dayKey(date);
    cells.push({ key, date, n: activity[key] ?? 0 });
  }
  const most = Math.max(1, ...cells.map((c) => c.n));
  return (
    <div className="heatmap">
      {cells.map(({ key, date, n }) => {
        if (date > today) return <i key={key} className="heat-cell future" />;
        const level = n === 0 ? 0 : Math.min(4, Math.ceil((n / most) * 4));
        const outside = from !== null && date < from;
        const label = `${date.toLocaleDateString('en', { month: 'short', day: 'numeric' })}: ${n === 0 ? 'no' : n} message${n === 1 ? '' : 's'}`;
        return <i key={key} className={`heat-cell level-${level}${outside ? ' outside' : ''}`} title={label} />;
      })}
    </div>
  );
}

function Overview({ usage, activity, range }: { usage: RangeUsage; activity: Record<string, number>; range: StatsRange }) {
  const tiles = [
    ['Sessions', count(usage.sessions)],
    ['Messages', count(usage.messages)],
    ['Total tokens', compact(usage.tokens)],
    ['Active days', count(usage.activeDays)],
    ['Peak hour', usage.peakHour === null ? '—' : hour(usage.peakHour)],
    ['Favorite model', usage.favoriteModel ?? '—'],
  ];
  return (
    <>
      <div className="stat-tiles">
        {tiles.map(([label, value]) => (
          <div key={label} className="stat-tile">
            <span className="stat-label">{label}</span>
            <span className={`stat-value${label === 'Favorite model' ? ' model' : ''}`} title={value}>
              {value}
            </span>
          </div>
        ))}
      </div>
      <Heatmap activity={activity} range={range} />
    </>
  );
}

function Models({ usage }: { usage: RangeUsage }) {
  if (usage.models.length === 0) return <p className="stats-line">No model has answered in this range yet.</p>;
  const most = Math.max(...usage.models.map((m) => m.tokens), 1);
  return (
    <div className="model-stats">
      <span className="stat-label">Model</span>
      <span className="stat-label number">Messages</span>
      <span className="stat-label number">Tokens</span>
      <span className="stat-label number" title="Generation speed, measured by wrontend's proxy">
        Speed
      </span>
      <span className="stat-label number" title="The average wait for the first token of a reply">
        First token
      </span>
      {usage.models.map((m) => (
        <div key={m.model} className="model-stats-row">
          <span className="model-name" title={m.model}>
            {m.model}
            <i className="model-share" style={{ width: `${(m.tokens / most) * 100}%` }} />
          </span>
          <span className="number">{count(m.messages)}</span>
          <span className="number">{compact(m.tokens)}</span>
          <span className="number">{m.tokensPerSecond === null ? '—' : `${m.tokensPerSecond.toFixed(1)} tok/s`}</span>
          <span className="number">{m.firstTokenMs === null ? '—' : `${(m.firstTokenMs / 1000).toFixed(1)} s`}</span>
        </div>
      ))}
    </div>
  );
}

export function StatsCard() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [tab, setTab] = useState<'overview' | 'models'>('overview');
  const [range, setRange] = useState<StatsRange>('all');
  useEffect(() => {
    void bridge.invoke('stats:summary').then(setSummary);
  }, []);
  // with nothing recorded yet there is nothing to show, and no card
  if (!summary || summary.ranges.all.sessions === 0) return null;
  const usage = summary.ranges[range];
  return (
    <section className="stats-card">
      <div className="stats-head">
        <div className="stats-tabs">
          {(['overview', 'models'] as const).map((t) => (
            <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'overview' ? 'Overview' : 'Models'}
            </button>
          ))}
        </div>
        <div className="stats-tabs">
          {(Object.keys(RANGE_LABELS) as StatsRange[]).map((r) => (
            <button key={r} className={r === range ? 'on' : ''} onClick={() => setRange(r)}>
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      {tab === 'overview' ? <Overview usage={usage} activity={summary.activity} range={range} /> : <Models usage={usage} />}
    </section>
  );
}
