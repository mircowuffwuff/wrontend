import { useEffect } from 'react';
import { bridge } from './bridge';
import { Composer } from './components/Composer';
import { Icon } from './components/Icon';
import { Leaf } from './components/Leaf';
import { Sidebar } from './components/Sidebar';
import { Transcript } from './components/Transcript';
import { useDraft } from './state/draft';
import { startOllamaSync } from './state/ollama';
import { startSessionSync, useSessions } from './state/sessions';

export function App() {
  useEffect(() => startOllamaSync(), []);
  useEffect(() => startSessionSync(), []);
  useEffect(() => {
    void bridge.invoke('app:autoprompt').then((auto) => {
      if (!auto) return;
      const draft = useDraft.getState();
      void useSessions.getState().createAndPrompt({ harness: auto.harness, folder: auto.folder, model: auto.model, effort: draft.effort }, auto.text);
    });
  }, []);
  const session = useSessions((s) => (s.activeId ? s.sessions[s.activeId] : null));

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <header className="top-bar drag">
          {session && (
            <>
              <span className="harness-icon muted" title="Claude Code">
                <Icon name="harness" size={18} />
              </span>
              <span className="session-title">{session.info.title}</span>
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
    </div>
  );
}
