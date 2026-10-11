import { describe, expect, it } from 'vitest';
import { composeMessage } from './quotes';

describe('composeMessage', () => {
  it('quotes each passage before its reply, keeps their order, and puts the typed text last', () => {
    const message = composeMessage(
      [
        { id: '1', quote: 'does the proxy cost performance?', reply: 'it should not' },
        { id: '2', quote: 'first line\n\nthird line', reply: 'yes' },
      ],
      'anything else?',
    );
    expect(message).toBe('> does the proxy cost performance?\n\nit should not\n\n> first line\n>\n> third line\n\nyes\n\nanything else?');
  });

  it('sends a quote without a reply as just the quote', () => {
    expect(composeMessage([{ id: '1', quote: 'this', reply: '' }], '')).toBe('> this');
  });
});
