// the smoke test: drives the real app, its window hidden, through a scripted session with the fake agent and through every
// part of the main process a UI reaches -- all of it over the same IPC door a UI uses, from inside the page. started with
// --smoke=<folder>; report.json there says what passed

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { app, nativeTheme, type BrowserWindow } from 'electron';
import type { HarnessEntry } from '@shared/components';
import { countHunks, diffRows } from '@shared/diffs';
import { pullSize, type PullEntry, type RepoDetails, type RepoSummary } from '@shared/models';
import type { ModelEntry, OllamaStatus, RestartImpact } from '@shared/ollama';
import { applySessionChange, contextUse, type SessionChange, type SessionDefaults, type SessionState, type TranscriptItem } from '@shared/session';
import type { OllamaServerState } from '@shared/settings';
import type { UpdatesState } from '@shared/updates';
import type { UsageSummary } from '@shared/usage';
import type { ProxyServer } from './proxy/server';
import { AgentHost } from './host/agent-host';
import { SessionStates } from './host/session-states';

const TITLE = 'Please make the readme say what wrontend is.';

export function smokeFolder(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--smoke='));
  return arg ? resolve(arg.slice('--smoke='.length)) : (process.env.WRONTEND_SMOKE ?? null);
}

// what the smoke test needs set before the app is ready: its own data folder -- the user's sessions stay untouched --
// the fake agent, and an autoprompt in a throwaway project folder. both folders go when the app exits
export function prepareSmoke(): void {
  const data = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-data-')));
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-')));
  removeAfterExit([data, project]);
  app.setPath('userData', data);
  process.env.WRONTEND_HARNESS = 'fake';
  process.env.WRONTEND_AUTOPROMPT = `${project}|smoke-model|${TITLE}`;
}

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

// what a page keeps of the main process's events, from the moment the smoke test subscribes it
interface Heard {
  sessions: SessionChange[];
  defaults: SessionDefaults[];
  harnesses: HarnessEntry[];
  updates: UpdatesState[];
}

