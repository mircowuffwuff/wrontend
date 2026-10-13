import { describe, expect, it } from 'vitest';
import { matchCommands, pickedText, slashQuery } from './commands';

const commands = [
  { name: 'compact', description: 'Summarise the conversation' },
  { name: 'anthropic-skills:schedule', description: 'Schedule a task' },
  { name: 'schedule', description: 'Create a routine' },
  { name: 'workflow', description: 'Runs on a schedule' },
  { name: 'init', description: 'Write an AGENTS.md' },
];

describe('slashQuery', () => {
  it('reads the name typed after a leading slash', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/sch')).toBe('sch');
  });

  it('is null once the name ends, or when the slash does not lead', () => {
    expect(slashQuery('/review main')).toBeNull();
    expect(slashQuery('/review ')).toBeNull();
    expect(slashQuery(' /review')).toBeNull();
    expect(slashQuery('a/b')).toBeNull();
    expect(slashQuery('')).toBeNull();
    expect(slashQuery('/a\nb')).toBeNull();
  });
});

describe('matchCommands', () => {
  it('lists every command, in order, for an empty query', () => {
    expect(matchCommands(commands, '').map((m) => m.command.name)).toEqual(commands.map((c) => c.name));
  });

  it('puts names that start with the query first, then names containing it, then descriptions', () => {
    const matches = matchCommands(commands, 'SCHED');
    expect(matches.map((m) => [m.command.name, m.at])).toEqual([
      ['schedule', 0],
      ['anthropic-skills:schedule', 17],
      ['workflow', null],
    ]);
  });

  it('matches nothing when neither name nor description has the query', () => {
    expect(matchCommands(commands, 'zzz')).toEqual([]);
  });
});

describe('pickedText', () => {
  it('leaves the command ready for its input', () => {
    expect(pickedText({ name: 'review', description: '' })).toBe('/review ');
  });
});
