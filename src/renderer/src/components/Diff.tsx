// a unified diff of one file, and the line counts the summaries show

import { diffLines } from 'diff';
import type { ToolCallContent } from '@agentclientprotocol/sdk';

export interface LineCounts {
  added: number;
  removed: number;
}

export function countLines(oldText: string | null | undefined, newText: string): LineCounts {
  let added = 0;
  let removed = 0;
  for (const part of diffLines(oldText ?? '', newText)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

export function countContent(content: ToolCallContent[]): LineCounts {
  const total = { added: 0, removed: 0 };
  for (const c of content) {
    if (c.type !== 'diff') continue;
    const n = countLines(c.oldText, c.newText);
    total.added += n.added;
    total.removed += n.removed;
  }
  return total;
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

const CONTEXT = 3;

// the path heads the diff unless the caller shows it already
export function DiffView({ path, oldText, newText }: { path?: string; oldText?: string | null; newText: string }) {
  const parts = diffLines(oldText ?? '', newText);
  const rows: { type: 'add' | 'remove' | 'same' | 'fold'; text: string; oldNo?: number; newNo?: number }[] = [];
  let oldNo = 1;
  let newNo = 1;
  parts.forEach((part, index) => {
    const lines = part.value.replace(/\n$/, '').split('\n');
    if (part.added) {
      for (const text of lines) rows.push({ type: 'add', text, newNo: newNo++ });
    } else if (part.removed) {
      for (const text of lines) rows.push({ type: 'remove', text, oldNo: oldNo++ });
    } else {
      // unchanged stretches keep a little context on each side of a change and fold the rest
      const keepHead = index === 0 ? 0 : CONTEXT;
      const keepTail = index === parts.length - 1 ? 0 : CONTEXT;
      if (lines.length > keepHead + keepTail + 1) {
        for (const text of lines.slice(0, keepHead)) rows.push({ type: 'same', text, oldNo: oldNo++, newNo: newNo++ });
        const hidden = lines.length - keepHead - keepTail;
        rows.push({ type: 'fold', text: `${hidden} unmodified lines` });
        oldNo += hidden;
        newNo += hidden;
        for (const text of lines.slice(lines.length - keepTail)) rows.push({ type: 'same', text, oldNo: oldNo++, newNo: newNo++ });
      } else {
        for (const text of lines) rows.push({ type: 'same', text, oldNo: oldNo++, newNo: newNo++ });
      }
    }
  });
  return (
    <div className="diff">
      {path && <div className="diff-path mono">{path}</div>}
      <div className="diff-body mono">
        {rows.map((r, i) =>
          r.type === 'fold' ? (
            <div key={i} className="diff-fold">
              {r.text}
            </div>
          ) : (
            <div key={i} className={`diff-line ${r.type}`}>
              <span className="no">{r.type === 'add' ? r.newNo : r.oldNo}</span>
              <span className="sign">{r.type === 'add' ? '+' : r.type === 'remove' ? '-' : ' '}</span>
              <span className="text">{r.text || ' '}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
