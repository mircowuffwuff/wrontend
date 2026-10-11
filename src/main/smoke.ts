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

// what the smoke test needs set before the window loads: the fake agent and an autoprompt in a throwaway folder
export function prepareSmoke(): void {
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
  await step('07-light-theme', async () => {
    nativeTheme.themeSource = 'light';
    await new Promise((r) => setTimeout(r, 400));
    await js(`document.querySelector('.content').scrollTop = 0`);
    await shot('07-light-theme');
    nativeTheme.themeSource = 'system';
  });
  await step('08-new-session-screen', async () => {
    await js(`[...document.querySelectorAll('.nav-item')].find((b) => b.textContent.trim() === 'New').click()`);
    await waitFor(`document.querySelector('.greeting')`);
    await shot('08-new-session-screen');
  });

  const passed = steps.every((s) => s.ok) && consoleErrors.length === 0;
  await writeFile(join(out, 'report.json'), JSON.stringify({ passed, steps, consoleErrors }, null, 2));
  console.log(`wrontend smoke: ${passed ? 'passed' : 'FAILED'} -- ${steps.filter((s) => s.ok).length}/${steps.length} steps, ${consoleErrors.length} console errors, report in ${out}`);
  app.exit(passed ? 0 : 1);
}
