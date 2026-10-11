// one harness process, one ACP connection, one session: spawned on creation, killed with its tree on close

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import {
  client,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ClientConnection,
  type RequestPermissionResponse,
  type SessionModeState,
} from '@agentclientprotocol/sdk';
import type { RouteSettings } from '@shared/proxy';
import type { PermissionRequest, SessionEvent, SessionModes } from '@shared/session';
import type { RouteHandle } from '../proxy/server';
import type { HarnessProfile } from './profiles';

const STDERR_KEEP = 40;

export interface AgentSessionOptions {
  id: string;
  profile: HarnessProfile;
  folder: string;
  harnessHome: string;
  route: RouteHandle;
  emit: (event: SessionEvent) => void;
}

export class AgentSession {
  private child: ChildProcess | null = null;
  private connection: ClientConnection | null = null;
  private acpSessionId: string | null = null;
  private readonly pending = new Map<string, (answer: RequestPermissionResponse) => void>();
  private readonly stderr: string[] = [];
  private turn: Promise<void> | null = null;
  // set when wrontend itself stops the process, whose exit is then no news
  private disposing = false;
  private lastModes: SessionModes | null = null;

  constructor(private readonly o: AgentSessionOptions) {}

  get running(): boolean {
    return this.turn !== null;
  }

  // the harness's own id for this session, kept so the session can be reopened after a restart
  get harnessSessionId(): string | null {
    return this.acpSessionId;
  }

  // with resumeId, reopens the harness's earlier session; returns how it started
  async start(resumeId: string | null = null): Promise<'new' | 'resumed' | 'fresh-after-resume-failed'> {
    mkdirSync(this.o.harnessHome, { recursive: true });
    const launch = this.o.profile.launch({ proxyUrl: this.o.route.baseUrl, harnessHome: this.o.harnessHome });
    const child = spawn(launch.command, launch.args, {
      cwd: this.o.folder,
      env: { ...inheritedEnv(), ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child = child;

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (text: string) => {
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        this.stderr.push(line);
        if (this.stderr.length > STDERR_KEEP) this.stderr.shift();
      }
    });
    child.on('exit', (code) => {
      this.connection?.close();
      this.child = null;
      this.closeAllPermissions();
      if (!this.disposing) this.o.emit({ sessionId: this.o.id, type: 'exit', code, detail: this.stderr.join('\n') });
    });

    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    const app = client({ name: 'wrontend' })
      .onNotification('session/update', ({ params }) => {
        this.o.emit({ sessionId: this.o.id, type: 'update', update: params.update });
      })
      .onRequest('session/request_permission', ({ params, signal }) => {
        const request: PermissionRequest = { requestId: randomUUID(), toolCall: params.toolCall, options: params.options };
        return new Promise<RequestPermissionResponse>((resolve) => {
          this.pending.set(request.requestId, resolve);
          signal.addEventListener('abort', () => this.answer(request.requestId, null));
          this.o.emit({ sessionId: this.o.id, type: 'permission', request });
        });
      });
    this.connection = app.connect(stream);

    const agent = this.connection.agent;
    const init = await agent.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'wrontend', version: '0.1.0' },
    });

    // resume reopens a session without replaying it -- wrontend already shows its own copy of the transcript
    if (resumeId && init.agentCapabilities?.sessionCapabilities?.resume) {
      try {
        const resumed = await agent.request('session/resume', { sessionId: resumeId, cwd: this.o.folder, mcpServers: [] });
        this.acpSessionId = resumeId;
        this.reportModes(resumed.modes);
        return 'resumed';
      } catch {
        // the harness no longer has it -- a fresh session keeps the transcript usable, without the earlier context
      }
    }
    const created = await agent.request('session/new', { cwd: this.o.folder, mcpServers: [] });
    this.acpSessionId = created.sessionId;
    this.reportModes(created.modes);
    return resumeId ? 'fresh-after-resume-failed' : 'new';
  }

  // resolves when the turn is over; its end is also reported as an event
  prompt(text: string): Promise<void> {
    if (!this.connection || !this.acpSessionId) throw new Error('the session has not started');
    if (this.turn) throw new Error('a turn is already running');
    const agent = this.connection.agent;
    const sessionId = this.acpSessionId;
    this.o.emit({ sessionId: this.o.id, type: 'turn-start' });
    this.turn = agent
      .request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
      .then(
        (response) => this.o.emit({ sessionId: this.o.id, type: 'turn-end', stopReason: response.stopReason }),
        (cause: unknown) =>
          this.o.emit({ sessionId: this.o.id, type: 'turn-end', stopReason: 'error', error: describe(cause, this.stderr) }),
      )
      .finally(() => {
        this.turn = null;
        this.closeAllPermissions();
      });
    return this.turn;
  }

  async cancel(): Promise<void> {
    if (!this.connection || !this.acpSessionId || !this.turn) return;
    this.closeAllPermissions();
    await this.connection.agent.notify('session/cancel', { sessionId: this.acpSessionId });
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.connection || !this.acpSessionId) throw new Error('the session has not started');
    await this.connection.agent.request('session/set_mode', { sessionId: this.acpSessionId, modeId });
  }

  // the modes the harness reported last
  get modes(): SessionModes | null {
    return this.lastModes;
  }

  private reportModes(modes: SessionModeState | null | undefined): void {
    if (modes) this.lastModes = { current: modes.currentModeId, available: modes.availableModes };
    if (modes) this.o.emit({ sessionId: this.o.id, type: 'modes', current: modes.currentModeId, available: modes.availableModes });
  }

  // a null option means the request was dismissed, which ACP calls cancelled
  answer(requestId: string, optionId: string | null): void {
    const resolve = this.pending.get(requestId);
    if (!resolve) return;
    this.pending.delete(requestId);
    resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } });
    this.o.emit({ sessionId: this.o.id, type: 'permission-closed', requestId });
  }

  updateRoute(settings: Partial<RouteSettings>): void {
    this.o.route.update(settings);
  }

  dispose(): void {
    this.disposing = true;
    this.closeAllPermissions();
    this.connection?.close();
    killTree(this.child);
    this.child = null;
    this.o.route.dispose();
  }

  private closeAllPermissions(): void {
    for (const id of [...this.pending.keys()]) this.answer(id, null);
  }
}

// wrontend's own environment, minus anything that would steer a harness's backend or Claude Code's behaviour: the profile sets those itself
function inheritedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!/^(ANTHROPIC_|CLAUDE_|CLAUDECODE)/i.test(key)) env[key] = value;
  }
  return env;
}

function describe(cause: unknown, stderr: string[]): string {
  const message = cause instanceof Error ? cause.message : JSON.stringify(cause);
  const tail = stderr.slice(-8).join('\n');
  return tail ? `${message}\n\n${tail}` : message;
}

// the harness starts children of its own -- Claude Code, its tools -- so the whole tree goes
function killTree(child: ChildProcess | null): void {
  if (!child?.pid || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}
