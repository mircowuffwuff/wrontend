// the Settings dialog: sections on the left, their rows on the right, a search across all of them.
// configuration only -- installing and updating things happens where they are picked

import { useEffect, useState, type ReactNode } from 'react';
import type { BackgroundPolicy } from '@shared/proxy';
import type { AboutInfo, Settings, SettingsPatch } from '@shared/settings';
import { bridge } from '../bridge';
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

const BACKGROUND: Option<BackgroundPolicy>[] = [
  { value: 'local-titles', label: 'Answer titles in wrontend', detail: 'Title requests never reach the model; other side requests do' },
  { value: 'pass', label: 'Send all to the model', detail: 'Every side request reaches the model' },
  { value: 'local', label: 'Answer all in wrontend', detail: 'No side request reaches the model; each gets a placeholder answer' },
  { value: 'refuse', label: 'Refuse', detail: 'Side requests fail with an error, which a harness may not handle' },
];

function sections(o: {
  settings: Settings;
  update: (patch: SettingsPatch) => Promise<void>;
  defaultAddress: string;
  about: AboutInfo | null;
}): Section[] {
  const { settings, update } = o;
  const a = settings.appearance;

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
          rows: [
            {
              id: 'ollama-address',
              label: 'Address',
              description: 'Where wrontend finds Ollama. Leave it empty for OLLAMA_HOST, or Ollama’s own default.',
              control: <TextField label="Ollama address" value={settings.ollama.address} placeholder={o.defaultAddress} onCommit={(address) => update({ ollama: { address } })} />,
            },
          ],
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
  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [defaultAddress, setDefaultAddress] = useState('');

  useEffect(() => {
    void bridge.invoke('app:about').then(setAbout);
    void bridge.invoke('ollama:default-address').then(setDefaultAddress);
  }, []);

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
    defaultAddress,
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
