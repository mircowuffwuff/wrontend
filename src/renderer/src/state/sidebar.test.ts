import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@shared/session';
import { groupSessions } from './sidebar';

const session = (id: string, folderId: string, folder: string, title: string): SessionInfo => ({
  id,
  harness: 'fake',
  folderId,
  folder,
  model: 'm',
  effort: 'on',
  title,
  createdAt: 0,
});

// newest first, as the session list keeps them
const sessions = [
  session('1', 'f-app', 'C:/code/app', 'Fix the login form'),
  session('2', 'f-docs', 'C:/code/docs', 'Write the install guide'),
  session('3', 'f-app', 'C:/code/app', 'Add a dark theme'),
];

describe('groupSessions', () => {
  it('groups by folder, the folder with the newest session first', () => {
    expect(groupSessions(sessions, '').map((g) => [g.folderId, g.ids])).toEqual([
      ['f-app', ['1', '3']],
      ['f-docs', ['2']],
    ]);
  });

  it('keeps the sessions whose title holds the search, in any case, and drops a group left empty', () => {
    expect(groupSessions(sessions, ' DARK ').map((g) => [g.folderId, g.ids])).toEqual([['f-app', ['3']]]);
  });

  it('keeps every session of a folder whose name holds the search', () => {
    expect(groupSessions(sessions, 'docs').map((g) => [g.folderId, g.ids])).toEqual([['f-docs', ['2']]]);
    // the path above the folder is not its name
    expect(groupSessions(sessions, 'code')).toEqual([]);
  });
});
