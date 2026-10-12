import { useEffect } from 'react';
import { bridge } from './bridge';
import { Composer } from './components/Composer';
import { ConfirmDialog } from './components/Confirm';
import { Icon } from './components/Icon';
import { Leaf } from './components/Leaf';
import { Menu } from './components/Menu';
import { SettingsDialog } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { Transcript } from './components/Transcript';
import { useDraft } from './state/draft';
import { startHarnessSync, useHarnesses } from './state/harnesses';
import { startOllamaSync } from './state/ollama';
import { startSessionSync, useSessions } from './state/sessions';
import { startSettingsSync, useSettings } from './state/settings';

export function App() {
  useEffect(() => startSettingsSync(), []);
  useEffect(() => startOllamaSync(), []);
  useEffect(() => startHarnessSync(), []);
  useEffect(() => startSessionSync(), []);
  useEffect(() => {
    void bridge.invoke('app:autoprompt').then((auto) => {
      if (!auto) return;
      const draft = useDraft.getState();
      void useSessions.getState().createAndPrompt({ harness: auto.harness, folder: auto.folder, model: auto.model, effort: draft.effort }, auto.text);
    });
  }, []);
  const session = useSessions((s) => (s.activeId ? s.sessions[s.activeId] : null));
  const harnessName = useHarnesses((s) => s.list.find((h) => h.id === session?.info.harness)?.name ?? session?.info.harness);
  const settingsOpen = useSettings((s) => s.section !== null);

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="top-bar drag">
          {session && (
            <>
              <span className="harness-icon muted" title={harnessName}>
                <Icon name="harness" size={18} />
              </span>
              <Menu
                placement="below"
                trigger={
                  <span className="session-title">
                    {session.info.title}
                    <Icon name="chevronDown" size={14} />
                  </span>
                }
                items={[{ key: 'delete', label: 'Delete Session', detail: 'Removes it from wrontend; the harness keeps its own history' }]}
                onPick={(key) => {
                  if (key === 'delete' && window.confirm(`Delete “${session.info.title}”?`)) void useSessions.getState().remove(session.info.id);
                }}
              />
              <span className="chip" title={session.info.folder}>
                {session.info.folder.split(/[\\/]/).pop()}
              </span>
            </>
          )}
        </header>
        {session ? (
          <Transcript session={session} />
        ) : (
          <div className="content">
            <div className="column">
              <h1 className="greeting">
                <Leaf size={20} />
                What are we growing today?
              </h1>
            </div>
          </div>
        )}
        <Composer session={session} />
      </main>
      {settingsOpen && <SettingsDialog />}
      <ConfirmDialog />
    </div>
  );
}
