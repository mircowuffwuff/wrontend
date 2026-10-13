// diffs as hunks with real line numbers, as rows to draw and as line counts, and the one diff of a file from before a turn
// to after it

import { structuredPatch } from 'diff';
import type { ToolCallContent, ToolCallLocation } from '@agentclientprotocol/sdk';
import type { DiffHunk, EditedFile } from './session';

// a diff a tool call carried, with the lines it starts on in the old and the new file when the harness said
export interface PlacedDiff {
  path: string;
  oldText: string | null;
  newText: string;
  oldLine?: number;
  newLine?: number;
}

const normalise = (text: string) => text.replace(/\r\n/g, '\n');
const lineCount = (text: string | null | undefined) => (text ? normalise(text).replace(/\n$/, '').split('\n').length : 0);

// ACP ties no location to a particular diff. a harness that sends one location per diff, with a line, as Claude Code does,
// means the line each diff's hunk starts on in the new file; the old file's line follows from the diffs before it in the call
export function placeDiffs(content: ToolCallContent[], locations: ToolCallLocation[] = []): PlacedDiff[] {
  const diffs = content.filter((c) => c.type === 'diff');
  const paired = locations.length === diffs.length && locations.every((l, i) => typeof l.line === 'number' && l.path === diffs[i].path);
  let shift = 0;
  return diffs.map((d, i) => {
    const placed: PlacedDiff = { path: d.path, oldText: d.oldText ?? null, newText: d.newText };
    if (paired) {
      placed.newLine = locations[i].line!;
      placed.oldLine = placed.newLine - shift;
    }
    shift += lineCount(d.newText) - lineCount(d.oldText);
    return placed;
  });
}

// a diff of two whole files gives up after this long, rather than hold up the end of a turn
const WHOLE_FILE_MS = 200;

// the hunks between two texts, with three lines of context; texts that are stretches of a file are placed by their lines
export function hunksOf(oldText: string | null, newText: string, oldLine = 1, newLine = 1): DiffHunk[] {
  return timedHunks(oldText, newText, oldLine, newLine) ?? [];
}

// null when timeoutMs runs out
function timedHunks(oldText: string | null, newText: string, oldLine: number, newLine: number, timeoutMs?: number): DiffHunk[] | null {
  // a missing final newline on one side only is not a change worth a line of its own
  const whole = (text: string) => (text && !text.endsWith('\n') ? `${text}\n` : text);
  const patch = structuredPatch('', '', whole(normalise(oldText ?? '')), whole(normalise(newText)), undefined, undefined, {
    context: 3,
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
  });
  if (!patch) return null;
  return patch.hunks.map((h) => ({
    oldStart: h.oldStart + oldLine - 1,
    newStart: h.newStart + newLine - 1,
    lines: h.lines.filter((l) => !l.startsWith('\\')),
  }));
}

export interface LineCounts {
  added: number;
  removed: number;
}

export function countHunks(hunks: DiffHunk[]): LineCounts {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+')) added++;
      else if (l.startsWith('-')) removed++;
    }
  }
  return { added, removed };
}

// the lines a tool call's diffs add and remove
export function countContent(content: ToolCallContent[]): LineCounts {
  return countHunks(placeDiffs(content).flatMap((d) => hunksOf(d.oldText, d.newText)));
}

// a unified diff's rows: each line with its number -- in the new file, a removed line in the old -- and a fold for the
// unchanged lines the hunks leave out, above the first hunk and between two
export type DiffRow = { type: 'add' | 'remove' | 'same'; text: string; no: number } | { type: 'fold'; lines: number };

export function diffRows(hunks: DiffHunk[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let shownTo = 0;
  for (const h of hunks) {
    const first = Math.max(h.newStart, 1);
    const hidden = first - 1 - shownTo;
    if (hidden > 0) rows.push({ type: 'fold', lines: hidden });
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

// where needle sits in text: whole lines first, any match after; with several, the one nearest the line, else none
function locate(text: string, needle: string, line?: number): number {
  const all: number[] = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) all.push(at);
  const whole = all.filter((at) => (at === 0 || text[at - 1] === '\n') && (at + needle.length === text.length || text[at + needle.length] === '\n'));
  const found = whole.length ? whole : all;
  if (found.length === 1) return found[0];
  if (found.length === 0 || line === undefined) return -1;
  const lineOf = (at: number) => text.slice(0, at).split('\n').length;
  return found.reduce((best, at) => (Math.abs(lineOf(at) - line) < Math.abs(lineOf(best) - line) ? at : best));
}

// the file as it was before edits, worked back from the file after them by undoing each, last first.
// null when an edit cannot be found in the text -- something else changed the file since
export function before(after: string, edits: PlacedDiff[]): string | null {
  let text = normalise(after);
  for (const edit of [...edits].reverse()) {
    const next = normalise(edit.newText);
    const prev = normalise(edit.oldText ?? '');
    if (!next) {
      // an edit that left nothing behind can only be placed in a file it emptied
      if (text.trim()) return null;
      text = prev;
      continue;
    }
    const at = locate(text, next, edit.newLine);
    if (at === -1) return null;
    const rest = text.slice(0, at) + text.slice(at + next.length);
    // a file the edit created leaves at most the newline its text was given
    text = !prev && !rest.trim() ? '' : text.slice(0, at) + prev + text.slice(at + next.length);
  }
  return text;
}

// one file's diff across a turn. after is the file as it is now, or null when it cannot be read; a file whose state
// before the turn cannot be worked out gets each edit's own diff instead. null when the edits undid each other
export function editedFile(path: string, after: string | null, edits: PlacedDiff[]): EditedFile | null {
  const earlier = after === null ? null : before(after, edits);
  const hunks = after !== null && earlier !== null ? timedHunks(earlier, after, 1, 1, WHOLE_FILE_MS) : null;
  if (hunks) return hunks.length ? { path, hunks, whole: true } : null;
  return { path, hunks: edits.flatMap((e) => hunksOf(e.oldText, e.newText, e.oldLine, e.newLine)), whole: false };
}
