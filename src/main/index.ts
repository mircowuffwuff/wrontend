import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import type { ComponentState, HarnessEntry } from '@shared/components';
import type { Settings } from '@shared/settings';
import { CATALOG } from './components/catalog';
import { deleteModel, DerivedModels, routeModel } from './components/derived';
import { ComponentEngine } from './components/engine';
import { fakeNpm } from './components/fake-npm';
import { NpmDriver } from './components/npm-driver';
import { ModelPulls, pulledName, pullId } from './components/pull';
import { RENDERERS } from './components/renderers';
import { ComponentStore } from './components/store';
import { AgentHost } from './host/agent-host';
import { PROFILES } from './host/profiles';
import { handle, send } from './ipc';
import { fakeHardware, fakeInstalled, fakeManifests, fakePulling, fakeSource } from './models/fake-source';
import { HuggingFace, repoDetails, type ModelSource } from './models/huggingface';
import { OllamaClient, resolveBaseUrl } from './ollama/client';
import { memoryEnvironment, windowsEnvironment } from './ollama/environment';
import { isLocalAddress, readHardware } from './ollama/hardware';
import { OllamaMonitor } from './ollama/monitor';
import { OllamaServer, windowsProcesses, type ProcessControl } from './ollama/server-settings';
import { ProxyServer } from './proxy/server';
import { SettingsStore } from './settings/store';
import { modelUpdates } from './updates/model-source';
import { offeredVersion, ollamaUpdates, waitingInstaller } from './updates/ollama-source';
import { npmUpdates } from './updates/npm-source';
import { Updater } from './updates/updater';
import { usePortableData } from './portable';
import { prepareSmoke, runSmoke, smokeFolder } from './smoke';

// the window's own colours before the renderer has painted, and behind the native window buttons
const CHROME = {
  dark: { background: '#161c14', symbols: '#ece6cf' },
  light: { background: '#f0f2ea', symbols: '#1f2a17' },
};
const TOP_BAR_HEIGHT = 44;

let win: BrowserWindow | null = null;
let host: AgentHost | null = null;
const smoke = smokeFolder();
if (smoke) prepareSmoke();
else usePortableData();

const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), applySettings);
const ollama = new OllamaClient(ollamaAddress(settings.value));
let wasReachable = false;
const monitor = new OllamaMonitor(ollama, (status) => {
  // Ollama coming up, by whoever's hand, starts with the server settings stored at that moment
  if (status.reachable && !wasReachable) void ollamaServer.noticeStarted();
  wasReachable = status.reachable;
  send(win, 'ollama:status', status);
}, (name) => derived.originalOf(name) ?? name);
const proxy = new ProxyServer(
  () => ollama.baseUrl,
  (model) => routeModel(components, derived, model),
);

// the smoke test stores nothing in the user's environment and can never stop their Ollama
const noProcesses: ProcessControl = { list: async () => [], kill: async () => {}, launch: () => {}, installedApp: () => null };
const ollamaServer = new OllamaServer({
  environment: smoke ? memoryEnvironment({ user: { OLLAMA_CONTEXT_LENGTH: '65536' } }) : process.platform === 'win32' ? windowsEnvironment : null,
  processes: smoke ? noProcesses : process.platform === 'win32' ? windowsProcesses : null,
  baseUrl: () => ollama.baseUrl,
  reachable: () => ollama.version().then(() => true, () => false),
});

// where Ollama's tray app downloads its updates, and how long a restart that installs one has to come back: the installer
// takes about a minute before it starts Ollama again
const OLLAMA_UPDATES = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Ollama', 'updates_v2') : null;
const UPDATE_START_MS = 5 * 60 * 1000;
let smokeOllamaUpdated = false;

