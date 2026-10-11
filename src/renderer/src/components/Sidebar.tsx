import { useOllama } from '../state/ollama';
import { useSessions } from '../state/sessions';
import { useSettings } from '../state/settings';
import { Icon } from './Icon';
import { Leaf } from './Leaf';

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function OllamaStatusRow() {
  const status = useOllama((s) => s.status);
  const loaded = status?.loaded[0];
  let colour = 'var(--line)';
  let headline = 'Looking for Ollama…';
  let detail = '';
  if (status && !status.reachable) {
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
      <button className="icon-button" aria-label="Settings" title="Settings" onClick={() => useSettings.getState().open()}>
        <Icon name="settings" />
      </button>
    </div>
  );
}

function SessionList() {
  const { sessions, order, activeId, open } = useSessions();
  if (order.length === 0) return <div className="empty-hint">Sessions appear here, grouped by folder.</div>;
  // grouped by folder, the folder with the newest session first
  const groups = new Map<string, string[]>();
  for (const id of order) {
    const folder = sessions[id].info.folder;
    groups.set(folder, [...(groups.get(folder) ?? []), id]);
  }
  return (
    <>
      {[...groups].map(([folder, ids]) => (
        <div key={folder} className="group">
          <div className="group-header" title={folder}>
            <span className="name">{folder.split(/[\\/]/).pop()}</span>
          </div>
          {ids.map((id) => {
            const s = sessions[id];
            const live = s.running || s.permissions.length > 0;
            return (
              <button key={id} className={`nav-item session-row${id === activeId ? ' active' : ''}`} onClick={() => open(id)}>
                <Leaf size={7} color={s.permissions.length ? 'var(--mustard)' : live ? 'var(--accent)' : 'var(--line)'} />
                <span className="name">{s.info.title}</span>
              </button>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function Sidebar() {
  const { activeId, open } = useSessions();
  return (
    <aside className="sidebar">
      <div className="sidebar-top drag">
        <button className="icon-button" aria-label="Menu">
          <Icon name="menu" />
        </button>
        <button className="icon-button" aria-label="Toggle sidebar">
          <Icon name="sidebar" />
        </button>
        <button className="icon-button" aria-label="Back">
          <Icon name="back" />
        </button>
        <button className="icon-button" aria-label="Forward">
          <Icon name="forward" />
        </button>
      </div>
      <label className="search">
        <Icon name="search" size={16} />
        <input placeholder="Search" />
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
