// what a session looks like from the renderer, and the events main sends about it

import type { PermissionOption, SessionMode, SessionUpdate, StopReason, ToolCallUpdate } from '@agentclientprotocol/sdk';
import type { Effort, RequestStats } from './proxy';

export interface SessionInfo {
  id: string;
  harness: string;
  // the project folder's record, and its path as that record has it
  folderId: string;
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

// a stretch of a unified diff: where it starts in the old and the new file, and its lines, each led by '+', '-' or ' '
export interface DiffHunk {
  oldStart: number;
  newStart: number;
  lines: string[];
}

// a file a turn changed, as its diff from before the turn to after it
export interface EditedFile {
  // the path as the harness named it
  path: string;
  hunks: DiffHunk[];
  // false when the file's state before the turn could not be worked out: the hunks are then each edit's own, in order
  whole: boolean;
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
  // edits lists the files the turn's completed tool calls changed
  | { sessionId: string; type: 'turn-end'; stopReason: StopReason | 'error'; error?: string; edits: EditedFile[] }
  | { sessionId: string; type: 'stats'; stats: RequestStats }
  | { sessionId: string; type: 'exit'; code: number | null; detail: string }
  | { sessionId: string; type: 'notice'; text: string }
  | { sessionId: string; type: 'modes'; current: string; available: SessionMode[] };
