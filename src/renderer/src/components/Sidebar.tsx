import { outdated } from '@shared/updates';
import { useDraft } from '../state/draft';
import { useHarnesses } from '../state/harnesses';
import { useOllama } from '../state/ollama';
import { useSessions } from '../state/sessions';
import { useSettings } from '../state/settings';
import { folderName, groupSessions, useSidebar } from '../state/sidebar';
import { useUpdates } from '../state/updates';
import { HarnessIcon } from './HarnessIcon';
import { Icon } from './Icon';
import { Leaf } from './Leaf';

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function OllamaStatusRow() {
  const status = useOllama((s) => s.status);
  const restarting = useOllama((s) => s.restarting);
  const loaded = status?.loaded[0];
  const pending = useUpdates((s) => outdated(s.updates).length);
  let colour = 'var(--line)';
  let headline = 'Looking for Ollama…';
  let detail = '';
  if (restarting) {
    colour = 'var(--mustard)';
    headline = 'Restarting Ollama…';
    detail = status?.baseUrl ?? '';
  } else if (status && !status.reachable) {
    colour = 'var(--remove)';
    headline = 'Ollama is not running';
    detail = status.baseUrl;
  } else if (status?.reachable) {
    colour = 'var(--add)';
    headline = `Ollama ${status.version ?? ''}`.trim();
    if (loaded) {
      const gpu = loaded.sizeBytes ? Math.round((100 * loaded.vramBytes) / loaded.sizeBytes) : 0;
      detail = `${loaded.name} · ${gb(loaded.sizeBytes)} · ${gpu}% GPU`;
    } else {
      detail = 'No model loaded';
    }
  }
  return (
    <div className="status">
      <Leaf size={9} color={colour} />
      <div className="detail">
        <div>{headline}</div>
        {detail && (
          <div className="mono muted" title={detail}>
            {detail}
          </div>
        )}
      </div>
      <button
        className={`icon-button${pending ? ' attention' : ''}`}
        aria-label="Updates"
        title={pending ? `${pending} update${pending === 1 ? '' : 's'} available` : 'Updates'}
        onClick={() => useUpdates.getState().show()}
      >
        <Icon name="download" />
      </button>
      <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => useSettings.getState().open()}>
        <Icon name="settings" />
      </button>
    </div>
  );
}

function SessionList() {
  const { sessions, order, activeId, open } = useSessions();
  const { query, collapsed, toggleGroup } = useSidebar();
  const harnesses = useHarnesses((s) => s.list);
  if (order.length === 0) return <div className="empty-hint">Sessions appear here, grouped by folder.</div>;
  const groups = groupSessions(
    order.map((id) => sessions[id].info),
    query,
  );
  if (groups.length === 0) return <div className="empty-hint">No sessions match “{query.trim()}”.</div>;
  return (
    <>
      {groups.map(({ folderId, folder, ids }) => {
        // a search shows every match, collapsed or not
        const closed = !query.trim() && collapsed.includes(folderId);
        return (
          <div key={folderId} className={`group${closed ? ' closed' : ''}`}>
            <div className="group-header">
              <button className="group-label" title={folder} aria-expanded={!closed} onClick={() => toggleGroup(folderId)}>
                <span className="name">{folderName(folder)}</span>
                <span className="chevron">
                  <Icon name={closed ? 'chevronRight' : 'chevronDown'} size={14} />
                </span>
              </button>
              <button
                className="icon-button small"
                aria-label={`New Session in ${folderName(folder)}`}
                title={`New session in ${folderName(folder)}`}
                onClick={() => {
                  useDraft.getState().setFolder(folder);
                  open(null);
                }}
              >
                <Icon name="plus" size={16} />
              </button>
            </div>
            {!closed &&
              ids.map((id) => {
                const s = sessions[id];
                // the harness's mark is the row's status dot as well: mustard while it needs input, the accent while it runs
                const state = s.permissions.length ? 'asking' : s.running ? 'running' : 'idle';
                return (
                  <button key={id} className={`nav-item session-row${id === activeId ? ' active' : ''}`} onClick={() => open(id)}>
                    <span className={`row-mark ${state}`} title={harnesses.find((h) => h.id === s.info.harness)?.name ?? s.info.harness}>
                      <HarnessIcon harness={s.info.harness} size={14} />
                    </span>
                    <span className="name">{s.info.title}</span>
                  </button>
                );
              })}
          </div>
        );
      })}
    </>
  );
}

// Toggle sidebar, Back and Forward: atop the sidebar, and in the session's top bar while the sidebar is hidden
export function NavButtons() {
  const canBack = useSessions((s) => s.history.past.length > 0);
  const canForward = useSessions((s) => s.history.future.length > 0);
  const hidden = useSidebar((s) => s.hidden);
  return (
    <div className="nav-buttons">
      <button
        className="icon-button"
        aria-label={hidden ? 'Show Sidebar' : 'Hide Sidebar'}
        title={hidden ? 'Show sidebar' : 'Hide sidebar'}
        onClick={() => useSidebar.getState().toggle()}
      >
        <Icon name="sidebar" />
      </button>
      <button className="icon-button" aria-label="Back" title="Back" disabled={!canBack} onClick={() => useSessions.getState().back()}>
        <Icon name="back" />
      </button>
      <button className="icon-button" aria-label="Forward" title="Forward" disabled={!canForward} onClick={() => useSessions.getState().forward()}>
        <Icon name="forward" />
      </button>
    </div>
  );
}

export function Sidebar() {
  const { activeId, open } = useSessions();
  const query = useSidebar((s) => s.query);
  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <NavButtons />
      </div>
      <label className="search">
        <Icon name="search" size={16} />
        <input
          placeholder="Search"
          value={query}
          onChange={(e) => useSidebar.getState().search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') useSidebar.getState().search('');
          }}
        />
      </label>
      <button className={`nav-item${activeId === null ? ' active' : ''}`} onClick={() => open(null)}>
        <Icon name="plus" size={16} />
        New
      </button>
      <div className="sessions">
        <SessionList />
      </div>
      <div className="ornament" aria-hidden="true">
        <Leaf size={22} color="var(--olive)" />
        <Leaf size={15} color="var(--mustard)" style={{ opacity: 0.8 }} />
        <Leaf size={26} color="var(--raised)" />
        <Leaf size={8} />
      </div>
      <OllamaStatusRow />
    </aside>
  );
}
