// the Anthropic Messages shape, as Claude Code speaks it and Ollama's /v1/messages answers it

import { BACKGROUND_MODEL, type RouteSettings } from '@shared/proxy';
import { SseReader } from './sse';
import type { Json, LocalReply, Meter, Rewritten, Shape, Usage } from './shape';

const LOCAL_TEXT = 'New session';

function historyHasThinking(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some(
    (m) =>
      m?.role === 'assistant' &&
      Array.isArray(m.content) &&
      m.content.some((b: Json) => b?.type === 'thinking' || b?.type === 'redacted_thinking'),
  );
}

function rewrite(body: Json, settings: RouteSettings): Rewritten {
  const kind = body.model === BACKGROUND_MODEL ? 'background' : 'main';
  const out: Json = { ...body, model: settings.model };
  if (kind === 'main') {
    if (settings.effort === 'off') {
      out.thinking = { type: 'disabled' };
    } else if ((body.thinking as Json | undefined)?.type !== 'enabled') {
      const max = typeof body.max_tokens === 'number' ? body.max_tokens : 32000;
      out.thinking = { type: 'enabled', budget_tokens: Math.max(1024, Math.min(16000, max - 1)) };
    }
  }
  return { body: out, kind, historyHasThinking: historyHasThinking(body.messages) };
}

class AnthropicMeter implements Meter {
  private reader = new SseReader();
  private input: number | null = null;
  private output: number | null = null;
  private started = false;

  feed(text: string): boolean {
    for (const payload of this.reader.push(text)) {
      let event: Json;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === 'message_start') {
        const usage = (event.message as Json | undefined)?.usage as Json | undefined;
        if (typeof usage?.input_tokens === 'number') this.input = usage.input_tokens;
      } else if (event.type === 'content_block_start' || event.type === 'content_block_delta') {
        this.started = true;
      } else if (event.type === 'message_delta') {
        const usage = event.usage as Json | undefined;
        if (typeof usage?.output_tokens === 'number') this.output = usage.output_tokens;
        if (typeof usage?.input_tokens === 'number') this.input = usage.input_tokens;
      }
    }
    return this.started;
  }

  whole(text: string): void {
    try {
      const usage = (JSON.parse(text) as Json).usage as Json | undefined;
      if (typeof usage?.input_tokens === 'number') this.input = usage.input_tokens;
      if (typeof usage?.output_tokens === 'number') this.output = usage.output_tokens;
    } catch {
      // a reply that is not JSON carries no usage
    }
  }

  usage(): Usage {
    return { inputTokens: this.input, outputTokens: this.output };
  }
}

function sse(events: Json[]): string {
  return events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
}

function local(body: Json): LocalReply {
  const message = {
    id: 'msg_wrontend_local',
    type: 'message',
    role: 'assistant',
    model: body.model,
    content: [{ type: 'text', text: LOCAL_TEXT }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };
  if (!body.stream) return { status: 200, contentType: 'application/json', payload: JSON.stringify(message) };
  return {
    status: 200,
    contentType: 'text/event-stream',
    payload: sse([
      { type: 'message_start', message: { ...message, content: [], stop_reason: null } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: LOCAL_TEXT } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 0 } },
      { type: 'message_stop' },
    ]),
  };
}

function error(status: number, message: string): LocalReply {
  const type = status === 400 ? 'invalid_request_error' : 'api_error';
  return { status, contentType: 'application/json', payload: JSON.stringify({ type: 'error', error: { type, message } }) };
}

export const anthropic: Shape = { rewrite, meter: () => new AnthropicMeter(), error, local };
