import { describe, expect, it } from 'vitest';
import { before, countContent, countHunks, diffRows, editedFile, hunksOf, placeDiffs, type PlacedDiff } from './diffs';

const lines = (from: number, to: number, change: Record<number, string> = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => change[from + i] ?? `line ${from + i}`).join('\n');

const file = (change: Record<number, string> = {}) => `${lines(1, 20, change)}\n`;

// two edits as Claude Code sends them: hunks with three lines of context, placed by the line each starts on
const first: PlacedDiff = { path: 'a.ts', oldText: lines(2, 8), newText: lines(2, 8, { 5: 'five' }), oldLine: 2, newLine: 2 };
const second: PlacedDiff = { path: 'a.ts', oldText: lines(3, 9, { 5: 'five' }), newText: lines(3, 9, { 5: 'five', 6: 'six' }), oldLine: 3, newLine: 3 };

describe('placeDiffs', () => {
  it('gives each diff the line of the location sent with it, and the old line after the diffs before it', () => {
    const placed = placeDiffs(
      [
        { type: 'diff', path: 'a.ts', oldText: 'a', newText: 'a\nb\nc' },
        { type: 'diff', path: 'a.ts', oldText: 'x', newText: 'y' },
      ],
      [
        { path: 'a.ts', line: 4 },
        { path: 'a.ts', line: 20 },
      ],
    );
    expect(placed.map((d) => [d.oldLine, d.newLine])).toEqual([
      [4, 4],
      [18, 20],
    ]);
  });

  it('places nothing when the locations do not pair with the diffs', () => {
    const placed = placeDiffs([{ type: 'diff', path: 'a.ts', oldText: 'a', newText: 'b' }], [{ path: 'a.ts' }]);
    expect(placed[0].newLine).toBeUndefined();
  });
});

describe('before', () => {
  it('undoes a turn of edits, last first', () => {
    expect(before(file({ 5: 'five', 6: 'six' }), [first, second])).toBe(file());
  });

  it('reads a file with Windows line endings', () => {
    expect(before(file({ 5: 'five', 6: 'six' }).replace(/\n/g, '\r\n'), [first, second])).toBe(file());
  });

  it('empties a file the turn created', () => {
    expect(before('one\ntwo\n', [{ path: 'b.ts', oldText: null, newText: 'one\ntwo' }])).toBe('');
  });

  it('picks the copy nearest the line when a stretch is in the file twice', () => {
    const twice = 'x\ny\nz\nx\ny\nz\n';
    expect(before(twice, [{ path: 'c.ts', oldText: 'x\nw', newText: 'x\ny', newLine: 4 }])).toBe('x\ny\nz\nx\nw\nz\n');
  });

  it('gives up on an edit the file no longer holds', () => {
    expect(before(file(), [first])).toBeNull();
  });
});

describe('editedFile', () => {
  it('turns two edits to one file into one diff with its real line numbers', () => {
    const edited = editedFile('a.ts', file({ 5: 'five', 6: 'six' }), [first, second]);
    expect(edited).toMatchObject({ path: 'a.ts', whole: true });
    expect(edited!.hunks).toHaveLength(1);
    expect(edited!.hunks[0]).toMatchObject({ oldStart: 2, newStart: 2 });
    expect(edited!.hunks[0].lines.filter((l) => l[0] !== ' ')).toEqual(['-line 5', '-line 6', '+five', '+six']);
  });

  it('leaves out a file whose edits undid each other', () => {
    const undo: PlacedDiff = { path: 'a.ts', oldText: first.newText, newText: first.oldText!, oldLine: 2, newLine: 2 };
    expect(editedFile('a.ts', file(), [first, undo])).toBeNull();
  });

  it('shows each edit at its own lines when the file cannot be read', () => {
    const edited = editedFile('a.ts', null, [first, second]);
    expect(edited).toMatchObject({ whole: false });
    expect(edited!.hunks.map((h) => h.newStart)).toEqual([2, 3]);
    expect(countHunks(edited!.hunks)).toEqual({ added: 2, removed: 2 });
  });
});

describe('hunksOf', () => {
  it('folds a stretch of a file into hunks placed at its lines', () => {
    const hunks = hunksOf(lines(1, 12), lines(1, 12, { 10: 'ten' }), 40, 41);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toMatchObject({ oldStart: 46, newStart: 47 });
  });
});

describe('diffRows', () => {
  it('numbers each line in its own file and folds the unchanged lines above and between the hunks', () => {
    const hunks = hunksOf(file(), file({ 6: 'six', 16: 'sixteen' }));
    const rows = diffRows(hunks);
    expect(rows.filter((r) => r.type === 'fold')).toEqual([
      { type: 'fold', lines: 2 },
      { type: 'fold', lines: 3 },
    ]);
    expect(rows.filter((r) => r.type !== 'fold' && r.type !== 'same')).toEqual([
      { type: 'remove', text: 'line 6', no: 6 },
      { type: 'add', text: 'six', no: 6 },
      { type: 'remove', text: 'line 16', no: 16 },
      { type: 'add', text: 'sixteen', no: 16 },
    ]);
    expect(rows[1]).toEqual({ type: 'same', text: 'line 3', no: 3 });
  });
});

describe('countContent', () => {
  it('counts the lines a tool call’s diffs add and remove, and nothing for its other content', () => {
    const counts = countContent([
      { type: 'diff', path: 'a.ts', oldText: 'a\nb', newText: 'a\nc\nd' },
      { type: 'content', content: { type: 'text', text: 'done' } },
    ]);
    expect(counts).toEqual({ added: 2, removed: 1 });
  });
});
