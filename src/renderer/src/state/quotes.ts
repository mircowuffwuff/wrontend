// replies to selected passages of the transcript, collected as cards in the prompt box until the message is sent

import { create } from 'zustand';

export interface QuoteCard {
  id: string;
  quote: string;
  reply: string;
}

// cards belong to one session's prompt box; the new-session screen has none to quote from
interface QuotesState {
  cards: Record<string, QuoteCard[]>;
  add(sessionId: string, quote: string, reply: string): void;
  remove(sessionId: string, id: string): void;
  clear(sessionId: string): void;
}

let counter = 0;

export const useQuotes = create<QuotesState>((set) => ({
  cards: {},
  add(sessionId, quote, reply) {
    const card = { id: `q-${++counter}`, quote: quote.trim(), reply: reply.trim() };
    set((s) => ({ cards: { ...s.cards, [sessionId]: [...(s.cards[sessionId] ?? []), card] } }));
  },
  remove(sessionId, id) {
    set((s) => ({ cards: { ...s.cards, [sessionId]: (s.cards[sessionId] ?? []).filter((c) => c.id !== id) } }));
  },
  clear(sessionId) {
    set((s) => ({ cards: { ...s.cards, [sessionId]: [] } }));
  },
}));

// each card becomes a markdown quote followed by its reply, in the order they were written; the typed text comes last
export function composeMessage(cards: QuoteCard[], text: string): string {
  const parts = cards.map((c) => {
    const quote = c.quote
      .split('\n')
      .map((line) => (line.trim() ? `> ${line}` : '>'))
      .join('\n');
    return c.reply ? `${quote}\n\n${c.reply}` : quote;
  });
  if (text.trim()) parts.push(text.trim());
  return parts.join('\n\n');
}
