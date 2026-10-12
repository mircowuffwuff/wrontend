// Ollama's server settings -- stored as the user's environment variables -- and restarting Ollama so they take effect.
// wrontend never runs an Ollama of its own beside the user's: a restart stops what runs and starts the same thing again

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { OLLAMA_SERVER_VARS, type OllamaServerState, type OllamaServerValues, type OllamaServerVar } from '@shared/settings';
import { powershell, type Stored, type UserEnvironment } from './environment';

export interface OllamaProcess {
  pid: number;
  name: string;
  path: string | null;
  command: string | null;
}

export interface ProcessControl {
  list(): Promise<OllamaProcess[]>;
  kill(pids: number[]): Promise<void>;
  launch(path: string, args: string[], env: NodeJS.ProcessEnv): void;
  // where Ollama's own installer puts its app, when no running Ollama says otherwise
  installedApp(): string | null;
}

export interface OllamaServerOptions {
  environment: UserEnvironment | null;
  processes: ProcessControl | null;
  // the address wrontend talks to Ollama at, read each time: it follows Settings
  baseUrl: () => string;
  reachable: () => Promise<boolean>;
  waitMs?: { stop: number; start: number; poll: number };
}

const APP = 'ollama app.exe';
const SERVER = 'ollama.exe';

export class OllamaServer {
  // the values Ollama last started with, as far as wrontend can tell: read when it was last seen coming up
  private baseline: OllamaServerValues | null = null;
  private restarting: Promise<void> | null = null;

  constructor(private readonly o: OllamaServerOptions) {}

  unsupported(): string | null {
    if (!this.o.environment || !this.o.processes) return 'wrontend stores Ollama’s server settings on Windows.';
    const url = new URL(this.o.baseUrl());
    if (!isLoopback(url.hostname)) return `Ollama runs at ${url.host}, not on this computer.`;
    return null;
  }

  async state(): Promise<OllamaServerState> {
    const unsupported = this.unsupported();
    if (unsupported) return { unsupported, values: emptyValues(), pending: [] };
    const values = await this.read();
    this.baseline ??= values;
    const baseline = this.baseline;
    return { unsupported, values, pending: OLLAMA_SERVER_VARS.filter((name) => values[name] !== baseline[name]) };
  }

  async set(changes: Partial<OllamaServerValues>): Promise<OllamaServerState> {
    const unsupported = this.unsupported();
    if (unsupported) throw new Error(unsupported);
    const known = new Set<string>(OLLAMA_SERVER_VARS);
    const writes: Record<string, string | null> = {};
    for (const [name, value] of Object.entries(changes)) {
      if (!known.has(name)) throw new Error(`not one of Ollama's server settings: ${name}`);
      writes[name] = value === undefined || value === null || value.trim() === '' ? null : value.trim();
    }
    // the values in effect before the first change, if nothing was read yet
    this.baseline ??= await this.read();
    await this.o.environment!.write(writes);
    return this.state();
  }

  // Ollama came up -- started by wrontend, from the Start menu or its tray -- with what is stored now
  async noticeStarted(): Promise<void> {
    if (this.unsupported() || this.restarting) return;
    this.baseline = await this.read().catch(() => this.baseline);
  }

  // startMs: how long Ollama has to answer again -- longer while it installs an update first
  restart(startMs?: number): Promise<void> {
    this.restarting ??= this.doRestart(startMs).finally(() => (this.restarting = null));
    return this.restarting;
  }

