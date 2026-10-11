import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import { AgentHost } from './host/agent-host';
import { handle, send } from './ipc';
import { OllamaClient, resolveBaseUrl } from './ollama/client';
import { OllamaMonitor } from './ollama/monitor';
import { ProxyServer } from './proxy/server';
import { prepareSmoke, runSmoke, smokeFolder } from './smoke';

// the window's own colours before the renderer has painted, and behind the native window buttons
const CHROME = {
  dark: { background: '#161c14', symbols: '#ece6cf' },
  light: { background: '#f0f2ea', symbols: '#1f2a17' },
};
const TOP_BAR_HEIGHT = 44;

let win: BrowserWindow | null = null;
const ollama = new OllamaClient(resolveBaseUrl(process.env.OLLAMA_HOST));
const monitor = new OllamaMonitor(ollama, (status) => send(win, 'ollama:status', status));
const proxy = new ProxyServer(() => ollama.baseUrl);
let host: AgentHost | null = null;
const smoke = smokeFolder();
if (smoke) prepareSmoke();

function chrome() {
  return nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light;
}

function createWindow(): void {
  const colours = chrome();
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 900,
    minHeight: 560,
    show: false,
    backgroundColor: colours.background,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colours.background, symbolColor: colours.symbols, height: TOP_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      // the smoke test's window is never shown, and a throttled hidden window paints late
      backgroundThrottling: !smoke,
    },
  });

  win.once('ready-to-show', () => {
    if (!smoke) win?.show();
  });
  win.on('closed', () => (win = null));

  // links in the transcript open in the user's browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));

  if (smoke) win.webContents.once('did-finish-load', () => void runSmoke(win!, smoke));

  const capture = process.env.WRONTEND_CAPTURE;
  if (capture) captureOnce(win, capture);
}

// WRONTEND_CAPTURE=<file.png> saves screenshots of the window after it loads -- for checking the UI without looking at the screen.
// WRONTEND_CAPTURE_DELAY lists the moments in milliseconds, comma-separated; with several, the files are numbered
function captureOnce(target: BrowserWindow, file: string): void {
  const delays = (process.env.WRONTEND_CAPTURE_DELAY ?? '2500').split(',').map(Number);
  target.webContents.once('did-finish-load', () => {
    delays.forEach((delay, n) => {
      setTimeout(async () => {
        if (target.isDestroyed()) return;
        const image = await target.webContents.capturePage();
        const name = delays.length === 1 ? file : file.replace(/(\.png)?$/i, `-${n + 1}.png`);
        await writeFile(name, image.toPNG());
        console.log(`wrontend: captured the window to ${name}`);
      }, delay);
    });
  });
}

function registerHandlers(): void {
  handle('window:minimize', () => win?.minimize());
  handle('window:toggle-maximize', () => {
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  handle('dialog:pick-folder', async () => {
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // WRONTEND_AUTOPROMPT=<folder>|<model>|<prompt> starts one session as the app opens -- for exercising a real turn without clicking.
  // WRONTEND_HARNESS picks its harness, Claude Code unless set
  handle('app:autoprompt', () => {
    const [folder, model, ...text] = (process.env.WRONTEND_AUTOPROMPT ?? '').split('|');
    const harness = process.env.WRONTEND_HARNESS ?? 'claude-code';
    return folder && model && text.length ? { harness, folder, model, text: text.join('|') } : null;
  });
  handle('ollama:status', () => monitor.status);
  handle('ollama:models', () => ollama.models());
  handle('ollama:show', async (name) => {
    try {
      return await ollama.show(name);
    } catch {
      return null;
    }
  });
  handle('session:create', (options) => sessions().create(options));
  handle('session:prompt', (id, text) => sessions().prompt(id, text));
  handle('session:cancel', (id) => sessions().cancel(id));
  handle('session:answer', (id, requestId, optionId) => sessions().answer(id, requestId, optionId));
  handle('session:set-model', (id, model) => sessions().setModel(id, model));
  handle('session:set-effort', (id, effort) => sessions().setEffort(id, effort));
}

function sessions(): AgentHost {
  if (!host) throw new Error('the agent host is not ready');
  return host;
}

nativeTheme.on('updated', () => {
  const colours = chrome();
  win?.setBackgroundColor(colours.background);
  if (process.platform === 'win32' || process.platform === 'linux') {
    win?.setTitleBarOverlay({ color: colours.background, symbolColor: colours.symbols, height: TOP_BAR_HEIGHT });
  }
});

app.whenReady().then(async () => {
  registerHandlers();
  await proxy.start();
  host = new AgentHost(proxy, app.getPath('userData'), (event) => send(win, 'session:event', event));
  monitor.start();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  host?.disposeAll();
  monitor.stop();
  void proxy.stop();
});