export async function runSmoke(win: BrowserWindow, out: string, o: { states: SessionStates; stopHarnesses: () => void }): Promise<void> {
  mkdirSync(out, { recursive: true });
  const steps: Step[] = [];
  // parts of a step this machine cannot exercise, said in the report rather than passed in silence
  const skipped: string[] = [];
  const consoleErrors: string[] = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  // a channel called as a UI calls it, through the preload's bridge
  const invoke = <T = unknown>(channel: string, ...args: unknown[]): Promise<T> =>
    js<T>(`window.wrontend.invoke(${[channel, ...args].map((a) => JSON.stringify(a ?? null)).join(', ')})`);
  // the message a refused call rejects with, as a UI receives it
  const refusal = (channel: string, ...args: unknown[]): Promise<string | null> =>
    js<string | null>(`window.wrontend.invoke(${[channel, ...args].map((a) => JSON.stringify(a ?? null)).join(', ')}).then(() => null, (e) => e.message)`);
  const heard = () => js<Heard>('window.heard');
  const until = async (what: string, check: () => Promise<boolean>, timeoutMs = 15_000) => {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  const step = async (name: string, run: () => Promise<void>) => {
    const started = Date.now();
    try {
      await run();
      steps.push({ name, ok: true, ms: Date.now() - started });
    } catch (cause) {
      steps.push({ name, ok: false, ms: Date.now() - started, error: (cause as Error).message });
    }
  };

  // the page listens before it reads the list, as a mirror must: a change that arrives in between is applied on top of the
  // list, and applying one twice changes nothing
  await js(`(() => {
    window.heard = { sessions: [], defaults: [], harnesses: [], updates: [] };
    window.wrontend.on('session:changed', (c) => window.heard.sessions.push(c));
    window.wrontend.on('session:defaults-changed', (d) => window.heard.defaults.push(d));
    window.wrontend.on('harness:changed', (h) => window.heard.harnesses.push(h));
    window.wrontend.on('updates:changed', (u) => window.heard.updates.push(u));
  })()`);
  const listed = await invoke<SessionState[]>('session:list');

  let id = '';
  const list = () => invoke<SessionState[]>('session:list');
  const state = async (of = id) => (await list()).find((s) => s.info.id === of) ?? fail('no session', of);
  const last = async () => (await state()).items.at(-1);
  const ended = (what: string) => until(what, async () => (await state()).turnStartedAt === null);
  const text = (items: TranscriptItem[], kind: 'assistant' | 'user') => items.filter((i) => i.kind === kind).map((i) => (i.kind === kind ? i.text : ''));

  await step('01-session-starts', async () => {
    await until('the autoprompt session', async () => (await list()).length === 1);
    id = (await list())[0].info.id;
    await until('its thinking', async () => (await state()).items.some((i) => i.kind === 'thought'));
    const s = await state();
    if (s.info.title !== TITLE || s.info.harness !== 'fake' || s.turnStartedAt === null) fail('the new session', s.info);
    if (s.modes?.available.map((m) => m.id).join() !== 'default,plan') fail('its modes', s.modes);
  });
  await step('02-permission', async () => {
    await until('a permission request', async () => (await state()).permissions.length === 1);
    const request = (await state()).permissions[0];
    const allow = request.options.find((o) => o.kind === 'allow_once') ?? fail('no allow_once option', request.options);
    await invoke('session:answer', id, request.requestId, allow.optionId);
    await until('the request to close', async () => (await state()).permissions.length === 0);
  });
  await step('03-turn-ends', async () => {
    await ended('the first turn');
    const s = await state();
    const kinds = s.items.map((i) => i.kind).join();
    if (kinds !== 'user,thought,plan,tool,tool,assistant,edits') fail('the transcript', kinds);
    const plan = s.items.find((i) => i.kind === 'plan');
    if (plan?.kind !== 'plan' || plan.entries.some((e) => e.status !== 'completed')) fail('the plan', plan);
    const thought = s.items.find((i) => i.kind === 'thought');
    if (thought?.kind !== 'thought' || thought.endedAt === null) fail('the thought did not end', thought);
    if (!text(s.items, 'assistant')[0].includes('```ts')) fail('the answer', text(s.items, 'assistant'));
    // the readme the fake agent edits is not on disk, so its diff is the edit's own
    const edits = s.items.at(-1);
    if (edits?.kind !== 'edits' || edits.files.length !== 1 || edits.files[0].path !== 'readme.md' || edits.files[0].whole) fail('the edited files', edits);
    const used = contextUse(s, []);
    if (used.used !== 21000 || used.size !== 65536) fail('the context', used);
  });
  // five files with a failed edit left out, the file edited three times as one diff from before the turn with its real
  // line numbers
  await step('04-edited-files', async () => {
    // a prompt is in the transcript and its turn running by the time the call returns, so a turn's end is simply waited for
    await invoke('session:prompt', id, 'edit several files');
    await ended('the edits');
    const edits = await last();
    if (edits?.kind !== 'edits') fail('the turn ended in', edits);
    const names = edits.files.map((f) => basename(f.path)).join();
    if (names !== 'app.ts,view.ts,usage.md,log.ts,package.json') fail('the files', names);
    const counts = countHunks(edits.files.flatMap((f) => f.hunks));
    if (counts.added !== 10 || counts.removed !== 5) fail('the line counts', counts);
    const app = edits.files[0];
    const rows = diffRows(app.hunks);
    const folds = rows.filter((r) => r.type === 'fold');
    const firstRemoved = rows.find((r) => r.type === 'remove');
    if (!app.whole || folds.length !== 1 || folds[0].lines !== 5 || firstRemoved?.type !== 'remove' || firstRemoved.no !== 4) fail('app.ts', { whole: app.whole, rows });
  });
  await step('05-stopped', async () => {
    await invoke('session:prompt', id, 'slow please');
    await until('the slow thinking', async () => (await state()).items.at(-1)?.kind === 'thought');
    if ((await refusal('session:prompt', id, 'and another')) !== 'A turn is already running in this session.') fail('a second prompt mid-turn', 'was taken');
    await invoke('session:cancel', id);
    await ended('the stop');
    const notice = await last();
    if (notice?.kind !== 'notice' || notice.text !== 'Stopped') fail('the turn ended in', notice);
  });
  await step('06-error', async () => {
    await invoke('session:prompt', id, 'now fail');
    await ended('the failure');
    const error = await last();
    if (error?.kind !== 'error' || !error.detail.includes('failed on purpose')) fail('the turn ended in', error);
  });
  await step('07-quote', async () => {
    const answer = text((await state()).items, 'assistant')[0];
    await invoke('session:prompt', id, 'echo it back', [{ quote: answer.slice(0, 30), reply: 'this reads well' }]);
    await ended('the echo');
    const s = await state();
    const sent = text(s.items, 'user').at(-1)!;
    if (sent !== `> ${answer.slice(0, 30).trim()}\n\nthis reads well\n\necho it back`) fail('the prompt sent', sent);
    if (!text(s.items, 'assistant').at(-1)!.includes('quoted 1 line')) fail('the answer', text(s.items, 'assistant').at(-1));
  });
  await step('07-mode', async () => {
    await invoke('session:set-mode', id, 'plan');
    const s = await state();
    if (s.modes?.current !== 'plan' || s.info.mode !== 'plan') fail('the mode', { modes: s.modes, info: s.info });
  });
  // the fake agent's commands arrive just after the session is created; a prompt starting with one runs it
  await step('07-slash-commands', async () => {
    const s = await state();
    if (s.commands.map((c) => c.name).join() !== 'compact,context,init,review,mcp') fail('the commands', s.commands);
    await invoke('session:prompt', id, '/review main');
    await ended('the command');
    const answer = text((await state()).items, 'assistant').at(-1);
    if (!answer?.includes('Ran /review with “main”')) fail('the answer', answer);
  });
  await step('07-restart', async () => {
    await invoke('session:prompt', id, 'slow while Ollama restarts');
    await until('the turn to start', async () => (await state()).turnStartedAt !== null);
    const status = await invoke<OllamaStatus>('ollama:status');
    const impact = await invoke<RestartImpact>('ollama:restart-impact');
    if (status.reachable) {
      if (impact.sessions.map((s) => s.id).join() !== id) fail('what a restart cuts off', impact);
    } else {
      if (impact.sessions.length) fail('what a restart of an Ollama not running cuts off', impact);
      skipped.push('07-restart: Ollama is not running, so a restart cuts off nothing');
    }
    await invoke('session:cancel', id);
    await ended('the stop');
    // the smoke test's process control finds no Ollama to start, so the restart fails -- having stopped nothing
    const server = await invoke<OllamaServerState>('ollama:server');
    const refused = await refusal('ollama:restart');
    if (server.unsupported) skipped.push(`07-restart: ${server.unsupported}`);
    else if (!refused?.startsWith('wrontend found no Ollama to start')) fail('the restart', refused);
  });
  // what is on disk is what a later launch reads back: the host and the states rebuilt from it alone
  await step('08-stored', async () => {
    const reread = new SessionStates(
      new AgentHost(
        {} as ProxyServer,
        app.getPath('userData'),
        () => null,
        () => {},
      ),
      () => {},
    );
    const s = reread.list()[0];
    const live = await state();
    if (JSON.stringify(s.items) !== JSON.stringify(live.items))
      fail(
        'the stored transcript',
        s.items.map((i) => i.kind),
      );
    if (s.info.mode !== 'plan' || s.modes?.current !== 'plan' || s.commands.length !== 5 || s.turnStartedAt !== null) fail('the stored session', s);
  });
  await step('09-rename-and-delete', async () => {
    await invoke('session:rename', id, 'Smoke session renamed');
    if ((await state()).info.title !== 'Smoke session renamed') fail('the title', (await state()).info.title);
    await invoke('session:rename', id, '   ');
    if ((await state()).info.title !== 'Smoke session renamed') fail('an empty rename changed the title', (await state()).info.title);
    await invoke('session:delete', id);
    if ((await list()).length !== 0) fail('sessions left after deleting the only one', await list());
    // the usage log outlives its session
    const usage = await invoke<UsageSummary>('stats:summary');
    if (usage.ranges.all.sessions !== 1 || usage.ranges.all.messages === 0) fail('the usage', usage.ranges.all);
  });
  await step('10-settings', async () => {
    await invoke('settings:set', { appearance: { theme: 'light' } });
    if (nativeTheme.themeSource !== 'light') fail('the theme source', nativeTheme.themeSource);
    await invoke('settings:set', { appearance: { theme: 'system' } });
    // the preload passes the handler's own message on
    const refused = await refusal('settings:set', { ollama: { address: 'not an address:::' } });
    if (refused !== '“not an address:::” is not an address Ollama could be reached at.') fail('a bad address', refused);
  });
  await step('11-ollama-server', async () => {
    const before = await invoke<OllamaServerState>('ollama:server');
    if (before.values.OLLAMA_CONTEXT_LENGTH !== '65536' || before.pending.length) fail('the stored server settings', before);
    const after = await invoke<OllamaServerState>('ollama:set-server', { OLLAMA_KV_CACHE_TYPE: 'q8_0' });
    if (after.pending.join() !== 'OLLAMA_KV_CACHE_TYPE') fail('the pending settings', after);
  });
  // the autoprompt is no pick of the user's, so nothing is remembered yet
  await step('12-defaults', async () => {
    const value = await invoke<SessionDefaults>('session:defaults');
    if (value.harness !== null || value.model !== null || value.effort !== 'on') fail('the defaults before any pick', value);
    await invoke('session:set-defaults', { effort: 'off' });
    await until('the change to be heard', async () => (await heard()).defaults.at(-1)?.effort === 'off');
    await invoke('session:set-defaults', { effort: 'on' });
  });

  // the stand-in npm fails the first install and lets the second one through. picking a harness that is not set up sets it up
  const claude = async () => (await invoke<HarnessEntry[]>('harness:list')).find((h) => h.id === 'claude-code') ?? fail('no Claude Code', null);
  await step('13-harness-setup-fails', async () => {
    if ((await claude()).state.status !== 'missing') fail('Claude Code before its first pick', (await claude()).state);
    await invoke('session:set-defaults', { harness: 'claude-code' });
    await until('the setup to fail', async () => (await claude()).state.status === 'failed');
    const state = (await claude()).state;
    if (state.status !== 'failed' || !state.detail.includes('E404')) fail('the failure', state);
  });
  await step('14-harness-set-up', async () => {
    await invoke('harness:install', 'claude-code');
    await until('the setup', async () => (await claude()).state.status === 'installed', 30_000);
    const state = (await claude()).state;
    if (state.status !== 'installed' || state.version !== '0.89.1') fail('Claude Code after its setup', state);
    if (!(await heard()).harnesses.some((h) => h.state.status === 'installing' && h.state.bytes >= 1e6))
      fail(
        'no progress was heard',
        (await heard()).harnesses.map((h) => h.state),
      );
  });
  await step('15-model-delete', async () => {
    const models = await invoke<ModelEntry[]>('ollama:models');
    if (models.length === 0) {
      skipped.push('15-model-delete: Ollama has no models, or is not running, so there is none to delete');
      return;
    }
    const refused = await refusal('ollama:delete', models[0].name);
    if (refused !== 'This run deletes nothing from Ollama.') fail('the delete', refused);
    if ((await invoke<ModelEntry[]>('ollama:models')).length !== models.length) fail('a model went missing', models[0].name);
  });
  // Hugging Face is answered from memory, the machine is a fixed 16 GB card, and a download stops halfway and fails
  await step('16-models', async () => {
    if ((await invoke<RepoSummary[]>('models:search', '')).length !== 3) fail('the most downloaded', await invoke('models:search', ''));
    if ((await invoke<RepoSummary[]>('models:search', 'gemma')).length !== 1) fail('the search', await invoke('models:search', 'gemma'));
    const repo = await invoke<RepoDetails>('models:repo', 'smoke-test/Qwen3.8-27B-GGUF');
    const quants = repo.quants.map((q) => `${q.tag} ${q.fit}`);
    if (quants.length !== 9 || quants[0] !== 'UD-IQ2_XXS gpu' || quants.at(-1) !== 'BF16 too-large' || repo.recommended !== 'UD-IQ3_S')
      fail('the quants', { quants, recommended: repo.recommended });
    const quant = repo.quants.find((q) => q.tag === 'UD-IQ3_S')!;
    const pull = async () => (await invoke<PullEntry[]>('models:pulls')).find((p) => p.name === quant.name)?.state;
    await invoke('models:pull', quant.name);
    await until('the download', async () => (await pull())?.status === 'installing' && ((await pull()) as { bytes: number }).bytes > 0);
    const progress = await pull();
    if (progress?.status !== 'installing' || pullSize(progress, quant, repo.projectorBytes) !== quant.sizeBytes + repo.projectorBytes) fail('the download size', progress);
    await invoke('models:cancel-pull', quant.name);
    await until('the cancel', async () => (await pull()) === undefined);
    await invoke('models:pull', quant.name);
    await until('the download', async () => (await pull())?.status === 'installing');
    const impact = await invoke<RestartImpact>('ollama:restart-impact');
    if ((await invoke<OllamaStatus>('ollama:status')).reachable && impact.downloads.join() !== quant.name) fail('what a restart cuts off', impact);
    await until('the failure', async () => (await pull())?.status === 'failed', 10_000);
    const failed = await pull();
    if (failed?.status !== 'failed' || !failed.error.includes('could not download')) fail('the failed download', failed);
  });

  // the stand-in registry publishes Claude Code 0.90.0 once 0.89.1 is set up, the stand-in Ollama has a model with a newer upload,
  // and an Ollama update waits: the updater offers all three
  const updates = () => invoke<UpdatesState>('updates:state');
  const entry = async (entryId: string) => (await updates()).entries.find((e) => e.id === entryId);
  const model = 'model:hf.co/smoke-test/Qwen3.8-27B-GGUF:UD-Q4_K_M';
  await step('17-updater', async () => {
    await invoke('updates:check');
    await until('the three updates', async () => (await updates()).entries.length === 3);
    const found = (await updates()).entries.map((e) => `${e.group} ${e.current} ${e.available}`);
    if (!found[0].startsWith('harnesses 0.89.1 0.90.0') || !found[1].startsWith('ollama 0.40.3 0.40.4') || !found[2].startsWith('models ')) fail('the updates', found);
    await invoke('updates:pin', 'claude-code', true);
    if (!(await entry('claude-code'))?.pinned) fail('the pin', await entry('claude-code'));
    await invoke('updates:pin', 'claude-code', false);
    await invoke('updates:install', 'claude-code');
    await until('the update', async () => (await entry('claude-code')) === undefined, 20_000);
    if (!(await heard()).updates.some((u) => u.entries.some((e) => e.id === 'claude-code' && e.state?.status === 'installing'))) fail('no progress was heard', 'claude-code');
    const state = (await claude()).state;
    if (state.status !== 'installed' || state.version !== '0.90.0') fail('Claude Code after its update', state);
  });
  // the model's pull stops halfway and fails: the failure stays on its entry, and skipping the upload takes it away
  await step('18-updater-model', async () => {
    if ((await entry(model))?.bytes !== 12e9) fail("the model's update", await entry(model));
    await invoke('updates:install', model);
    await until('the failure', async () => (await entry(model))?.state?.status === 'failed', 10_000);
    await invoke('updates:skip', model);
    if (await entry(model)) fail('the skipped update', await entry(model));
  });
  // Ollama's update is a restart, which the stand-in makes in a moment; then nothing is out of date
  await step('19-updater-ollama', async () => {
    await invoke('updates:install', 'ollama');
    await until('the restart', async () => (await updates()).entries.length === 0, 10_000);
  });

  await step('20-sessions-in-folders', async () => {
    const folders = [0, 1].map(() => realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-'))));
    removeAfterExit(folders);
    const made: SessionState[] = [];
    for (const folder of folders) made.push(await invoke<SessionState>('session:create', { harness: 'fake', folder, model: 'smoke-model', effort: 'on' }));
    const all = await list();
    if (all.length !== 2 || all[0].info.id !== made[1].info.id || new Set(all.map((s) => s.info.folderId)).size !== 2)
      fail(
        'the sessions',
        all.map((s) => s.info),
      );
    // a session created is the user's pick, which the next one starts with
    const value = await invoke<SessionDefaults>('session:defaults');
    if (value.harness !== 'fake' || value.model !== 'smoke-model' || value.effort !== 'on') fail('the defaults after a session', value);
    await invoke('session:delete', made[0].info.id);
    if ((await list()).map((s) => s.info.id).join() !== made[1].info.id) fail('the session left', await list());
  });
  // everything heard, applied to the list read at the start, is the list now. a change reaches the page a moment after the
  // main process sends it -- the page's events and executeJavaScript travel apart -- so the mirror is given that moment to
  // catch up
  await step('21-mirror', async () => {
    const differing = async () => {
      const now = await list();
      const mirror = (await heard()).sessions.reduce(applySessionChange, listed);
      if (mirror.map((s) => s.info.id).join() !== now.map((s) => s.info.id).join()) return { mirror: mirror.map((s) => s.info.id), now: now.map((s) => s.info.id) };
      const fields = now.flatMap((s, i) =>
        (Object.keys(s) as (keyof SessionState)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(mirror[i][k])).map((k) => `${s.info.id} ${k}`),
      );
      return fields.length ? fields : null;
    };
    await until('the mirror to catch up', async () => (await differing()) === null, 5_000).catch(async () => fail('the mirror differs', await differing()));
    if ((await heard()).sessions.length < 50) fail('too few changes were heard', (await heard()).sessions.length);
  });

  const passed = steps.every((s) => s.ok) && consoleErrors.length === 0;
  await writeFile(join(out, 'report.json'), JSON.stringify({ passed, steps, skipped, consoleErrors }, null, 2));
  console.log(
    `wrontend smoke: ${passed ? 'passed' : 'FAILED'} -- ${steps.filter((s) => s.ok).length}/${steps.length} steps, ${consoleErrors.length} console errors, report in ${out}`,
  );
  // app.exit skips will-quit, where the harnesses are stopped otherwise; one left running would keep the project folder
  o.stopHarnesses();
  app.exit(passed ? 0 : 1);
}

function fail(what: string, value: unknown): never {
  throw new Error(`${what}: ${JSON.stringify(value)}`);
}

// Electron keeps files open in its data folder for as long as it runs -- its caches, local storage, cookies -- and on
// Windows an open file cannot be deleted, so the app cannot remove that folder itself. a small process left behind waits
// for the app to exit, however it exits, and removes the folders then. the processes Electron and the harnesses start can
// outlast the app by a moment, so the removal retries; a folder that still will not go stays where it is
function removeAfterExit(folders: string[]): void {
  const script = `
    const { rmSync } = require('node:fs');
    const [pid, ...folders] = process.argv.slice(1);
    const running = () => { try { process.kill(Number(pid), 0); return true; } catch { return false; } };
    const remove = () => {
      for (const folder of folders) try { rmSync(folder, { recursive: true, force: true, maxRetries: 10 }); } catch {}
    };
    const wait = () => (running() ? setTimeout(wait, 250) : remove());
    wait();
  `;
  spawn(process.execPath, ['-e', script, String(process.pid), ...folders], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  }).unref();
}
