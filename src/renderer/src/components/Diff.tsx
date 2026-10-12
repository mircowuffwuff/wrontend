// a unified diff, drawn from hunks with their real line numbers, and the line counts the summaries show

import type { ToolCallContent, ToolCallLocation } from '@agentclientprotocol/sdk';
import { countHunks, hunksOf, placeDiffs, type PlacedDiff } from '@shared/diffs';
import type { DiffHunk } from '@shared/session';

export interface LineCounts {
  added: number;
  removed: number;
}

export function countContent(content: ToolCallContent[]): LineCounts {
  return countHunks(placeDiffs(content).flatMap((d) => hunksOf(d.oldText, d.newText)));
}

export function Counts({ counts }: { counts: LineCounts }) {
  if (!counts.added && !counts.removed) return null;
  return (
    <span className="counts mono">
      <span className="add">+{counts.added}</span>
      <span className="remove">-{counts.removed}</span>
    </span>
  );
}

type Row = { type: 'add' | 'remove' | 'same'; text: string; no: number } | { type: 'fold'; text: string };

// the lines a hunk does not show fold into one row: those above the first hunk, and those between two
function rowsOf(hunks: DiffHunk[]): Row[] {
  const rows: Row[] = [];
  let shownTo = 0;
  for (const h of hunks) {
    const first = Math.max(h.newStart, 1);
    const hidden = first - 1 - shownTo;
    if (hidden > 0) rows.push({ type: 'fold', text: `${hidden} unmodified line${hidden === 1 ? '' : 's'}` });
    let oldNo = Math.max(h.oldStart, 1);
    let newNo = first;
    for (const line of h.lines) {
      const text = line.slice(1);
      if (line.startsWith('+')) rows.push({ type: 'add', text, no: newNo++ });
      else if (line.startsWith('-')) rows.push({ type: 'remove', text, no: oldNo++ });
      else {
        rows.push({ type: 'same', text, no: newNo++ });
        oldNo++;
      }
    }
    shownTo = newNo - 1;
  }
  return rows;
}

// the path heads the diff unless the caller shows it already
export function HunksView({ path, hunks }: { path?: string; hunks: DiffHunk[] }) {
  return (
    <div className="diff">
      {path && <div className="diff-path mono">{path}</div>}
      <div className="diff-body mono">
        {rowsOf(hunks).map((r, i) =>
          r.type === 'fold' ? (
            <div key={i} className="diff-fold">
              {r.text}
            </div>
          ) : (
            <div key={i} className={`diff-line ${r.type}`}>
              <span className="no">{r.no}</span>
              <span className="sign">{r.type === 'add' ? '+' : r.type === 'remove' ? '-' : ' '}</span>
              <span className="text">{r.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

// the diffs one tool call carried, each placed where the harness said it is
export function CallDiffs({ content, locations }: { content: ToolCallContent[]; locations?: ToolCallLocation[] }) {
  return (
    <>
      {placeDiffs(content, locations).map((d: PlacedDiff, i) => (
        <HunksView key={i} path={d.path} hunks={hunksOf(d.oldText, d.newText, d.oldLine, d.newLine)} />
      ))}
    </>
  );
}
