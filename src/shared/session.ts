// what a session looks like from the renderer, and the events main sends about it

import type { PermissionOption, SessionMode, SessionUpdate, StopReason, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { Effort, RequestStats } from './proxy';

export interface SessionInfo {
  id: string;
  harness: string;
  folder: string;
  model: string;
  effort: Effort;
  title: string;
  createdAt: number;
  // the harness mode the user picked; re-applied when the session reopens
  mode?: string;
}

// a session as it is kept on disk: what it is, the harness's own id to reopen it with, and wrontend's copy of the transcript
export interface StoredSession {
  info: SessionInfo;
  harnessSessionId: string | null;
  // the harness's modes as last reported, so a dormant session can show and offer them
  modes: SessionModes | null;
  // the renderer's transcript items, kept opaque here; the renderer owns their shape
  items: unknown[];
}

export interface SessionModes {
  current: string;
  available: SessionMode[];
}

// a new session as creation returns it: its modes come along, since the harness reports them before the renderer knows the session
export interface CreatedSession {
  info: SessionInfo;
  modes: SessionModes | null;
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
  | { sessionId: string; type: 'exit'; code: number | null; detail: string }
  | { sessionId: string; type: 'notice'; text: string }
  | { sessionId: string; type: 'modes'; current: string; available: SessionMode[] };
