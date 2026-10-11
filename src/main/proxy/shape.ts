// what the proxy needs to know about one API shape: where its fields live, and how its replies report usage

import type { RouteSettings } from '@shared/proxy';

export type Json = Record<string, unknown>;

export interface Rewritten {
  body: Json;
  kind: 'main' | 'background';
  historyHasThinking: boolean;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface Meter {
  // takes a decoded piece of a streamed reply; true once the piece that carries the first content has passed
  feed(text: string): boolean;
  // takes a whole non-streamed reply
  whole(text: string): void;
  usage(): Usage;
}

export interface LocalReply {
  status: number;
  contentType: string;
  payload: string;
}

export interface Shape {
  // only the top-level fields change; the system prompt, messages and tools pass through untouched
  rewrite(body: Json, settings: RouteSettings): Rewritten;
  meter(): Meter;
  error(status: number, message: string): LocalReply;
  // a canned reply for a background request the policy answers without the model
  local(body: Json): LocalReply;
  // whether a request only asks for a session title
  isTitle(body: Json): boolean;
}
