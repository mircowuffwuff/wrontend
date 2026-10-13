// a session as the main process keeps it and a UI mirrors it: what it is, its transcript, its turn, and the changes that
// keep a mirror in step

import type {
  AvailableCommand,
  PermissionOption,
  PlanEntry,
  SessionMode,
  ToolCallContent,
  ToolCallLocation,
  ToolCallStatus,
  ToolCallUpdate,
  ToolKind,
} from '@agentclientprotocol/sdk';
import type { LoadedModel } from './ollama';
import type { Effort, RequestStats } from './proxy';

export interface SessionInfo {
  id: string;
  harness: string;
  // the project folder's record, and its path as that record has it
  folderId: string;
  folder: string;
  model: string;
  effort: Effort;
  // the first line of the first prompt until the user renames it
  title: string;
  createdAt: number;
  // the harness mode the user picked; re-applied when the session reopens
  mode?: string;
}

export interface ToolItem {
  kind: 'tool';
  // the harness's own id for the call
  id: string;
  title: string;
  toolKind: ToolKind | null;
  status: ToolCallStatus;
  content: ToolCallContent[];
  // where the call worked; a harness may give each diff the line it starts on here
  locations?: ToolCallLocation[];
  rawInput: unknown;
}

// what the transcript holds, in order. a thought's endedAt is null while it is still being written
export type TranscriptItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'thought'; id: string; text: string; startedAt: number; endedAt: number | null }
  | ToolItem
  // the agent's to-do list; one per session, updated in place
  | { kind: 'plan'; id: string; entries: PlanEntry[] }
  // the files a finished turn changed, each as one diff from before the turn to after it
  | { kind: 'edits'; id: string; files: EditedFile[] }
  | { kind: 'error'; id: string; message: string; detail: string }
  // a quiet line, such as a turn the user stopped
  | { kind: 'notice'; id: string; text: string };

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

export interface PermissionRequest {
  // wrontend's id for this one request, used to answer it
  requestId: string;
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export interface SessionState {
  info: SessionInfo;
  items: TranscriptItem[];
  // when the running turn started; null while no turn runs
  turnStartedAt: number | null;
  // the harness's questions waiting for an answer, oldest first. a turn waits until each is answered
  permissions: PermissionRequest[];
  // the harness's modes as it last reported them; null for a session whose harness has never reported any
  modes: SessionModes | null;
  // the harness's slash commands as it last reported them. a prompt that starts with /name runs one
  commands: AvailableCommand[];
  // the context window as the harness last reported it, where it reports one
  usage: { used: number; size: number } | null;
  // the proxy's measure of the session's last request on the model's main line
  lastMain: RequestStats | null;
}

// how a mirror of main's sessions follows them: a session added, one whose fields or transcript changed, one removed.
// items is the transcript from index from on; everything before it is unchanged
export type SessionChange =
  | { type: 'added'; session: SessionState }
  | { type: 'updated'; id: string; fields: Partial<Omit<SessionState, 'items'>>; items?: { from: number; items: TranscriptItem[] } }
  | { type: 'removed'; id: string };

// the list newest first, as session:list returns it
export function applySessionChange(sessions: SessionState[], change: SessionChange): SessionState[] {
  switch (change.type) {
    case 'added':
      return [change.session, ...sessions.filter((s) => s.info.id !== change.session.info.id)];
    case 'removed':
      return sessions.filter((s) => s.info.id !== change.id);
    case 'updated':
      return sessions.map((s) => {
        if (s.info.id !== change.id) return s;
        const items = change.items ? [...s.items.slice(0, change.items.from), ...change.items.items] : s.items;
        return { ...s, ...change.fields, items };
      });
  }
}

// how full the session's context window is: what the harness reports, else the proxy's measure of the last main request
// against the window Ollama loaded the session's model with. a number neither knows is null
export function contextUse(session: SessionState, loaded: LoadedModel[]): { used: number | null; size: number | null } {
  const { usage, lastMain, info } = session;
  const used = usage?.used ?? (lastMain ? (lastMain.inputTokens ?? 0) + (lastMain.outputTokens ?? 0) : null);
  const size = usage?.size ?? loaded.find((m) => m.name === info.model)?.contextLength ?? null;
  return { used, size };
}

export interface CreateSessionOptions {
  harness: string;
  folder: string;
  model: string;
  effort: Effort;
}

// a passage quoted in a prompt, with the reply to it. a prompt carries each as a markdown quote followed by its reply
export interface Quote {
  quote: string;
  reply: string;
}

// what a new session starts with: the harness, model and effort picked last, remembered across launches
export interface SessionDefaults {
  harness: string | null;
  model: string | null;
  effort: Effort;
}