// the smoke test sets Claude Code up with a stand-in for npm: no download, and the user's npm is never run. its first install
// fails, so the failure is seen too. it reads the user's Ollama models but makes no copies of them
let smokeInstalls = 0;
const componentStore = new ComponentStore(join(app.getPath('userData'), 'components'));
const npm = new NpmDriver(
  componentStore,
  CATALOG,
  // once Claude Code is set up, its stand-in registry has a newer release, for the updater to find
  smoke
    ? {
        findNpm: async () =>
          fakeNpm(join(app.getPath('userData'), 'fake-npm'), { latest: componentStore.active('claude-code') ? '0.90.0' : '0.89.1', chunks: 12, fail: smokeInstalls++ === 0 }),
      }
    : {},
);
const derived = new DerivedModels(ollama, componentStore, RENDERERS, { enabled: () => settings.value.models.derive, readOnly: !!smoke });
// the model browser reads Hugging Face and pulls into Ollama; the smoke test does neither, and measures a fixed machine
const modelSource: ModelSource = smoke ? fakeSource : new HuggingFace();
const pulls = new ModelPulls(smoke ? fakePulling : ollama, (name) => derived.has(name));
// the downloads under way and the ones that failed, for a window that opens or reloads meanwhile
const pullStates = new Map<string, ComponentState>();
const components = new ComponentEngine([npm, derived, pulls], (id, state) => {
  if (derived.owns(id)) send(win, 'ollama:models-changed', undefined);
  if (pulls.owns(id)) {
    const name = pulledName(id);
    if (state.status === 'installing' || state.status === 'failed') pullStates.set(name, state);
    else pullStates.delete(name);
    send(win, 'models:pull-changed', { name, state });
    if (state.status !== 'installing') {
      derived.invalidate();
      send(win, 'ollama:models-changed', undefined);
    }
  }
  for (const harness of harnesses()) if (PROFILES[harness.id]?.component === id) send(win, 'harness:changed', harness);
  updater.componentChanged(id, state);
});
const updater = new Updater(
  // the smoke test's models and their registry are stand-ins, and so is an Ollama update: the user's Ollama and the network are
  // never asked, and a restart that installs the update only takes a moment
  [
    npmUpdates(npm, componentStore, CATALOG),
    smoke ? modelUpdates(fakeInstalled, fakeManifests) : modelUpdates(ollama),
    smoke
      ? ollamaUpdates({
          waiting: async () => (smokeOllamaUpdated ? null : 'd384a27112bf'),
          running: async () => '0.40.3',
          offered: async () => '0.40.4',
          restart: () => restartOllama(async () => void (await new Promise((r) => setTimeout(r, 1500)), (smokeOllamaUpdated = true))),
        })
      : ollamaUpdates({
          waiting: async () => (ollamaServer.unsupported() ? null : waitingInstaller(OLLAMA_UPDATES)),
          running: () => ollama.version(),
          offered: (version) => offeredVersion(version),
          restart: () => restartOllama(() => ollamaServer.restart(UPDATE_START_MS)),
        }),
  ],
  join(app.getPath('userData'), 'updates.json'),
  (component) => components.install(component),
  (state) => send(win, 'updates:changed', state),
);

// the scripted test agent is offered only where it is useful: in a development run and in the smoke test
function harnesses(): HarnessEntry[] {
  return Object.values(PROFILES)
    .filter((p) => p.component !== null || smoke || !app.isPackaged)
    .map((p) => ({ id: p.id, name: p.name, state: p.component ? harnessState(p.component) : { status: 'installed', version: null } }));
}

// an update under way, or one that failed, shows in the updater: the harness stays usable at the version it has
function harnessState(component: string): ComponentState {
  const installed = npm.state(component);
  return installed.status === 'installed' ? installed : components.state(component);
}

function ollamaAddress(value: Settings): string {
  return resolveBaseUrl(value.ollama.address || process.env.OLLAMA_HOST);
}

