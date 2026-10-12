// the updater panel: only what is out of date, grouped by kind, each row with its own update button, and Update All.
// a row's menu skips the version it offers or pins the component where it is -- no other screen does either

import { useEffect, useState } from 'react';
import type { ComponentState } from '@shared/components';
import { outdated, UPDATE_GROUPS, type UpdateEntry, type UpdateGroup } from '@shared/updates';
import { bridge } from '../bridge';
import { useUpdates } from '../state/updates';
import { Icon } from './Icon';
import { Leaf } from './Leaf';
import { Menu } from './Menu';

const GROUP_NAMES: Record<UpdateGroup, string> = {
  harnesses: 'Harnesses',
  ollama: 'Ollama',
  models: 'Models',
};

function megabytes(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

function checkedText(checking: boolean, checkedAt: number | null, now: number): string {
  if (checking) return 'Checking…';
  if (checkedAt === null) return 'Not checked yet';
  const minutes = Math.floor((now - checkedAt) / 60_000);
  if (minutes < 1) return 'Checked just now';
  if (minutes < 60) return `Checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `Checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
}

export function UpdaterPanel() {
  const close = useUpdates((s) => s.close);
  const { entries, checking, checkedAt, failures } = useUpdates((s) => s.updates);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', escape);
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      document.removeEventListener('keydown', escape);
      clearInterval(tick);
    };
  }, [close]);

  const waiting = outdated({ entries, checking, checkedAt, failures }).filter((e) => e.state?.status !== 'installing');
  const updateAll = () => {
    for (const entry of waiting) void bridge.invoke('updates:install', entry.id);
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="updater" role="dialog" aria-modal="true" aria-label="Updates">
        <header className="updater-head">
          <div className="updater-title">
            <h2>Updates</h2>
            <span className="setting-description">{checkedText(checking, checkedAt, now)}</span>
          </div>
          <button className="icon-button" aria-label="Check Now" title="Check Now" disabled={checking} onClick={() => void bridge.invoke('updates:check')}>
            <Icon name="restart" />
          </button>
          {waiting.length > 0 && (
            <button className="button primary" onClick={updateAll}>
              <Icon name="download" size={16} />
              Update All
            </button>
          )}
          <button className="icon-button" aria-label="Close" title="Close" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        <div className="updater-body">
          {failures.map((f) => (
            <p key={f.group} className="browser-note error" title={f.error}>
              Could not check {GROUP_NAMES[f.group].toLowerCase()}: {f.error}
            </p>
          ))}
          {entries.length === 0 ? (
            <div className="browser-intro updater-empty">
              <Leaf size={20} />
              <h2>{checkedAt === null && checking ? 'Checking for updates' : 'Everything is up to date'}</h2>
              <p className="setting-description">Harnesses, Ollama and models are checked when wrontend starts and every few hours.</p>
            </div>
          ) : (
            UPDATE_GROUPS.map((group) => {
              const rows = entries.filter((e) => e.group === group);
              if (rows.length === 0) return null;
              return (
                <section key={group} className="update-group">
                  <div className="settings-area-label">{GROUP_NAMES[group]}</div>
                  {rows.map((entry) => (
                    <UpdateRow key={entry.id} entry={entry} />
                  ))}
                </section>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function UpdateRow({ entry }: { entry: UpdateEntry }) {
  const update = () => void bridge.invoke('updates:install', entry.id);
  const installing = entry.state?.status === 'installing';
  return (
    <div className={`update-row${entry.pinned ? ' pinned' : ''}`}>
      <div className="update-text">
        <span className="update-name">
          {entry.name}
          {entry.pinned && <span className="badge">Pinned</span>}
        </span>
        <UpdateDetail entry={entry} state={entry.state} />
      </div>
      <Menu
        placement="below"
        align="end"
        fixed
        triggerClass="icon-button"
        title="More"
        trigger={<Icon name="more" />}
        items={[
          { key: 'skip', label: 'Skip This Version', detail: `Not offered again until a newer one than ${entry.available}` },
          entry.pinned
            ? { key: 'unpin', label: 'Unpin', detail: 'Offers its updates again' }
            : { key: 'pin', label: 'Pin', detail: `Keeps ${entry.current ?? 'the installed version'} until unpinned` },
        ]}
        onPick={(key) => {
          if (key === 'skip') void bridge.invoke('updates:skip', entry.id);
          else void bridge.invoke('updates:pin', entry.id, key === 'pin');
        }}
      />
      {!entry.pinned && (
        <button className="button" disabled={installing} onClick={update}>
          <Icon name="download" size={16} />
          {installing ? 'Updating…' : entry.state?.status === 'failed' ? 'Try Again' : 'Update'}
        </button>
      )}
    </div>
  );
}

// the versions, or the update's progress while it runs, or why it failed
function UpdateDetail({ entry, state }: { entry: UpdateEntry; state: ComponentState | null }) {
  const [open, setOpen] = useState(false);
  if (state?.status === 'installing') {
    return (
      <>
        <span className="setting-description">
          {state.step}
          {state.bytes > 0 && ` · ${state.total ? `${megabytes(state.bytes)} of ${megabytes(state.total)}` : megabytes(state.bytes)}`}
        </span>
        {state.total ? (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor((state.bytes / state.total) * 100)}>
            <div style={{ width: `${(state.bytes / state.total) * 100}%` }} />
          </div>
        ) : null}
      </>
    );
  }
  if (state?.status === 'failed') {
    return (
      <>
        <button className="tool-summary update-failure" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Leaf size={9} color="var(--remove)" />
          <span>{state.error}</span>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
        {open && <pre className="mono update-log">{state.detail}</pre>}
      </>
    );
  }
  return (
    <span className="update-versions mono">
      {entry.current ? `${entry.current} → ` : ''}
      {entry.available}
    </span>
  );
}
