// the headless smoke test: drives the real window, hidden, through a scripted session with the fake agent.
// started with --smoke=<folder>; every step leaves a screenshot there, and report.json says what passed

import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { app, nativeTheme, type BrowserWindow } from 'electron';

export function smokeFolder(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--smoke='));
  return arg ? resolve(arg.slice('--smoke='.length)) : (process.env.WRONTEND_SMOKE ?? null);
}

// what the smoke test needs set before the app is ready: its own data folder -- the user's sessions stay untouched --
// the fake agent, and an autoprompt in a throwaway project folder
export function prepareSmoke(): void {
  app.setPath('userData', realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-data-'))));
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-')));
  process.env.WRONTEND_HARNESS = 'fake';
  process.env.WRONTEND_AUTOPROMPT = `${project}|smoke-model|Please make the readme say what wrontend is.`;
}

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export async function runSmoke(win: BrowserWindow, out: string): Promise<void> {
  mkdirSync(out, { recursive: true });
  const steps: Step[] = [];
  // parts of a step this machine cannot exercise, said in the report rather than passed in silence
  const skipped: string[] = [];
  const consoleErrors: string[] = [];
  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') consoleErrors.push(event.message);
  });

  const js = <T = unknown>(code: string): Promise<T> => win.webContents.executeJavaScript(code, true) as Promise<T>;
  const waitFor = async (condition: string, timeoutMs = 15000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      if (await js<boolean>(`!!(${condition})`)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`timed out waiting for ${condition}`);
  };
  const shot = async (name: string) => {
    // a hidden window paints only when asked: force a frame, and let it land, before reading it back
    win.webContents.invalidate();
    await js(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await new Promise((r) => setTimeout(r, 150));
    const image = await win.webContents.capturePage();
    await writeFile(join(out, `${name}.png`), image.toPNG());
  };
  // sets the prompt box the way typing does, so React sees the change, then presses Enter
  const type = (text: string) =>
    js(`(() => {
      const box = document.querySelector('.prompt-box textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
  const step = async (name: string, run: () => Promise<void>) => {
    const started = Date.now();
    try {
      await run();
      steps.push({ name, ok: true, ms: Date.now() - started });
    } catch (cause) {
      steps.push({ name, ok: false, ms: Date.now() - started, error: (cause as Error).message });
      await shot(`${name}-failed`).catch(() => {});
    }
  };

  await step('01-session-starts', async () => {
    await waitFor(`document.querySelector('.session-row')`);
    await waitFor(`document.querySelector('.thought')`);
    await shot('01-session-starts');
  });
  await step('02-permission-docked', async () => {
    await waitFor(`document.querySelector('.permission .button.primary')`);
    await shot('02-permission-docked');
  });
  await step('03-allow-and-finish', async () => {
    await js(`document.querySelector('.permission .button.primary').click()`);
    await waitFor(`!document.querySelector('.permission') && !document.querySelector('.send.stop') && document.querySelector('.markdown code')`);
    await shot('03-allow-and-finish');
  });
  await step('04-tools-expanded', async () => {
    await js(`document.querySelectorAll('.tool-group > .tool-summary').forEach((b) => b.click())`);
    await waitFor(`document.querySelectorAll('.tool-head').length >= 2`);
    await js(`document.querySelectorAll('.tool-head').forEach((b) => b.click())`);
    await waitFor(`document.querySelector('.diff-line.add')`);
    await js(`document.querySelector('.diff')?.scrollIntoView({ block: 'center' })`);
    await shot('04-tools-expanded');
  });
  await step('05-running-then-stopped', async () => {
    await type('slow please');
    await waitFor(`document.querySelector('.send.stop')`);
    await new Promise((r) => setTimeout(r, 1500));
    await shot('05-running');
    await js(`document.querySelector('.send.stop').click()`);
    await waitFor(`!document.querySelector('.send.stop') && [...document.querySelectorAll('.notice')].some((n) => n.textContent === 'Stopped')`);
    await shot('05-stopped');
  });
  await step('06-error-shown', async () => {
    await type('now fail');
    await waitFor(`document.querySelector('.error-block')`);
    await js(`document.querySelector('.error-block .tool-summary')?.click()`);
    await shot('06-error-shown');
  });
  await step('07-quote-reply', async () => {
    // select the start of the assistant's answer, as a drag with the mouse would
    await js(`(() => {
      const p = document.querySelector('.transcript > .markdown p');
      const range = document.createRange();
      range.setStart(p.firstChild, 0);
      range.setEnd(p.firstChild, Math.min(30, p.firstChild.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('.quote-popover input')`);
    await shot('07-quote-popover');
    await js(`(() => {
      const input = document.querySelector('.quote-popover input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'this reads well');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await waitFor(`document.querySelector('.quote-card') && !document.querySelector('.quote-popover')`);
    await shot('07-quote-card');
    await type('echo it back');
    await waitFor(`!document.querySelector('.quote-card') && [...document.querySelectorAll('.user-message blockquote')].length > 0`);
    await waitFor(`[...document.querySelectorAll('.transcript > .markdown')].some((m) => m.textContent.includes('quoted 1 line'))`);
    await shot('07-quote-sent');
  });
  await step('07-mode-picker', async () => {
    const picker = `[...document.querySelectorAll('.under-row .picker')].find((b) => b.textContent.trim() === 'Default')`;
    await waitFor(`${picker}?.tagName === 'BUTTON'`);
    await js(`${picker}.click()`);
    await waitFor(`document.querySelector('.menu')`);
    await shot('07-mode-menu');
    await js(`[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Plan Mode')).click()`);
    await waitFor(`[...document.querySelectorAll('.under-row .picker')].some((b) => b.textContent.trim() === 'Plan Mode')`);
  });
  await step('07-light-theme', async () => {
    nativeTheme.themeSource = 'light';
    await new Promise((r) => setTimeout(r, 400));
    await js(`document.querySelector('.content').scrollTop = 0`);
    await shot('07-light-theme');
    nativeTheme.themeSource = 'system';
  });
  await step('07-restart-asks-first', async () => {
    const restartButton = `document.querySelector('.ollama-panel button')`;
    const openOllamaSettings = async () => {
      await js(`document.querySelector('.status button[aria-label="Settings"]').click()`);
      await waitFor(`document.querySelector('.settings-nav')`);
      await js(`[...document.querySelectorAll('.settings-nav .nav-item')].find((b) => b.textContent === 'Ollama').click()`);
      await waitFor(`${restartButton}`);
    };
    const escape = () => js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

    await type('slow while Ollama restarts');
    await waitFor(`document.querySelector('.send.stop')`);
    await openOllamaSettings();
    // only a running Ollama is restarted, so only then can there be anything to interrupt
    if ((await js<string>(`${restartButton}.textContent`)).includes('Restart Ollama')) {
      await js(`${restartButton}.click()`);
      await waitFor(`[...document.querySelectorAll('.confirm-items li')].some((li) => li.textContent.startsWith('Please make the readme'))`);
      await shot('07-restart-confirm');
      await escape();
      await waitFor(`!document.querySelector('.confirm')`);
      await new Promise((r) => setTimeout(r, 300));
      if (!(await js<boolean>(`!!document.querySelector('.settings')`))) throw new Error('Escape on the confirmation closed Settings too');
      if (await js<boolean>(`!!document.querySelector('.ollama-panel .setting-error')`)) throw new Error('declining the confirmation still restarted Ollama');
    } else {
      skipped.push('07-restart-asks-first: Ollama is not running, so a restart interrupts nothing and the dialog is not shown');
    }
    await escape();
    await waitFor(`!document.querySelector('.settings')`);
    await js(`document.querySelector('.send.stop').click()`);
    await waitFor(`!document.querySelector('.send.stop')`);

    // nothing working: the restart goes ahead unasked, into the smoke test's process control, which finds no Ollama to start
    await openOllamaSettings();
    await js(`${restartButton}.click()`);
    await waitFor(`document.querySelector('.ollama-panel .setting-error')?.textContent.includes('found no Ollama')`);
    if (await js<boolean>(`!!document.querySelector('.confirm')`)) throw new Error('the confirmation showed with nothing to interrupt');
    await escape();
    await waitFor(`!document.querySelector('.settings')`);
  });
  await step('08-reload-restores', async () => {
    const before = await js<number>(`document.querySelectorAll('.transcript > *').length`);
    win.webContents.reload();
    await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)));
    await waitFor(`document.querySelector('.session-row')`);
    await new Promise((r) => setTimeout(r, 500));
    const rows = await js<number>(`document.querySelectorAll('.session-row').length`);
    if (rows !== 1) throw new Error(`expected the one stored session after the reload, found ${rows}`);
    await js(`document.querySelector('.session-row').click()`);
    await waitFor(`document.querySelector('.transcript .user-message')`);
    const after = await js<number>(`document.querySelectorAll('.transcript > *').length`);
    const kept = await js<boolean>(`!!document.querySelector('.transcript .markdown code') && [...document.querySelectorAll('.notice')].some((n) => n.textContent === 'Stopped') && !!document.querySelector('.error-block')`);
    if (!kept) throw new Error('the restored transcript lost its answer, its Stopped line or its error');
    const mode = await js<boolean>(`[...document.querySelectorAll('.under-row .picker')].some((b) => b.textContent.trim() === 'Plan Mode')`);
    if (!mode) throw new Error('the restored session no longer shows the mode it was left in');
    // the tool group comes back collapsed, so fewer blocks are open than before
    if (after < 6) throw new Error(`the transcript had ${before} blocks before the reload and ${after} after`);
    await js(`document.querySelector('.content').scrollTop = 0`);
    await shot('08-reload-restores');
  });
  await step('09-delete-session', async () => {
    // the confirmation is answered yes: a hidden window cannot show a dialog
    await js(`window.confirm = () => true; true`);
    await js(`document.querySelector('.top-bar .picker').click()`);
    await waitFor(`document.querySelector('.top-bar .menu')`);
    await shot('09-session-menu');
    await js(`[...document.querySelectorAll('.top-bar .menu-item')].find((b) => b.textContent.includes('Delete Session')).click()`);
    await waitFor(`!document.querySelector('.session-row') && document.querySelector('.greeting')`);
    const left = await js<number>(`window.wrontend.invoke('session:stored').then((s) => s.length)`);
    if (left !== 0) throw new Error(`${left} sessions are still stored after deleting the only one`);
    await shot('09-new-session-screen');
  });
  // clicks a control in the Settings dialog by its row's label and the control's text or title
  const settingsClick = (label: string, control: string) =>
    js(`(() => {
      const row = [...document.querySelectorAll('.setting-row')].find((r) => r.querySelector('.setting-label')?.textContent === ${JSON.stringify(label)});
      const button = [...row.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(control)} || b.title === ${JSON.stringify(control)});
      button.click();
    })()`);
  await step('10-settings-general', async () => {
    await js(`document.querySelector('.status button[aria-label="Settings"]').click()`);
    await waitFor(`document.querySelector('.settings .setting-row')`);
    await settingsClick('Transcript width', 'Wide');
    await waitFor(`document.documentElement.dataset.width === 'wide'`);
    const stored = await js<string>(`window.wrontend.invoke('settings:get').then((s) => s.appearance.width)`);
    if (stored !== 'wide') throw new Error(`the width was not stored: ${stored}`);
    await shot('10-settings-general');
    await settingsClick('Theme', 'Light');
    await new Promise((r) => setTimeout(r, 400));
    if (nativeTheme.themeSource !== 'light') throw new Error(`the theme source is ${nativeTheme.themeSource}`);
    await shot('10-settings-light');
    await settingsClick('Theme', 'System');
  });
  await step('11-settings-ollama', async () => {
    await js(`[...document.querySelectorAll('.settings-nav .nav-item')].find((b) => b.textContent === 'Ollama').click()`);
    await waitFor(`document.querySelector('.ollama-panel') && [...document.querySelectorAll('.setting-label')].some((l) => l.textContent === 'KV cache type')`);
    if (await js<boolean>(`!!document.querySelector('.setting-pending')`)) throw new Error('a setting shows as pending before anything changed');
    await settingsClick('KV cache type', 'q8_0');
    await waitFor(`document.querySelector('.setting-pending')`);
    const context = await js<string>(`[...document.querySelectorAll('.setting-row')].find((r) => r.textContent.startsWith('Context length')).querySelector('.select').textContent`);
    if (!context.includes('64K')) throw new Error(`the stored context length shows as ${context}`);
    await shot('11-settings-ollama');
  });
  await step('12-settings-search-and-close', async () => {
    await js(`(() => {
      const input = document.querySelector('.settings-nav input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ollama');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await waitFor(`[...document.querySelectorAll('.setting-group h2')].some((h) => h.textContent.startsWith('Ollama'))`);
    await shot('12-settings-search');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.settings')`);
  });

  // main's stand-in npm fails the first install and lets the second one through
  const chip = `document.querySelector('.harness-chip')`;
  await step('13-harness-setup-fails', async () => {
    await waitFor(`${chip}?.textContent === 'Choose Harness'`);
    await js(`${chip}.click()`);
    await waitFor(`[...document.querySelectorAll('.menu-item')].some((b) => b.textContent.includes('Claude Code') && b.textContent.includes('Not set up'))`);
    await shot('13-harness-menu');
    await js(`[...document.querySelectorAll('.menu-item')].find((b) => b.textContent.includes('Claude Code')).click()`);
    await waitFor(`document.querySelector('.setup-failed') && ${chip}.textContent === 'Claude Code'`);
    await js(`document.querySelector('.setup-failed .tool-summary').click()`);
    await waitFor(`document.querySelector('.setup-failed pre')?.textContent.includes('E404')`);
    await shot('13-harness-setup-failed');
  });
  await step('14-harness-first-pick', async () => {
    await js(`[...document.querySelectorAll('.setup-failed button')].find((b) => b.textContent === 'Try Again').click()`);
    await waitFor(`!document.querySelector('.setup-failed') && ${chip}.textContent.includes('Setting up Claude Code') && / MB$/.test(${chip}.textContent)`);
    await shot('14-harness-installing');
    await waitFor(`${chip}.textContent === 'Claude Code'`, 30_000);
    const state = await js<{ status: string; version?: string }>(`window.wrontend.invoke('harness:list').then((l) => l.find((h) => h.id === 'claude-code').state)`);
    if (state.status !== 'installed' || state.version !== '0.89.1') throw new Error(`Claude Code is ${JSON.stringify(state)} after setting it up`);
    await js(`${chip}.click()`);
    await waitFor(`[...document.querySelectorAll('.menu-item')].some((b) => b.textContent.includes('Version 0.89.1'))`);
    await shot('14-harness-ready');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  });

  const passed = steps.every((s) => s.ok) && consoleErrors.length === 0;
  await writeFile(join(out, 'report.json'), JSON.stringify({ passed, steps, skipped, consoleErrors }, null, 2));
  console.log(`wrontend smoke: ${passed ? 'passed' : 'FAILED'} -- ${steps.filter((s) => s.ok).length}/${steps.length} steps, ${consoleErrors.length} console errors, report in ${out}`);
  app.exit(passed ? 0 : 1);
}
