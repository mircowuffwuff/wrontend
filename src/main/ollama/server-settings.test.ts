import { describe, expect, it } from 'vitest';
import { memoryEnvironment } from './environment';
import { launchEnv, OllamaServer, pickValues, type OllamaProcess, type ProcessControl } from './server-settings';

const WAITS = { stop: 200, start: 200, poll: 5 };

// a pretend machine: processes that stop when killed, and an Ollama that answers while any of them runs
function machine(running: OllamaProcess[], installed: string | null = 'C:\\Ollama\\ollama app.exe') {
  const state = { running: [...running], launched: [] as { path: string; args: string[]; env: NodeJS.ProcessEnv }[], killed: [] as number[] };
  const processes: ProcessControl = {
    list: async () => state.running,
    kill: async (pids) => {
      state.killed.push(...pids);
      state.running = state.running.filter((p) => !pids.includes(p.pid));
    },
    launch: (path, args, env) => {
      state.launched.push({ path, args, env });
      state.running.push({ pid: 99, name: 'ollama app.exe', path, command: null });
    },
    installedApp: () => installed,
  };
  return { state, processes, reachable: async () => state.running.some((p) => !p.command?.includes(' run ')) };
}

const app: OllamaProcess = { pid: 1, name: 'ollama app.exe', path: 'D:\\Apps\\Ollama\\ollama app.exe', command: '"ollama app.exe"' };
const server: OllamaProcess = { pid: 2, name: 'ollama.exe', path: 'D:\\Apps\\Ollama\\ollama.exe', command: '"ollama.exe" serve' };
const client: OllamaProcess = { pid: 3, name: 'ollama.exe', path: 'D:\\Apps\\Ollama\\ollama.exe', command: 'ollama run some-model' };

describe('Ollama server settings', () => {
  it('reads the user’s value over the machine’s, without regard to case', () => {
    const values = pickValues({ user: { ollama_keep_alive: '30m' }, machine: { OLLAMA_KEEP_ALIVE: '5m', OLLAMA_MODELS: 'D:\\models' } });
    expect(values.OLLAMA_KEEP_ALIVE).toBe('30m');
    expect(values.OLLAMA_MODELS).toBe('D:\\models');
    expect(values.OLLAMA_CONTEXT_LENGTH).toBeNull();
  });

  it('marks what changed since Ollama started as pending, and an empty value as unset', async () => {
    const env = memoryEnvironment({ user: { OLLAMA_KEEP_ALIVE: '30m' } });
    const m = machine([app, server]);
    const ollama = new OllamaServer({ environment: env, processes: m.processes, baseUrl: () => 'http://127.0.0.1:11434', reachable: m.reachable });
    expect((await ollama.state()).pending).toEqual([]);
    const state = await ollama.set({ OLLAMA_CONTEXT_LENGTH: '65536', OLLAMA_KEEP_ALIVE: ' ' });
    expect(env.user).toEqual({ OLLAMA_CONTEXT_LENGTH: '65536' });
    expect(state.pending.sort()).toEqual(['OLLAMA_CONTEXT_LENGTH', 'OLLAMA_KEEP_ALIVE']);
    // setting it back is no longer a change
    expect((await ollama.set({ OLLAMA_CONTEXT_LENGTH: null, OLLAMA_KEEP_ALIVE: '30m' })).pending).toEqual([]);
  });

  it('refuses a variable that is not one of the server settings', async () => {
    const m = machine([]);
    const ollama = new OllamaServer({ environment: memoryEnvironment(), processes: m.processes, baseUrl: () => 'http://127.0.0.1:11434', reachable: m.reachable });
    await expect(ollama.set({ PATH: 'x' } as never)).rejects.toThrow(/not one of/);
  });

  it('manages nothing for an Ollama on another machine', async () => {
    const m = machine([]);
    const ollama = new OllamaServer({ environment: memoryEnvironment(), processes: m.processes, baseUrl: () => 'http://192.168.1.20:11434', reachable: m.reachable });
    expect((await ollama.state()).unsupported).toMatch(/192\.168\.1\.20/);
    await expect(ollama.restart()).rejects.toThrow();
  });

  it('restarts the tray app with the stored values, leaving a client alone, and clears pending', async () => {
    const env = memoryEnvironment({ user: { OLLAMA_MODELS: 'Y:\\models' } });
    const m = machine([app, server, client]);
    const ollama = new OllamaServer({ environment: env, processes: m.processes, baseUrl: () => 'http://127.0.0.1:11434', reachable: m.reachable, waitMs: WAITS });
    await ollama.set({ OLLAMA_KEEP_ALIVE: '1h' });
    await ollama.restart();
    expect(m.state.killed).toEqual([1, 2]);
    expect(m.state.launched).toHaveLength(1);
    expect(m.state.launched[0]).toMatchObject({ path: app.path, args: ['--hide'] });
    expect(m.state.launched[0].env.OLLAMA_KEEP_ALIVE).toBe('1h');
    expect(m.state.launched[0].env.OLLAMA_MODELS).toBe('Y:\\models');
    expect((await ollama.state()).pending).toEqual([]);
  });

  it('restarts a plain server as a plain server', async () => {
    const m = machine([server]);
    const ollama = new OllamaServer({ environment: memoryEnvironment(), processes: m.processes, baseUrl: () => 'http://localhost:11434', reachable: m.reachable, waitMs: WAITS });
    await ollama.restart();
    expect(m.state.launched[0]).toMatchObject({ path: server.path, args: ['serve'] });
  });

  it('starts the installed app when no Ollama runs, and says so when none is installed', async () => {
    const m = machine([]);
    const ollama = new OllamaServer({ environment: memoryEnvironment(), processes: m.processes, baseUrl: () => 'http://127.0.0.1:11434', reachable: m.reachable, waitMs: WAITS });
    await ollama.restart();
    expect(m.state.killed).toEqual([]);
    expect(m.state.launched[0].path).toBe('C:\\Ollama\\ollama app.exe');

    const none = machine([], null);
    const missing = new OllamaServer({ environment: memoryEnvironment(), processes: none.processes, baseUrl: () => 'http://127.0.0.1:11434', reachable: none.reachable, waitMs: WAITS });
    await expect(missing.restart()).rejects.toThrow(/found no Ollama/);
  });

  it('launches without the OLLAMA_ variables wrontend itself was started with', () => {
    const env = launchEnv({ PATH: 'x', OLLAMA_CONTEXT_LENGTH: '4096', Ollama_Host: '0.0.0.0', ELECTRON_RUN_AS_NODE: '1' }, { user: { OLLAMA_MODELS: 'Y:\\m' }, machine: {} });
    expect(env).toEqual({ PATH: 'x', OLLAMA_MODELS: 'Y:\\m' });
  });
});
