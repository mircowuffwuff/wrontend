// the prompt box with what sits above it (new session only) and the pickers below it

import { useEffect, useRef, useState } from 'react';
import { bridge } from '../bridge';
import type { ComponentState, HarnessEntry } from '@shared/components';
import type { ModelEntry, ModelReasoning } from '@shared/ollama';
import { useBrowser } from '../state/browser';
import { confirm } from '../state/confirm';
import { useDraft } from '../state/draft';
import { isReady, useHarnesses } from '../state/harnesses';
import { useOllama } from '../state/ollama';
import { composeMessage, useQuotes, type QuoteCard } from '../state/quotes';
import { useSessions, type SessionView } from '../state/sessions';
import { errorText } from '../state/settings';
import { HarnessIcon } from './HarnessIcon';
import { Icon } from './Icon';
import { ContextLeaves, Leaf } from './Leaf';
import { Menu } from './Menu';
import { PermissionPrompt } from './Permission';

// one shared empty list: a selector that returns a new array each time makes zustand re-render without end
const NO_CARDS: QuoteCard[] = [];

function gb(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

function mb(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

// npm writes only its own small files while it resolves; the size is worth showing once the downloads land
const SHOWN_FROM = 1e6;

function describe(state: ComponentState): string {
  switch (state.status) {
    case 'installed':
      return state.version ? `Version ${state.version}` : 'Built into wrontend';
    case 'missing':
      return 'Not set up yet · downloads when picked';
    case 'installing':
      return state.bytes >= SHOWN_FROM ? `${state.step} · ${mb(state.bytes)}` : `${state.step}…`;
    case 'failed':
      return 'Setup failed · pick it to try again';
  }
}

// the harness for a new session; a harness that is not set up is set up by picking it
function HarnessChip() {
  const list = useHarnesses((s) => s.list);
  const install = useHarnesses((s) => s.install);
  const { harness: picked, setHarness } = useDraft();
  const current = list.find((h) => h.id === picked);

  let trigger = <>Choose Harness</>;
  // a failed setup keeps the harness's name: the error under the chips says what went wrong with it
  if (current?.state.status === 'installed' || current?.state.status === 'failed') trigger = <>{current.name}</>;
  if (current?.state.status === 'installing') {
    const { bytes } = current.state;
    trigger = (
      <>
        <Leaf size={9} style={{ animation: 'sway 1.6s ease-in-out infinite' }} />
        Setting up {current.name}
        {bytes >= SHOWN_FROM && <span className="mono">{mb(bytes)}</span>}
      </>
    );
  }

  return (
    <Menu
      triggerClass="chip outline harness-chip"
      title="The harness is chosen before the first prompt and stays for the session"
      trigger={
        <>
          <HarnessIcon harness={current?.id} size={14} />
          {trigger}
        </>
      }
      items={list.map((h) => ({ key: h.id, label: h.name, detail: describe(h.state), selected: h.id === picked }))}
      empty="No harnesses are known."
      onPick={(id) => {
        setHarness(id);
        const status = list.find((h) => h.id === id)?.state.status;
        if (status === 'missing' || status === 'failed') void install(id);
      }}
    />
  );
}

function SetupFailed({ harness }: { harness: HarnessEntry }) {
  const [open, setOpen] = useState(false);
  const install = useHarnesses((s) => s.install);
  if (harness.state.status !== 'failed') return null;
  const { error, detail } = harness.state;
  return (
    <div className="error-block setup-failed">
      <div className="setup-failed-row">
        <button className="tool-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Leaf size={9} color="var(--remove)" />
          <span>
            {harness.name} could not be set up. {error}
          </span>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        </button>
        <button className="button" onClick={() => void install(harness.id)}>
          Try Again
        </button>
      </div>
      {open && <pre className="mono">{detail}</pre>}
    </div>
  );
}

// why a model loses its earlier reasoning, or null when it keeps it
function lostReason(reasoning: ModelReasoning): string | null {
  if (reasoning.status === 'lost') return reasoning.reason;
  if (reasoning.status === 'derived' && reasoning.state.status === 'failed') return `${reasoning.state.error} ${reasoning.state.detail}`;
  return null;
}

// a model that keeps its reasoning says nothing; a copy being made says so, and a model that loses it is warned about
function ReasoningNote({ reasoning }: { reasoning: ModelReasoning }) {
  if (reasoning.status === 'derived' && reasoning.state.status === 'installing') return <span className="reasoning-note">{reasoning.state.step}…</span>;
  const lost = lostReason(reasoning);
  if (!lost) return null;
  return (
    <span className="reasoning-note warning" title={lost}>
      <Icon name="warning" size={12} />
      Loses its earlier reasoning
    </span>
  );
}

// why a model cannot be deleted now, or null when it can
function deleteRefused(entry: ModelEntry): string | null {
  const working = Object.values(useSessions.getState().sessions).some((s) => s.running && s.info.model === entry.name);
  if (working) return 'A session is working with this model';
  if (entry.reasoning.status === 'derived' && entry.reasoning.state.status === 'installing') return 'A copy of this model is being made';
  return null;
}

// the trash button: says what goes and which sessions need another model, and deletes only on the dialog's red button.
// resolves to an error to show, or null
async function deleteModel(entry: ModelEntry): Promise<string | null> {
  const users = Object.values(useSessions.getState().sessions)
    .filter((s) => s.info.model === entry.name)
    .map((s) => s.info.title);
  const copy = entry.reasoning.status === 'derived' && entry.reasoning.state.status === 'installed';
  const what = `${entry.name} is deleted from Ollama${copy ? ', with the copy wrontend made of it to keep its reasoning' : ''}.`;
  const ok = await confirm({
    title: 'Delete Model?',
    message:
      users.length === 0
        ? `${what} Its files are removed unless another model shares them.`
        : `${what} ${users.length === 1 ? 'This session uses it, and needs another model for its next message:' : 'These sessions use it, and need another model for their next message:'}`,
    items: users,
    action: 'Delete Model',
  });
  if (!ok) return null;
  try {
    await bridge.invoke('ollama:delete', entry.name);
  } catch (cause) {
    return `${entry.name} could not be deleted. ${errorText(cause)}`;
  }
  if (useDraft.getState().model === entry.name) useDraft.getState().setModel(null);
  return null;
}

export function Composer({ session }: { session: SessionView | null }) {
  const [text, setText] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  const harness = useHarnesses((s) => s.list.find((h) => h.id === draft.harness));
  const picked = models.find((m) => m.name === model);
  const pickedNote = picked ? lostReason(picked.reasoning) : null;
  const canSend =
    (text.trim().length > 0 || cards.length > 0) && !!model && (!fresh || (!!draft.folder && isReady(harness))) && !running;

  const send = () => {
    if (!canSend || !model) return;
    const value = composeMessage(cards, text);
    setText('');
    if (fresh) void createAndPrompt({ harness: harness!.id, folder: draft.folder!, model, effort }, value);
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
            <HarnessChip />
            <button className="chip outline" onClick={() => void pickFolder()} title={draft.folder ?? undefined}>
              <Icon name="folder" size={14} />
              {draft.folder ? draft.folder.split(/[\\/]/).pop() : 'Choose Folder'}
            </button>
          </div>
        )}
        {fresh && harness?.state.status === 'failed' && <SetupFailed harness={harness} />}
        {deleteError && (
          <div className="error-block setup-failed">
            <div className="setup-failed-row">
              <span className="tool-summary">
                <Leaf size={9} color="var(--remove)" />
                <span>{deleteError}</span>
              </span>
              <button className="icon-button small" aria-label="Dismiss" onClick={() => setDeleteError(null)}>
                <Icon name="close" size={14} />
              </button>
            </div>
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
            trigger={
              <span className="model-trigger">
                {pickedNote && <Icon name="warning" size={14} />}
                <span className="mono">{model ?? 'Choose Model'}</span>
              </span>
            }
            title={pickedNote ?? undefined}
            empty="Ollama has no models, or is not running."
            footer={{ icon: 'globe', label: 'Browse Models', run: () => useBrowser.getState().show() }}
            items={models.map((m) => ({
              key: m.name,
              label: <span className="mono">{m.name}</span>,
              detail: (
                <>
                  {[m.parameterSize, m.quantization, gb(m.sizeBytes)].filter(Boolean).join(' · ')}
                  <ReasoningNote reasoning={m.reasoning} />
                </>
              ),
              selected: m.name === model,
              action: {
                icon: 'trash',
                label: 'Delete Model',
                danger: true,
                refused: deleteRefused(m) ?? undefined,
                run: () => {
                  setDeleteError(null);
                  void deleteModel(m).then(setDeleteError);
                },
              },
            }))}
            onPick={(name) => {
              // a copy with a renderer, where the model needs one, is made now rather than on the first request
              void bridge.invoke('ollama:prepare', name);
              if (fresh) draft.setModel(name);
              else void setModel(session.info.id, name);
            }}
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
