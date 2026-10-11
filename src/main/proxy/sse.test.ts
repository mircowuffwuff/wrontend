import { describe, expect, it } from 'vitest';
import { SseReader } from './sse';

describe('SseReader', () => {
  it('keeps a payload whole across chunk boundaries and line separators inside JSON strings', () => {
    const reader = new SseReader();
    const payload = JSON.stringify({ text: 'a b c' });
    const stream = `event: x\ndata: ${payload}\n\ndata: [DONE]\r\n\r\n`;
    const out = [...reader.push(stream.slice(0, 20)), ...reader.push(stream.slice(20))];
    expect(out).toEqual([payload, '[DONE]']);
    expect(JSON.parse(out[0]).text).toBe('a b c');
  });
});
