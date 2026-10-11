// an incremental reader for server-sent events -- hands back each complete data payload

export class SseReader {
  private buffer = '';

  // splits on \n only: U+2028 and U+2029 are legal inside the JSON payloads, so a line reader that also breaks on them would cut a payload in two
  push(text: string): string[] {
    this.buffer += text;
    const payloads: string[] = [];
    let end: number;
    while ((end = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, end).replace(/\r$/, '');
      this.buffer = this.buffer.slice(end + 1);
      if (line.startsWith('data:')) payloads.push(line.slice(5).trimStart());
    }
    return payloads;
  }
}
