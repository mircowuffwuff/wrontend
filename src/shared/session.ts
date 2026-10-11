// what a session looks like from the renderer, and the events main sends about it

import type { PermissionOption, SessionUpdate, StopReason, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { Effort, RequestStats } from './proxy';

export interface SessionInfo {
  id: string;
  harness: string;
  folder: string;
  model: string;
  effort: Effort;
  title: string;
  createdAt: number;
}

export interface CreateSessionOptions {
  harness: string;
  folder: string;
  model: string;
  effort: Effort;
}

export interface PermissionRequest {
  // wrontend's id for this one request, used to answer it
  requestId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export type SessionEvent =
  | { sessionId: string; type: 'update'; update: SessionUpdate }
  | { sessionId: string; type: 'permission'; request: PermissionRequest }
  | { sessionId: string; type: 'permission-closed'; requestId: string }
  | { sessionId: string; type: 'turn-start' }
  | { sessionId: string; type: 'turn-end'; stopReason: StopReason | 'error'; error?: string }
  | { sessionId: string; type: 'stats'; stats: RequestStats }
  | { sessionId: string; type: 'exit'; code: number | null; detail: string };