function applySettings(value: Settings): void {
  // the renderer's prefers-color-scheme follows this too, and so do the native window buttons
  nativeTheme.themeSource = value.appearance.theme;
  host?.setBackgroundPolicy(value.proxy.backgroundPolicy);
  // the picker's notes on reasoning follow the copies being turned on or off
  send(win, 'ollama:models-changed', undefined);
  const address = ollamaAddress(value);
  if (address !== ollama.baseUrl) {
    ollama.baseUrl = address;
    void monitor.poll();
  }
  send(win, 'settings:changed', value);
}

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
    // once per run: a reloaded window must not start the session again
    const value = process.env.WRONTEND_AUTOPROMPT ?? '';
    delete process.env.WRONTEND_AUTOPROMPT;
    const [folder, model, ...text] = value.split('|');
    const harness = process.env.WRONTEND_HARNESS ?? 'claude-code';
    return folder && model && text.length ? { harness, folder, model, text: text.join('|') } : null;
  });
  handle('app:about', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    dataFolder: app.getPath('userData'),
    sessions: host?.stored().length ?? 0,
  }));
  handle('app:open-data-folder', async () => {
    await shell.openPath(app.getPath('userData'));
  });
  handle('settings:get', () => settings.value);
  handle('settings:set', (patch) => {
    // an address that does not parse is refused here, before it is stored
    const address = patch.ollama?.address;
    if (address) {
      try {
        resolveBaseUrl(address);
      } catch {
        throw new Error(`“${address}” is not an address Ollama could be reached at.`);
      }
    }
    return settings.update(patch);
  });
  handle('ollama:status', () => monitor.status);
  handle('ollama:models', async () => {
    const models = await derived.models();
    return Promise.all(
      models.map(async (m) => ({ ...m, reasoning: await derived.reasoning(components, m.name).catch(() => ({ status: 'kept' as const })) })),
    );
  });
  handle('ollama:prepare', async (name) => {
    await routeModel(components, derived, name, true);
  });
  handle('ollama:show', async (name) => {
    try {
      return await ollama.show(name);
    } catch {
      return null;
    }
  });
  handle('ollama:delete', async (name) => {
    const working = host?.workingWith(name) ?? [];
    if (working.length > 0) throw new Error(`${name} is in use by ${working.map((t) => `“${t}”`).join(', ')}.`);
    try {
      await deleteModel(components, derived, ollama, name);
    } finally {
      send(win, 'ollama:models-changed', undefined);
      void monitor.poll();
    }
  });
  handle('models:search', (query) => modelSource.search(query));
  handle('models:repo', async (repo) => {
    const files = await modelSource.files(repo);
    const hardware = smoke
      ? fakeHardware
      : await readHardware({
          local: isLocalAddress(ollama.baseUrl),
          contextSetting: (await ollamaServer.state().catch(() => null))?.values.OLLAMA_CONTEXT_LENGTH ?? null,
        });
    return repoDetails(repo, files, hardware);
  });
  // answers at once: the download reports itself as models:pull-changed, and a failure stays in its state
  handle('models:pull', (name) => {
    void components.install(pullId(name)).catch(() => {});
  });
  handle('models:cancel-pull', (name) => components.cancel(pullId(name)));
  handle('models:pulls', () => [...pullStates].map(([name, state]) => ({ name, state })));
  handle('ollama:default-address', () => resolveBaseUrl(process.env.OLLAMA_HOST));
  handle('ollama:server', () => ollamaServer.state());
  handle('ollama:set-server', (changes) => ollamaServer.set(changes));
  handle('ollama:restart', () => restartOllama(() => ollamaServer.restart()));
  handle('harness:list', () => harnesses());
  handle('harness:install', async (id) => {
    const component = PROFILES[id]?.component;
    if (!component) throw new Error(`${id} has nothing to set up`);
    // a failure reaches the renderer as the harness's state, with npm's output
    await components.install(component).catch(() => {});
  });
  handle('updates:state', () => updater.state());
  handle('updates:check', () => {
    void updater.check();
  });
  handle('updates:install', (id) => {
    void updater.update(id).catch(() => {});
  });
  handle('updates:install-all', () => {
    void updater.updateAll();
  });
  handle('updates:skip', (id) => updater.skip(id));
  handle('updates:pin', (id, pinned) => updater.pin(id, pinned));
  handle('session:stored', () => sessions().stored());
  handle('session:create', (options) => sessions().create(options));
  handle('session:save-items', (id, items) => sessions().saveItems(id, items));
  handle('session:delete', (id) => sessions().delete(id));
  handle('session:prompt', (id, text) => sessions().prompt(id, text));
  handle('session:cancel', (id) => sessions().cancel(id));
  handle('session:answer', (id, requestId, optionId) => sessions().answer(id, requestId, optionId));
  handle('session:set-model', (id, model) => sessions().setModel(id, model));
  handle('session:set-effort', (id, effort) => sessions().setEffort(id, effort));
  handle('session:set-mode', (id, modeId) => sessions().setMode(id, modeId));
}

// any restart may have installed a waiting Ollama update, so the updater looks again once Ollama is back
async function restartOllama(restart: () => Promise<void>): Promise<void> {
  send(win, 'ollama:restarting', true);
  try {
    await restart();
  } finally {
    send(win, 'ollama:restarting', false);
    void monitor.poll();
    void updater.check();
  }
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
  nativeTheme.themeSource = settings.value.appearance.theme;
  host = new AgentHost(proxy, app.getPath('userData'), (component) => npm.program(component), (event) => send(win, 'session:event', event), settings.value.proxy.backgroundPolicy);
  monitor.start();
  updater.start();
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
  updater.stop();
  void proxy.stop();
});
