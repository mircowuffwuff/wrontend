// the OpenAI chat-completions shape, as Pi and OpenCode speak it and Ollama's /v1/chat/completions answers it

import { BACKGROUND_MODEL, type RouteSettings } from '@shared/proxy';
import { SseReader } from './sse';
import type { Json, LocalReply, Meter, Rewritten, Shape, Usage } from './shape';

const LOCAL_TEXT = 'New session';

function historyHasThinking(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m) => m?.role === 'assistant' && (m.reasoning_content || m.reasoning));
}

// effort is not applied in this shape: how Ollama's OpenAI endpoint takes a thinking switch is unverified
function rewrite(body: Json, settings: RouteSettings): Rewritten {
  const kind = body.model === BACKGROUND_MODEL ? 'background' : 'main';
  const out: Json = { ...body, model: settings.model };
  if (body.stream) out.stream_options = { ...(body.stream_options as Json | undefined), include_usage: true };
  return { body: out, kind, historyHasThinking: historyHasThinking(body.messages) };
}

class OpenAiMeter implements Meter {
  private reader = new SseReader();
  private input: number | null = null;
  private output: number | null = null;
  private started = false;

  private take(usage: Json | undefined): void {
    if (typeof usage?.prompt_tokens === 'number') this.input = usage.prompt_tokens;
    if (typeof usage?.completion_tokens === 'number') this.output = usage.completion_tokens;
  }

  feed(text: string): boolean {
    for (const payload of this.reader.push(text)) {
      if (payload === '[DONE]') continue;
      let chunk: Json;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = ((chunk.choices as Json[] | undefined)?.[0]?.delta ?? {}) as Json;
      if (delta.content || delta.reasoning_content || delta.reasoning || delta.tool_calls) this.started = true;
      this.take(chunk.usage as Json | undefined);
    }
    return this.started;
  }

  whole(text: string): void {
    try {
      this.take((JSON.parse(text) as Json).usage as Json | undefined);
    } catch {
      // a reply that is not JSON carries no usage
    }
  }

  usage(): Usage {
    return { inputTokens: this.input, outputTokens: this.output };
  }
}

function local(body: Json): LocalReply {
  const base = { id: 'chatcmpl-wrontend-local', created: Math.floor(Date.now() / 1000), model: body.model };
  if (!body.stream) {
    return {
      status: 200,
      contentType: 'application/json',
      payload: JSON.stringify({
        ...base,
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: LOCAL_TEXT }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    };
  }
  const chunk = (delta: Json, finish: string | null) =>
    `data: ${JSON.stringify({ ...base, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return {
    status: 200,
    contentType: 'text/event-stream',
    payload: chunk({ role: 'assistant', content: LOCAL_TEXT }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n',
  };
}

function error(status: number, message: string): LocalReply {
  return { status, contentType: 'application/json', payload: JSON.stringify({ error: { message, type: 'api_error' } }) };
}

export const openai: Shape = { rewrite, meter: () => new OpenAiMeter(), error, local };
