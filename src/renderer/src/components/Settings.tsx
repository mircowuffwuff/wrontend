// the Settings dialog: sections on the left, their rows on the right, a search across all of them.
// configuration only -- installing and updating things happens where they are picked

import { useEffect, useState, type ReactNode } from 'react';
import type { BackgroundPolicy } from '@shared/proxy';
import type { AboutInfo, OllamaServerState, OllamaServerValues, OllamaServerVar, Settings, SettingsPatch } from '@shared/settings';
import { bridge } from '../bridge';
import { downloading } from '../state/browser';
import { confirm } from '../state/confirm';
import { useOllama } from '../state/ollama';
import { useSessions } from '../state/sessions';
import { errorText, useSettings } from '../state/settings';
import { Icon, type IconName } from './Icon';
import { Menu } from './Menu';

interface Row {
  id: string;
  label: string;
  // searched along with the label
  description?: string;
  // shown under the description, never searched
  note?: ReactNode;
  control?: ReactNode;
}

interface Group {
  heading: string;
  rows: Row[];
  // shown under the heading when the group has something to say before its rows
  intro?: ReactNode;
}

interface Section {
  id: string;
  label: string;
  icon: IconName;
  area: 'Settings' | 'This computer';
  groups: Group[];
}

interface Option<T> {
  value: T;
  label: ReactNode;
  title?: string;
  detail?: ReactNode;
}

function Segmented<T extends string | null>({ value, options, onChange, label }: { value: T; options: Option<T>[]; onChange: (value: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.title}
          title={o.title}
          className={o.value === value ? 'on' : ''}
          onClick={() => o.value !== value && onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Select<T extends string | null>({ value, options, onChange }: { value: T; options: Option<T>[]; onChange: (value: T) => void }) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu
      placement="below"
      align="end"
      trigger={
        <span className="select">
          {current?.label ?? value}
          <Icon name="chevronDown" size={14} />
        </span>
      }
      items={options.map((o) => ({ key: String(o.value), label: o.label, detail: o.detail, selected: o.value === value }))}
      onPick={(key) => {
        const picked = options.find((o) => String(o.value) === key);
        if (picked && picked.value !== value) onChange(picked.value);
      }}
    />
  );
}

// a value set outside wrontend that none of the options names still shows, as itself
function withCurrent<T extends string | null>(options: Option<T>[], value: T): Option<T>[] {
  return options.some((o) => o.value === value) ? options : [...options, { value, label: String(value) }];
}

// commits on Enter or when it loses focus; Escape puts the stored value back
function TextField({ value, placeholder, onCommit, label }: { value: string; placeholder?: string; onCommit: (value: string) => Promise<void>; label: string }) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() === value) return;
    onCommit(draft.trim()).then(
      () => setError(null),
      (cause) => setError(errorText(cause)),
    );
  };
  return (
    <div className="text-field">
      <input
        className="mono"
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(value);
            setError(null);
          }
        }}
      />
      {error && <div className="setting-error">{error}</div>}
    </div>
  );
}

const RESTART_NOTE = <div className="setting-pending">Restart required for this change to take effect</div>;

const BACKGROUND: Option<BackgroundPolicy>[] = [
  { value: 'local-titles', label: 'Answer titles in wrontend', detail: 'Title requests never reach the model; other side requests do' },
  { value: 'pass', label: 'Send all to the model', detail: 'Every side request reaches the model' },
  { value: 'local', label: 'Answer all in wrontend', detail: 'No side request reaches the model; each gets a placeholder answer' },
  { value: 'refuse', label: 'Refuse', detail: 'Side requests fail with an error, which a harness may not handle' },
];

const CONTEXT: Option<string | null>[] = [
  { value: null, label: 'Ollama’s default', detail: 'Chosen by Ollama from the GPU’s memory' },
  ...[8, 16, 32, 64, 128, 256].map((k) => ({ value: String(k * 1024), label: `${k}K tokens` })),
];

const PARALLEL: Option<string | null>[] = [{ value: null, label: 'Ollama’s default' }, ...['1', '2', '4'].map((n) => ({ value: n, label: n }))];

const KEEP_ALIVE: Option<string | null>[] = [
  { value: null, label: '5 minutes', detail: 'Ollama’s default' },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: '-1', label: 'Until Ollama stops' },
  { value: '0', label: 'Unload after each reply' },
];

