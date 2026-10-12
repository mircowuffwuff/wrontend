import { describe, expect, it } from 'vitest';
import { back, forget, forward, NO_HISTORY, visit } from './history';

describe('the screen history', () => {
  it('goes back and forward through the screens opened', () => {
    let h = visit(NO_HISTORY, null, 'a');
    h = visit(h, 'a', 'b');
    const once = back(h, 'b')!;
    expect(once.screen).toBe('a');
    const twice = back(once.history, 'a')!;
    expect(twice.screen).toBe(null);
    expect(back(twice.history, null)).toBe(null);
    const ahead = forward(twice.history, null)!;
    expect(ahead.screen).toBe('a');
    expect(forward(ahead.history, 'a')!.screen).toBe('b');
  });

  it('drops what lay ahead when a new screen is opened', () => {
    const h = visit(visit(NO_HISTORY, null, 'a'), 'a', 'b');
    const behind = back(h, 'b')!;
    const branched = visit(behind.history, 'a', 'c');
    expect(branched.future).toEqual([]);
    expect(branched.past).toEqual([null, 'a']);
  });

  it('does not count opening the screen already shown', () => {
    expect(visit(NO_HISTORY, 'a', 'a')).toBe(NO_HISTORY);
  });

  it('forgets a deleted session and merges the screens that then meet', () => {
    // a, b, a, b(deleted, current) -- after the delete the new-session screen shows
    const h = { past: ['a', 'b', 'a'], future: [] };
    expect(forget(h, null, 'b')).toEqual({ past: ['a'], future: [] });
    // the current screen does not sit in its own history either
    expect(forget({ past: [null, 'x', 'a'], future: ['x', 'a', 'c'] }, 'a', 'x')).toEqual({ past: [null], future: ['c'] });
  });
});
