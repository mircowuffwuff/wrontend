// the headless smoke test: drives the real window, hidden, through a scripted session with the fake agent.
// started with --smoke=<folder>; every step leaves a screenshot there, and report.json says what passed

import { spawn } from 'node:child_process';
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
// the fake agent, and an autoprompt in a throwaway project folder. both folders go when the app exits
export function prepareSmoke(): void {
  const data = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-data-')));
  const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-')));
  removeAfterExit([data, project]);
  app.setPath('userData', data);
  process.env.WRONTEND_HARNESS = 'fake';
  process.env.WRONTEND_AUTOPROMPT = `${project}|smoke-model|Please make the readme say what wrontend is.`;
}

interface Step {
  name: string;
  ok: boolean;
  ms: number;
  error?: string;
}

export async function runSmoke(win: BrowserWindow, out: string, stopHarnesses: () => void): Promise<void> {
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
  await step('15-model-trash', async () => {
    const models = await js<{ name: string }[]>(`window.wrontend.invoke('ollama:models')`);
    if (models.length === 0) {
      skipped.push('15-model-trash: Ollama has no models, or is not running, so the picker has no row to delete');
      return;
    }
    const openPicker = async () => {
      await js(`document.querySelector('.model-trigger').closest('button').click()`);
      await waitFor(`document.querySelector('.menu .menu-row .menu-action')`);
    };
    await openPicker();
    // the trash button shows while its row is pointed at: a real mouse move, since a scripted one sets no :hover
    const at = await js<{ x: number; y: number }>(`(() => {
      const r = document.querySelector('.menu .menu-row').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
    await waitFor(`getComputedStyle(document.querySelector('.menu .menu-action')).opacity === '1'`);
    await shot('15-model-menu');

    await js(`document.querySelector('.menu .menu-action').click()`);
    await waitFor(`document.querySelector('.confirm')?.textContent.includes(${JSON.stringify(models[0].name)})`);
    await shot('15-model-confirm');
    await js(`[...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Cancel').click()`);
    await waitFor(`!document.querySelector('.confirm')`);
    if (await js<boolean>(`!!document.querySelector('.setup-failed')`)) throw new Error('declining the confirmation still tried to delete');

    // this run deletes nothing from the user's Ollama: going ahead shows the refusal as a failed delete
    await openPicker();
    await js(`document.querySelector('.menu .menu-action').click()`);
    await waitFor(`document.querySelector('.confirm')`);
    await js(`[...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Delete Model').click()`);
    await waitFor(`document.querySelector('.setup-failed')?.textContent.includes('This run deletes nothing from Ollama.')`);
    await shot('15-model-delete-failed');
    const after = await js<{ name: string }[]>(`window.wrontend.invoke('ollama:models')`);
    if (after.length !== models.length) throw new Error('a model went missing in a run that deletes nothing');
    await js(`document.querySelector('.setup-failed button[aria-label="Dismiss"]').click()`);
    await waitFor(`!document.querySelector('.setup-failed')`);
  });
  // the browser reads a Hugging Face in memory, measures a fixed 16 GB card, and its downloads stop halfway and fail
  await step('16-model-browser', async () => {
    const button = (text: string) => `[...document.querySelectorAll('.browser button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
    const search = (text: string) =>
      js(`(() => {
        const box = document.querySelector('.browser .search input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(box, ${JSON.stringify(text)});
        box.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);

    await js(`document.querySelector('.model-trigger').closest('button').click()`);
    await waitFor(`document.querySelector('.menu .menu-footer')`);
    await js(`document.querySelector('.menu .menu-footer').click()`);
    await waitFor(`document.querySelectorAll('.browser .repo-row').length === 3`);
    await shot('16-browser-start');
    await search('gemma');
    await waitFor(`document.querySelectorAll('.browser .repo-row').length === 1`);
    await search('');
    await waitFor(`document.querySelectorAll('.browser .repo-row').length === 3`);

    await js(`[...document.querySelectorAll('.browser .repo-row')].find((b) => b.textContent.includes('Qwen3.8-27B-GGUF')).click()`);
    await waitFor(`document.querySelector('.quant-row.picked')?.textContent.includes('UD-IQ3_SRecommended')`);
    const rows = await js<string[]>(`[...document.querySelectorAll('.quant-row')].map((r) => r.querySelector('.quant-tag').textContent + ' ' + (r.querySelector('.fit')?.textContent ?? ''))`);
    if (rows[0] !== 'UD-IQ2_XXS Fits on GPU' || rows.at(-1) !== 'BF16 Too large' || rows.length !== 9) throw new Error(`the quants read ${JSON.stringify(rows)}`);
    await shot('16-browser-repo');

    await js(`${button('Download')}.click()`);
    await waitFor(`document.querySelector('.pull-bar .progress') && /Downloading UD-IQ3_S · [1-9]/.test(document.querySelector('.pull-bar').textContent)`);
    await shot('16-browser-downloading');
    await js(`${button('Cancel')}.click()`);
    await waitFor(`!document.querySelector('.pull-bar .progress') && ${button('Download')}`);

    // a download is something a restart of Ollama cuts off, so the restart asks first
    await js(`${button('Download')}.click()`);
    await waitFor(`document.querySelector('.pull-bar .progress')`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.browser')`);
    await js(`document.querySelector('.status button[aria-label="Settings"]').click()`);
    await waitFor(`document.querySelector('.settings-nav')`);
    await js(`[...document.querySelectorAll('.settings-nav .nav-item')].find((b) => b.textContent === 'Ollama').click()`);
    await waitFor(`document.querySelector('.ollama-panel button')`);
    if ((await js<string>(`document.querySelector('.ollama-panel button').textContent`)).includes('Restart Ollama')) {
      await js(`document.querySelector('.ollama-panel button').click()`);
      await waitFor(`[...document.querySelectorAll('.confirm-items li')].some((li) => li.textContent === 'Downloading hf.co/smoke-test/Qwen3.8-27B-GGUF:UD-IQ3_S')`);
      await shot('16-restart-confirm-download');
      await js(`[...document.querySelectorAll('.confirm button')].find((b) => b.textContent === 'Cancel').click()`);
      await waitFor(`!document.querySelector('.confirm')`);
    } else {
      skipped.push('16-model-browser: Ollama is not running, so a restart interrupts no download and the dialog is not shown');
    }
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.settings')`);

    // the download outlives the browser: opened again, it is still under way, then fails
    await js(`document.querySelector('.model-trigger').closest('button').click()`);
    await waitFor(`document.querySelector('.menu .menu-footer')`);
    await js(`document.querySelector('.menu .menu-footer').click()`);
    await waitFor(`document.querySelectorAll('.browser .repo-row').length === 3`);
    await js(`[...document.querySelectorAll('.browser .repo-row')].find((b) => b.textContent.includes('Qwen3.8-27B-GGUF')).click()`);
    await waitFor(`document.querySelector('.pull-bar.failed')?.textContent.includes('could not download')`, 10_000);
    await js(`document.querySelector('.pull-bar.failed .tool-summary').click()`);
    await shot('16-browser-failed');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.browser')`);
  });

  // the stand-in registry publishes Claude Code 0.90.0 once 0.89.1 is set up, the stand-in Ollama has a model with a newer upload,
  // and an Ollama update waits: the updater offers all three, pins one and installs it
  const icon = `document.querySelector('.status button[aria-label="Updates"]')`;
  const rowOf = (name: string) => `[...document.querySelectorAll('.update-row')].find((r) => r.querySelector('.update-name').textContent.startsWith(${JSON.stringify(name)}))`;
  const pickFrom = async (row: string, item: string) => {
    const entry = `[...document.querySelectorAll('.update-row .menu-item')].find((b) => b.textContent.startsWith(${JSON.stringify(item)}))`;
    await js(`${row}.querySelector('button[title="More"]').click()`);
    await waitFor(entry);
    await js(`${entry}.click()`);
  };
  const claude = rowOf('Claude Code');
  const model = rowOf('hf.co/smoke-test/');
  await step('17-updater', async () => {
    await js(`window.wrontend.invoke('updates:check')`);
    await waitFor(`${icon}.classList.contains('attention')`);
    await js(`${icon}.click()`);
    await waitFor(`${claude}?.textContent.includes('0.89.1 → 0.90.0') && ${model} && ${rowOf('Ollama')}`);
    const groups = await js<string[]>(`[...document.querySelectorAll('.update-group .settings-area-label')].map((l) => l.textContent)`);
    if (groups.join() !== 'Harnesses,Ollama,Models') throw new Error(`the groups read ${JSON.stringify(groups)}`);
    await shot('17-updater');

    await js(`${claude}.querySelector('button[title="More"]').click()`);
    await waitFor(`document.querySelector('.update-row .menu')`);
    await shot('17-updater-menu');
    await js(`[...document.querySelectorAll('.update-row .menu-item')].find((b) => b.textContent.startsWith('Pin')).click()`);
    await waitFor(`${claude}.classList.contains('pinned') && ![...${claude}.querySelectorAll('button')].some((b) => b.textContent === 'Update')`);
    await shot('17-updater-pinned');
    await pickFrom(claude, 'Unpin');
    await waitFor(`!${claude}.classList.contains('pinned')`);

    await js(`[...${claude}.querySelectorAll('button')].find((b) => b.textContent === 'Update').click()`);
    await waitFor(`/Downloading Claude Code 0.90.0 · [1-9]/.test(${claude}?.textContent ?? '')`);
    await shot('17-updater-updating');
    if ((await js<string>(`document.querySelector('.harness-chip').textContent`)).includes('Setting up')) throw new Error('the harness reads as being set up while it updates');
    await waitFor(`!${claude}`, 20_000);
    const state = await js<{ status: string; version?: string }>(`window.wrontend.invoke('harness:list').then((l) => l.find((h) => h.id === 'claude-code').state)`);
    if (state.status !== 'installed' || state.version !== '0.90.0') throw new Error(`Claude Code is ${JSON.stringify(state)} after updating it`);
  });
  // the model's pull stops halfway and fails: the failure stays on its row, and skipping the upload takes the row away
  await step('18-updater-model', async () => {
    const text = await js<string>(`${model}.querySelector('.update-versions').textContent`);
    if (text !== 'New upload · 12.0 GB to download') throw new Error(`the model's row reads ${text}`);
    await js(`[...${model}.querySelectorAll('button')].find((b) => b.textContent === 'Update').click()`);
    await waitFor(`${model}?.querySelector('.progress')`);
    await shot('18-model-updating');
    await waitFor(`${model}?.querySelector('.update-failure')`, 10_000);
    await js(`${model}.querySelector('.update-failure').click()`);
    if (!(await js<boolean>(`[...${model}.querySelectorAll('button')].some((b) => b.textContent === 'Try Again')`))) throw new Error('a failed update offers no Try Again');
    await shot('18-model-failed');
    await pickFrom(model, 'Skip This Version');
    await waitFor(`!${model}`);
  });
  // Ollama's update is a restart, which the stand-in makes in a moment; then nothing is out of date
  await step('19-updater-ollama', async () => {
    const ollama = rowOf('Ollama');
    const text = await js<string>(`${ollama}.textContent`);
    if (!text.includes('0.40.3 → 0.40.4') || !text.includes('Update and Restart')) throw new Error(`Ollama's row reads ${text}`);
    await shot('19-ollama-row');
    await js(`[...${ollama}.querySelectorAll('button')].find((b) => b.textContent === 'Update and Restart').click()`);
    await waitFor(`${ollama}?.textContent.includes('Updating Ollama')`);
    await shot('19-ollama-updating');
    await waitFor(`!${ollama} && document.querySelector('.updater-empty') && !${icon}.classList.contains('attention')`);
    await shot('19-updater-empty');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(`!document.querySelector('.updater')`);
  });

  // two sessions in two folders, made through main and shown by a reload, the way stored sessions come back
  await step('20-sidebar', async () => {
    const project = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-smoke-')));
    const other = realpathSync.native(mkdtempSync(join(tmpdir(), 'wrontend-sidebar-')));
    removeAfterExit([project, other]);
    for (const folder of [project, other]) {
      await js(`window.wrontend.invoke('session:create', { harness: 'fake', folder: ${JSON.stringify(folder)}, model: 'smoke-model', effort: 'on' })`);
    }
    win.webContents.reload();
    await new Promise((r) => win.webContents.once('did-finish-load', () => r(null)));
    await waitFor(`document.querySelectorAll('.group').length === 2`);

    // Back and Forward: new session, the first group's session, the second's
    const back = `document.querySelector('.sidebar-top button[aria-label="Back"]')`;
    const forward = `document.querySelector('.sidebar-top button[aria-label="Forward"]')`;
    if (!(await js<boolean>(`${back}.disabled && ${forward}.disabled`))) throw new Error('Back or Forward is enabled with nothing opened yet');
    await js(`document.querySelectorAll('.session-row')[0].click()`);
    await js(`document.querySelectorAll('.session-row')[1].click()`);
    await waitFor(`document.querySelectorAll('.session-row')[1].classList.contains('active')`);
    await js(`${back}.click()`);
    await waitFor(`document.querySelectorAll('.session-row')[0].classList.contains('active')`);
    await js(`${back}.click()`);
    await waitFor(`document.querySelector('.greeting') && ${back}.disabled && !${forward}.disabled`);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }))`);
    await waitFor(`document.querySelectorAll('.session-row')[0].classList.contains('active') && !${back}.disabled`);
    await shot('20-sidebar-history');

    // hidden, the sidebar leaves its buttons in the top bar
    await js(`[...document.querySelectorAll('.sidebar .nav-item')].find((b) => b.textContent === 'New').click()`);
    await waitFor(`document.querySelector('.greeting')`);
    await js(`document.querySelector('.sidebar-top button[aria-label="Hide Sidebar"]').click()`);
    await waitFor(`!document.querySelector('.sidebar') && document.querySelector('.top-bar button[aria-label="Show Sidebar"]')`);
    await js(`document.querySelector('.top-bar button[aria-label="Back"]').click()`);
    await waitFor(`document.querySelector('.top-bar .session-title')`);
    await shot('20-sidebar-hidden');
    await js(`document.querySelector('.top-bar button[aria-label="Show Sidebar"]').click()`);
    await waitFor(`document.querySelector('.sidebar')`);
  });

  const passed = steps.every((s) => s.ok) && consoleErrors.length === 0;
  await writeFile(join(out, 'report.json'), JSON.stringify({ passed, steps, skipped, consoleErrors }, null, 2));
  console.log(`wrontend smoke: ${passed ? 'passed' : 'FAILED'} -- ${steps.filter((s) => s.ok).length}/${steps.length} steps, ${consoleErrors.length} console errors, report in ${out}`);
  // app.exit skips will-quit, where the harnesses are stopped otherwise; one left running would keep the project folder
  stopHarnesses();
  app.exit(passed ? 0 : 1);
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