function sections(o: {
  settings: Settings;
  update: (patch: SettingsPatch) => Promise<void>;
  server: OllamaServerState | null;
  setServer: (changes: Partial<OllamaServerValues>) => void;
  serverError: string | null;
  defaultAddress: string;
  ollamaPanel: ReactNode;
  about: AboutInfo | null;
}): Section[] {
  const { settings, update, server } = o;
  const a = settings.appearance;
  const pending = (name: OllamaServerVar) => (server?.pending.includes(name) ? RESTART_NOTE : undefined);
  const value = (name: OllamaServerVar) => server?.values[name] ?? null;

  const serverRows: Row[] =
    server && !server.unsupported
      ? [
          {
            id: 'ollama-models',
            label: 'Models folder',
            description: 'Where Ollama keeps its models. Changing it does not move the models already stored.',
            note: (
              <>
                {value('OLLAMA_MODELS') ? (
                  <div className="setting-path mono">{value('OLLAMA_MODELS')}</div>
                ) : (
                  <div className="setting-path muted">Ollama’s default, in your user folder</div>
                )}
                {pending('OLLAMA_MODELS')}
              </>
            ),
            control: (
              <div className="control-row">
                {value('OLLAMA_MODELS') && (
                  <button className="button" onClick={() => o.setServer({ OLLAMA_MODELS: null })}>
                    Default
                  </button>
                )}
                <button
                  className="button"
                  onClick={() =>
                    void bridge.invoke('dialog:pick-folder').then((folder) => {
                      if (folder) o.setServer({ OLLAMA_MODELS: folder });
                    })
                  }
                >
                  Choose…
                </button>
              </div>
            ),
          },
          {
            id: 'ollama-context',
            label: 'Context length',
            description: 'How much of a conversation a model holds. Agents need 64K tokens or more; a longer context takes more memory.',
            note: pending('OLLAMA_CONTEXT_LENGTH'),
            control: <Select value={value('OLLAMA_CONTEXT_LENGTH')} options={withCurrent(CONTEXT, value('OLLAMA_CONTEXT_LENGTH'))} onChange={(v) => o.setServer({ OLLAMA_CONTEXT_LENGTH: v })} />,
          },
          {
            id: 'ollama-parallel',
            label: 'Parallel requests',
            description: 'How many requests a loaded model answers at once. Each takes its own share of the context’s memory.',
            note: pending('OLLAMA_NUM_PARALLEL'),
            control: <Select value={value('OLLAMA_NUM_PARALLEL')} options={withCurrent(PARALLEL, value('OLLAMA_NUM_PARALLEL'))} onChange={(v) => o.setServer({ OLLAMA_NUM_PARALLEL: v })} />,
          },
          {
            id: 'ollama-flash',
            label: 'Flash attention',
            description: 'Uses less memory for long contexts, and is needed for a smaller KV cache.',
            note: pending('OLLAMA_FLASH_ATTENTION'),
            control: (
              <Segmented
                label="Flash attention"
                value={value('OLLAMA_FLASH_ATTENTION')}
                options={withCurrent<string | null>(
                  [
                    { value: null, label: 'Default' },
                    { value: '1', label: 'On' },
                    { value: '0', label: 'Off' },
                  ],
                  value('OLLAMA_FLASH_ATTENTION'),
                )}
                onChange={(v) => o.setServer({ OLLAMA_FLASH_ATTENTION: v })}
              />
            ),
          },
          {
            id: 'ollama-kv',
            label: 'KV cache type',
            description: 'How the context is stored in memory. q8_0 takes about half of f16’s memory, q4_0 a quarter. Needs flash attention.',
            note: pending('OLLAMA_KV_CACHE_TYPE'),
            control: (
              <Segmented
                label="KV cache type"
                value={value('OLLAMA_KV_CACHE_TYPE')}
                options={withCurrent<string | null>(
                  [
                    { value: null, label: 'f16', title: 'f16, Ollama’s default' },
                    { value: 'q8_0', label: 'q8_0' },
                    { value: 'q4_0', label: 'q4_0' },
                  ],
                  value('OLLAMA_KV_CACHE_TYPE'),
                )}
                onChange={(v) => o.setServer({ OLLAMA_KV_CACHE_TYPE: v })}
              />
            ),
          },
          {
            id: 'ollama-keep-alive',
            label: 'Keep loaded',
            description: 'How long a model stays in memory after its last request.',
            note: pending('OLLAMA_KEEP_ALIVE'),
            control: <Select value={value('OLLAMA_KEEP_ALIVE')} options={withCurrent(KEEP_ALIVE, value('OLLAMA_KEEP_ALIVE'))} onChange={(v) => o.setServer({ OLLAMA_KEEP_ALIVE: v })} />,
          },
        ]
      : [];

  return [
    {
      id: 'general',
      label: 'General',
      icon: 'settings',
      area: 'Settings',
      groups: [
        {
          heading: 'Appearance',
          rows: [
            {
              id: 'theme',
              label: 'Theme',
              control: (
                <Segmented
                  label="Theme"
                  value={a.theme}
                  options={[
                    { value: 'system', label: <Icon name="monitor" size={17} />, title: 'System' },
                    { value: 'light', label: <Icon name="sun" size={17} />, title: 'Light' },
                    { value: 'dark', label: <Icon name="moon" size={17} />, title: 'Dark' },
                  ]}
                  onChange={(theme) => void update({ appearance: { theme } })}
                />
              ),
            },
            {
              id: 'text-size',
              label: 'Transcript text size',
              description: 'Size of the conversation transcript text.',
              control: (
                <Segmented
                  label="Transcript text size"
                  value={a.textSize}
                  options={[
                    { value: 'small', label: 'Small' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'large', label: 'Large' },
                  ]}
                  onChange={(textSize) => void update({ appearance: { textSize } })}
                />
              ),
            },
            {
              id: 'width',
              label: 'Transcript width',
              description: 'Maximum width of the transcript and prompt box columns.',
              control: (
                <Segmented
                  label="Transcript width"
                  value={a.width}
                  options={[
                    { value: 'narrow', label: 'Narrow' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'wide', label: 'Wide' },
                  ]}
                  onChange={(width) => void update({ appearance: { width } })}
                />
              ),
            },
            {
              id: 'motion',
              label: 'Motion',
              description: 'Reduce animation in the transcript and other parts of the interface.',
              control: (
                <Segmented
                  label="Motion"
                  value={a.motion}
                  options={[
                    { value: 'system', label: 'System' },
                    { value: 'reduced', label: 'Reduced' },
                  ]}
                  onChange={(motion) => void update({ appearance: { motion } })}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'models',
      label: 'Models',
      icon: 'model',
      area: 'Settings',
      groups: [
        {
          heading: 'Reasoning',
          rows: [
            {
              id: 'derive',
              label: 'Copies with a renderer',
              description:
                'A thinking model without a renderer loses its earlier reasoning in Ollama. Where wrontend knows the renderer for the model’s family, it makes a copy of the model with that renderer and sends your pick there. The copy shares the original’s files, and other Ollama apps list it with wrontend-derived in its tag.',
              control: (
                <Segmented
                  label="Copies with a renderer"
                  value={settings.models.derive ? 'on' : 'off'}
                  options={[
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ]}
                  onChange={(v) => void update({ models: { derive: v === 'on' } })}
                />
              ),
            },
          ],
        },
      ],
    },
    {
      id: 'proxy',
      label: 'Proxy',
      icon: 'proxy',
      area: 'Settings',
      groups: [
        {
          heading: 'Requests',
          rows: [
            {
              id: 'background',
              label: 'Background requests',
              description:
                'Side requests a harness makes besides the conversation, such as naming a session. With one request at a time in Ollama, each can push the conversation out of the model’s cache.',
              control: <Select value={settings.proxy.backgroundPolicy} options={BACKGROUND} onChange={(backgroundPolicy) => void update({ proxy: { backgroundPolicy } })} />,
            },
          ],
        },
      ],
    },
    {
      id: 'ollama',
      label: 'Ollama',
      icon: 'server',
      area: 'This computer',
      groups: [
        {
          heading: 'Connection',
          intro: o.ollamaPanel,
          rows: [
            {
              id: 'ollama-address',
              label: 'Address',
              description: 'Where wrontend finds Ollama. Leave it empty for OLLAMA_HOST, or Ollama’s own default.',
              control: <TextField label="Ollama address" value={settings.ollama.address} placeholder={o.defaultAddress} onCommit={(address) => update({ ollama: { address } })} />,
            },
          ],
        },
        {
          heading: 'Server',
          intro: (
            <>
              {server?.unsupported && <p className="setting-intro">{server.unsupported} Its server settings are changed where it runs.</p>}
              {server && !server.unsupported && (
                <p className="setting-intro">Ollama reads these when it starts. wrontend stores them as your user environment variables, where Ollama’s own app finds them too.</p>
              )}
              {o.serverError && <div className="setting-error">{o.serverError}</div>}
            </>
          ),
          rows: serverRows,
        },
      ],
    },
    {
      id: 'storage',
      label: 'Storage',
      icon: 'storage',
      area: 'This computer',
      groups: [
        {
          heading: 'Data',
          rows: [
            {
              id: 'data-folder',
              label: 'Data folder',
              description: 'Sessions, settings, and the configuration each harness keeps for wrontend.',
              note: o.about && <div className="setting-path mono">{o.about.dataFolder}</div>,
              control: (
                <button className="button" onClick={() => void bridge.invoke('app:open-data-folder')}>
                  Open
                </button>
              ),
            },
            {
              id: 'sessions',
              label: 'Sessions',
              description: 'Stored sessions, each in a file of its own.',
              control: <span className="muted">{o.about?.sessions ?? '…'}</span>,
            },
          ],
        },
      ],
    },
    {
      id: 'about',
      label: 'About',
      icon: 'info',
      area: 'This computer',
      groups: [
        {
          heading: 'wrontend',
          rows: [
            { id: 'version', label: 'Version', control: <span className="mono muted">{o.about?.version}</span> },
            {
              id: 'runtime',
              label: 'Runtime',
              description: 'Electron, Chromium and Node.js',
              control: o.about && <span className="mono muted">{`${o.about.electron} · ${o.about.chrome} · ${o.about.node}`}</span>,
            },
            { id: 'license', label: 'License', description: 'Free software: you may share and change it under the same terms.', control: <span className="muted">AGPL-3.0 or later</span> },
            {
              id: 'source',
              label: 'Source code',
              control: (
                <a className="button" href="https://github.com/mircowuffwuff/wrontend" target="_blank" rel="noreferrer">
                  GitHub
                </a>
              ),
            },
          ],
        },
      ],
    },
  ];
}

// the Ollama section's head: what runs, and the button that restarts it
function OllamaPanel({ server, onRestarted }: { server: OllamaServerState | null; onRestarted: () => void }) {
  const status = useOllama((s) => s.status);
  const restarting = useOllama((s) => s.restarting);
  const [error, setError] = useState<string | null>(null);
  const canRestart = server !== null && !server.unsupported;
  const pending = server?.pending.length ?? 0;
  const running = status?.reachable ?? false;

  const restart = async () => {
    setError(null);
    // a restart cuts off every reply being written and every download; with nothing under way it goes ahead without asking
    const working = Object.values(useSessions.getState().sessions).filter((s) => s.running);
    const pulls = downloading();
    if (running && working.length + pulls.length > 0) {
      let message = 'These replies and downloads stop. A download goes on from where it stopped when started again:';
      if (pulls.length === 0) message = working.length === 1 ? 'This session is working, and its reply stops:' : 'These sessions are working, and their replies stop:';
      else if (working.length === 0) message = `${pulls.length === 1 ? 'This download stops' : 'These downloads stop'}. A download goes on from where it stopped when started again:`;
      const ok = await confirm({
        title: 'Restart Ollama?',
        message,
        items: [...working.map((s) => s.info.title), ...pulls.map((name) => `Downloading ${name}`)],
        action: 'Restart Ollama',
      });
      if (!ok) return;
    }
    bridge.invoke('ollama:restart').then(onRestarted, (cause) => setError(errorText(cause)));
  };

  let state = 'Looking for Ollama…';
  if (restarting) state = 'Restarting…';
  else if (status) state = running ? `Ollama ${status.version ?? ''} is running at ${status.baseUrl}` : `Ollama is not running at ${status.baseUrl}`;

  return (
    <div className="ollama-panel">
      <div className="setting-text">
        <div className="setting-label">{state}</div>
        {canRestart && (
          <div className="setting-description">
            {pending ? `${pending === 1 ? 'A change waits' : `${pending} changes wait`} for a restart.` : running ? 'Stops Ollama and starts it again with the settings below.' : 'Starts Ollama with the settings below.'}
          </div>
        )}
        {error && <div className="setting-error">{error}</div>}
      </div>
      {canRestart && (
        <button className={`button${running ? ' danger' : ''}${pending ? ' strong' : ''}`} disabled={restarting} onClick={() => void restart()}>
          <Icon name="restart" size={16} />
          {restarting ? 'Restarting…' : running ? 'Restart Ollama' : 'Start Ollama'}
        </button>
      )}
    </div>
  );
}

function RowView({ row }: { row: Row }) {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-label">{row.label}</div>
        {row.description && <div className="setting-description">{row.description}</div>}
        {row.note}
      </div>
      {row.control && <div className="setting-control">{row.control}</div>}
    </div>
  );
}

export function SettingsDialog() {
  const section = useSettings((s) => s.section);
  const settings = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);
  const { open, close } = useSettings.getState();
  const [query, setQuery] = useState('');
  const [server, setServerState] = useState<OllamaServerState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [defaultAddress, setDefaultAddress] = useState('');

  const loadServer = () =>
    void bridge.invoke('ollama:server').then(
      (state) => {
        setServerState(state);
        setServerError(null);
      },
      (cause) => setServerError(errorText(cause)),
    );
  useEffect(() => {
    void bridge.invoke('app:about').then(setAbout);
    void bridge.invoke('ollama:default-address').then(setDefaultAddress);
  }, []);
  // on opening, and again when a changed address makes Ollama local or remote
  useEffect(loadServer, [settings.ollama.address]);

  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      // an open menu takes the first Escape
      if (e.key === 'Escape' && !document.querySelector('.settings .menu')) close();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [close]);

  const all = sections({
    settings,
    update,
    server,
    setServer: (changes) =>
      void bridge.invoke('ollama:set-server', changes).then(
        (state) => {
          setServerState(state);
          setServerError(null);
        },
        (cause) => setServerError(errorText(cause)),
      ),
    serverError,
    defaultAddress,
    ollamaPanel: <OllamaPanel server={server} onRestarted={loadServer} />,
    about,
  });

  const q = query.trim().toLowerCase();
  const shown = !q
    ? all.filter((s) => s.id === section)
    : all
        .map((s) => ({
          ...s,
          groups: s.groups
            .map((g) => ({ ...g, intro: undefined, heading: `${s.label} · ${g.heading}`, rows: g.rows.filter((r) => `${r.label} ${r.description ?? ''}`.toLowerCase().includes(q)) }))
            .filter((g) => g.rows.length > 0),
        }))
        .filter((s) => s.groups.length > 0);

  const areas = ['Settings', 'This computer'] as const;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Settings">
        <nav className="settings-nav">
          <label className="search">
            <Icon name="search" size={16} />
            <input autoFocus placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          {areas.map((area) => (
            <div key={area} className="settings-area">
              <div className="settings-area-label">{area}</div>
              {all
                .filter((s) => s.area === area)
                .map((s) => (
                  <button
                    key={s.id}
                    className={`nav-item${s.id === section && !q ? ' active' : ''}`}
                    onClick={() => {
                      setQuery('');
                      open(s.id);
                    }}
                  >
                    <Icon name={s.icon} size={17} />
                    {s.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="settings-content">
          <button className="icon-button settings-close" aria-label="Close" title="Close" onClick={close}>
            <Icon name="close" />
          </button>
          {shown.length === 0 && <p className="muted">Nothing matches “{query.trim()}”.</p>}
          {shown.map((s) =>
            s.groups.map((g) => (
              <section key={`${s.id}-${g.heading}`} className="setting-group">
                <h2>{g.heading}</h2>
                {g.intro}
                {g.rows.map((row) => (
                  <RowView key={row.id} row={row} />
                ))}
              </section>
            )),
          )}
        </div>
      </div>
    </div>
  );
}
