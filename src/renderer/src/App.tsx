import { useEffect, useState } from 'react';
import { bridge } from './bridge';
import { Composer } from './components/Composer';
import { ConfirmDialog } from './components/Confirm';
import { HarnessIcon } from './components/HarnessIcon';
import { Icon } from './components/Icon';
import { Leaf } from './components/Leaf';
import { ModelBrowser } from './components/ModelBrowser';
import { SettingsDialog } from './components/Settings';
import { StatsCard } from './components/StatsCard';
import { SessionMenu, TitleField } from './components/SessionMenu';
import { NavButtons, Sidebar } from './components/Sidebar';
import { Transcript } from './components/Transcript';
import { UpdaterPanel } from './components/Updater';
import { startPullSync, useBrowser } from './state/browser';
import { useDraft } from './state/draft';
import { startHarnessSync, useHarnesses } from './state/harnesses';
import { startOllamaSync } from './state/ollama';
import { startSessionSync, useSessions, type SessionView } from './state/sessions';
import { startSettingsSync, useSettings } from './state/settings';
import { useSidebar } from './state/sidebar';
import { startUpdatesSync, useUpdates } from './state/updates';

// the session's title, which opens its menu; renamed in place
function TopBarTitle({ session }: { session: SessionView }) {
  const [renaming, setRenaming] = useState(false);
  if (renaming) return <TitleField session={session} onDone={() => setRenaming(false)} />;
  return (
    <SessionMenu
      session={session}
      trigger={
        <span className="session-title">
          {session.info.title}
          <Icon name="chevronDown" size={14} />
        </span>
      }
      triggerClass="picker"
      onRename={() => setRenaming(true)}
    />
  );
}

export function App() {
  useEffect(() => startSettingsSync(), []);
  useEffect(() => startOllamaSync(), []);
  useEffect(() => startHarnessSync(), []);
  useEffect(() => startSessionSync(), []);
  useEffect(() => startPullSync(), []);
  useEffect(() => startUpdatesSync(), []);
  useEffect(() => {
    void bridge.invoke('app:autoprompt').then((auto) => {
      if (!auto) return;
      const draft = useDraft.getState();
      void useSessions.getState().createAndPrompt({ harness: auto.harness, folder: auto.folder, model: auto.model, effort: draft.effort }, auto.text);
    });
  }, []);
  // Back and Forward from the keyboard and the mouse's side buttons, as in a browser
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.shiftKey || e.metaKey) return;
      if (e.key === 'ArrowLeft') useSessions.getState().back();
      else if (e.key === 'ArrowRight') useSessions.getState().forward();
      else return;
      e.preventDefault();
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) useSessions.getState().back();
      else if (e.button === 4) useSessions.getState().forward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
  const session = useSessions((s) => (s.activeId ? s.sessions[s.activeId] : null));
  const harnessName = useHarnesses((s) => s.list.find((h) => h.id === session?.info.harness)?.name ?? session?.info.harness);
  const settingsOpen = useSettings((s) => s.section !== null);
  const browserOpen = useBrowser((s) => s.open);
  const updaterOpen = useUpdates((s) => s.open);
  const sidebarHidden = useSidebar((s) => s.hidden);

  return (
    <div className={`app${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      {!sidebarHidden && <Sidebar />}
      <main className="main">
        <header className="top-bar drag">
          {sidebarHidden && <NavButtons />}
          {session && (
            <>
              <span className="harness-icon muted" title={harnessName}>
                <HarnessIcon harness={session.info.harness} size={18} />
              </span>
              <TopBarTitle key={session.info.id} session={session} />
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
              <StatsCard />
            </div>
          </div>
        )}
        <Composer session={session} />
      </main>
      {settingsOpen && <SettingsDialog />}
      {browserOpen && <ModelBrowser />}
      {updaterOpen && <UpdaterPanel />}
      <ConfirmDialog />
    </div>
  );
}
