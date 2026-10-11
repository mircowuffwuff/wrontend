// the prompt box with what sits above it (new session only) and the pickers below it

import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import { useDraft } from '../state/draft';
import { useOllama } from '../state/ollama';
import { composeMessage, useQuotes, type QuoteCard } from '../state/quotes';
import { useSessions, type SessionView } from '../state/sessions';
import { Icon } from './Icon';
import { ContextLeaves } from './Leaf';
import { Menu } from './Menu';
import { PermissionPrompt } from './Permission';

// one shared empty list: a selector that returns a new array each time makes zustand re-render without end
const NO_CARDS: QuoteCard[] = [];

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

export function Composer({ session }: { session: SessionView | null }) {
  const [text, setText] = useState('');
  const area = useRef<HTMLTextAreaElement>(null);
  const models = useOllama((s) => s.models);
  const loaded = useOllama((s) => s.status?.loaded);
  const draft = useDraft();
  const { createAndPrompt, prompt, cancel, answer, setModel, setEffort, setMode, creating } = useSessions();

  const fresh = session === null;
  const cards = useQuotes((s) => (session ? (s.cards[session.info.id] ?? NO_CARDS) : NO_CARDS));
  const { remove: removeCard, clear: clearCards } = useQuotes();
  const model = fresh ? draft.model : session.info.model;
  const effort = fresh ? draft.effort : session.info.effort;
  const running = !!session?.running || creating;
  const permission = session?.permissions[0] ?? null;

  // the box grows with its text up to its maximum height
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    el.style.overflowY = el.scrollHeight > el.clientHeight ? 'auto' : 'hidden';
  }, [text]);

  useEffect(() => area.current?.focus(), [session?.info.id]);

  const canSend = (text.trim().length > 0 || cards.length > 0) && !!model && (!fresh || !!draft.folder) && !running;

  const send = () => {
    if (!canSend || !model) return;
    const value = composeMessage(cards, text);
    setText('');
    if (fresh) void createAndPrompt({ harness: 'claude-code', folder: draft.folder!, model, effort }, value);
    else {
      clearCards(session.info.id);
      void prompt(session.info.id, value);
    }
  };

  const pickFolder = async () => {
    const folder = await bridge.invoke('dialog:pick-folder');
    if (folder) draft.setFolder(folder);
  };

  // the context window: what the harness reports, else what the proxy measured against the loaded model
  const used = session?.usage?.used ?? (session?.lastMain ? (session.lastMain.inputTokens ?? 0) + (session.lastMain.outputTokens ?? 0) : null);
  const windowSize = session?.usage?.size ?? loaded?.find((m) => m.name === model)?.contextLength ?? null;
  const rate =
    session?.lastMain?.outputTokens && session.lastMain.generationMs
      ? `${((session.lastMain.outputTokens * 1000) / session.lastMain.generationMs).toFixed(1)} tok/s`
      : null;

  return (
    <div className="composer">
      <div className="column">
        {fresh && (
          <div className="chips-row">
            <span className="chip outline" title="The harness is chosen before the first prompt and stays for the session">
              <Icon name="harness" size={14} />
              Claude Code
            </span>
            <button className="chip outline" onClick={() => void pickFolder()} title={draft.folder ?? undefined}>
              <Icon name="folder" size={14} />
              {draft.folder ? draft.folder.split(/[\\/]/).pop() : 'Choose Folder'}
            </button>
          </div>
        )}
        {permission && session && (
          <PermissionPrompt
            key={permission.requestId}
            request={permission}
            onAnswer={(optionId) => void answer(session.info.id, permission.requestId, optionId)}
          />
        )}
        <div className="prompt-box">
          {cards.length > 0 && session && (
            <div className="quote-cards">
              {cards.map((c) => (
                <div key={c.id} className="quote-card" title={c.reply ? `${c.quote}

${c.reply}` : c.quote}>
                  <div className="quote-card-quote">{c.quote}</div>
                  {c.reply && <div className="quote-card-reply">{c.reply}</div>}
                  <div className="quote-card-foot">
                    <span>Reply</span>
                    <button className="icon-button small" aria-label="Remove this reply" onClick={() => removeCard(session.info.id, c.id)}>
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="prompt-row">
          <textarea
            ref={area}
            rows={1}
            value={text}
            placeholder={fresh ? 'Describe a task or ask a question' : 'Type / for commands'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running && session ? (
            <button className="send stop" aria-label="Stop" title="Stop" onClick={() => void cancel(session.info.id)}>
              <Icon name="stop" size={14} />
            </button>
          ) : (
            <button className="send" aria-label="Send" disabled={!canSend} onClick={send}>
              <Icon name="send" size={16} />
            </button>
          )}
          </div>
        </div>
        <div className="under-row">
          <button className="icon-button" aria-label="Attach">
            <Icon name="plus" size={16} />
          </button>
          {session && session.modes.available.length > 0 ? (
            <Menu
              trigger={<span>{session.modes.available.find((m) => m.id === session.modes.current)?.name ?? 'Mode'}</span>}
              items={session.modes.available.map((m) => ({ key: m.id, label: m.name, detail: m.description ?? undefined, selected: m.id === session.modes.current }))}
              onPick={(modeId) => void setMode(session.info.id, modeId)}
            />
          ) : (
            <span className="picker muted" title="The harness's modes appear once the session has started">
              Default
            </span>
          )}
          <span className="spacer" />
          <Menu
            align="end"
            trigger={<span className="mono">{model ?? 'Choose Model'}</span>}
            empty="Ollama has no models, or is not running."
            items={models.map((m) => ({
              key: m.name,
              label: <span className="mono">{m.name}</span>,
              detail: [m.parameterSize, m.quantization, gb(m.sizeBytes)].filter(Boolean).join(' · '),
              selected: m.name === model,
            }))}
            onPick={(name) => (fresh ? draft.setModel(name) : void setModel(session.info.id, name))}
          />
          <Menu
            align="end"
            trigger={<span>{effort === 'on' ? 'Thinking' : 'No Thinking'}</span>}
            items={[
              { key: 'on', label: 'Thinking', detail: 'Reasons before it answers', selected: effort === 'on' },
              { key: 'off', label: 'No Thinking', detail: 'Answers straight away', selected: effort === 'off' },
            ]}
            onPick={(k) => {
              const next = k === 'on' ? 'on' : 'off';
              if (fresh) draft.setEffort(next);
              else void setEffort(session.info.id, next);
            }}
          />
          {rate && <span className="mono rate">{rate}</span>}
          <ContextLeaves used={used} window={windowSize} />
        </div>
      </div>
    </div>
  );
}