  private async doRestart(startMs?: number): Promise<void> {
    const unsupported = this.unsupported();
    if (unsupported) throw new Error(unsupported);
    const processes = this.o.processes!;
    const running = await processes.list();
    const apps = running.filter((p) => p.name.toLowerCase() === APP);
    // only the server: an `ollama run` in somebody's terminal is a client and stays
    const servers = running.filter((p) => p.name.toLowerCase() === SERVER && /\sserve(\s|$)/.test(p.command ?? ''));

    // the tray app if it ran or is installed, else a plain server where one ran. the app takes --hide to stay in the tray,
    // as at login: launched bare, it opens its chat window. a hidden start is also when the app installs an Ollama update
    // it has downloaded -- silently, then it starts again -- exactly as it does at login
    const appPath = apps.find((p) => p.path)?.path ?? (servers.length ? null : processes.installedApp());
    const serverPath = servers.find((p) => p.path)?.path ?? null;
    const target = appPath ? { path: appPath, args: ['--hide'] } : serverPath ? { path: serverPath, args: ['serve'] } : null;
    if (!target) throw new Error('wrontend found no Ollama to start: neither a running one nor its app where Ollama installs it.');

    const waits = { ...(this.o.waitMs ?? { stop: 15_000, start: 60_000, poll: 250 }), ...(startMs ? { start: startMs } : {}) };
    const pids = [...apps, ...servers].map((p) => p.pid);
    if (pids.length) {
      await processes.kill(pids);
      if (!(await this.waitFor(false, waits.stop, waits.poll))) throw new Error('Ollama is still answering after it was stopped.');
    }

    // the values as stored now, never the environment wrontend itself was started with
    const stored = await this.o.environment!.read('OLLAMA_');
    processes.launch(target.path, target.args, launchEnv(process.env, stored));
    if (!(await this.waitFor(true, waits.start, waits.poll))) throw new Error(`Ollama did not answer within ${waits.start / 1000} seconds of starting.`);
    this.baseline = pickValues(stored);
  }

  private async waitFor(reachable: boolean, timeoutMs: number, pollMs: number): Promise<boolean> {
    const until = Date.now() + timeoutMs;
    for (;;) {
      if ((await this.o.reachable()) === reachable) return true;
      if (Date.now() >= until) return false;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  private async read(): Promise<OllamaServerValues> {
    return pickValues(await this.o.environment!.read('OLLAMA_'));
  }
}

// a user's variable shadows the machine's of the same name, as it does for any program the user starts
export function pickValues(stored: { user: Stored; machine: Stored }): OllamaServerValues {
  const values = emptyValues();
  for (const name of OLLAMA_SERVER_VARS) values[name] = find(stored.user, name) ?? find(stored.machine, name) ?? null;
  return values;
}

// wrontend's own environment without any OLLAMA_ variable, then the stored ones. wrontend's own variables stay behind too
export function launchEnv(base: NodeJS.ProcessEnv, stored: { user: Stored; machine: Stored }): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (!/^(OLLAMA_|ELECTRON_|WRONTEND_)/i.test(key)) env[key] = value;
  }
  return { ...env, ...stored.machine, ...stored.user };
}

export function emptyValues(): OllamaServerValues {
  return Object.fromEntries(OLLAMA_SERVER_VARS.map((name) => [name, null])) as Record<OllamaServerVar, null>;
}

// Windows keeps variable names without regard to case
function find(from: Stored, name: string): string | undefined {
  const key = Object.keys(from).find((k) => k.toUpperCase() === name);
  return key === undefined || from[key] === '' ? undefined : from[key];
}

function isLoopback(host: string): boolean {
  return host === 'localhost' || host === '[::1]' || host === '::1' || /^127\./.test(host);
}

export const windowsProcesses: ProcessControl = {
  async list() {
    const json = await powershell(
      `$found = @(Get-CimInstance Win32_Process -Filter "Name='${APP}' OR Name='${SERVER}'" | ForEach-Object {
        [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; path = $_.ExecutablePath; command = $_.CommandLine }
      })
      ConvertTo-Json -InputObject $found -Compress`,
    );
    return json ? (JSON.parse(json) as OllamaProcess[]) : [];
  },

  kill(pids) {
    // the whole tree: the tray app's server, and the server's model runners
    const args = ['/F', '/T', ...pids.flatMap((pid) => ['/PID', String(pid)])];
    // taskkill fails for a process that ended meanwhile, which is the outcome wanted
    return new Promise((resolve) => execFile('taskkill', args, { windowsHide: true }, () => resolve()));
  },

  launch(path, args, env) {
    // detached: Ollama outlives wrontend, as it would have had the user started it. the server is a console program and gets no
    // console window; the app is left alone, since a hidden start would also hide its window the first time it is opened
    const child = spawn(path, args, { cwd: dirname(path), env, detached: true, stdio: 'ignore', windowsHide: args[0] === 'serve' });
    child.on('error', () => {});
    child.unref();
  },

  installedApp() {
    const local = process.env.LOCALAPPDATA;
    const path = local ? join(local, 'Programs', 'Ollama', APP) : null;
    return path && existsSync(path) ? path : null;
  },
};
