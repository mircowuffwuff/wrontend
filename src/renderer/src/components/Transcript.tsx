// the session's transcript: messages, thinking, grouped tool calls, the files a turn edited, plans, errors -- and the scroll that follows it

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionView } from '../state/sessions';
import { group, type TranscriptItem } from '../state/transcript';
import { EditedFiles } from './EditedFiles';
import { Icon } from './Icon';
import { Leaf } from './Leaf';
import { Markdown } from './Markdown';
import { QuotePopover } from './QuotePopover';
import { ToolGroup } from './Tools';

function duration(ms: number): string {
  if (ms < 1000) return '<1s';
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function Thought({ item, now }: { item: Extract<TranscriptItem, { kind: 'thought' }>; now: number }) {
  const [open, setOpen] = useState(false);
  const live = item.endedAt === null;
  const took = duration((item.endedAt ?? now) - item.startedAt);
  return (
    <div className="thought">
      <button className="tool-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Leaf size={9} color="var(--olive)" style={live ? { animation: 'sway 1.6s ease-in-out infinite' } : undefined} />
        <span>{live ? `Thinking… ${took}` : `Thought for ${took}`}</span>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
      </button>
      {open && <div className="thought-text">{item.text}</div>}
    </div>
  );
}

// a long message is clipped to a few lines, with Show more under it; whether it is long is measured, so a narrow window
// clips a message a wide one shows whole
function UserMessage({ text }: { text: string }) {
  const body = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    // measured while clipped: an open message keeps whatever it was
    const measure = () => {
      if (!el.classList.contains('clip')) return;
      setLong(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);
  return (
    <div className="user-message">
      <div ref={body} className={open ? 'user-text' : `user-text clip${long ? ' faded' : ''}`}>
        <Markdown text={text} />
      </div>
      {long && (
        <button className="show-more" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function ErrorBlock({ item }: { item: Extract<TranscriptItem, { kind: 'error' }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="error-block">
      <button className="tool-summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Leaf size={9} color="var(--remove)" />
        <span>{item.message}</span>
        {item.detail && <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />}
      </button>
      {open && item.detail && <pre className="mono">{item.detail}</pre>}
    </div>
  );
}

export function Transcript({ session }: { session: SessionView }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const now = useNow(session.running);
  const blocks = group(session.items);
  const lastBlock = blocks[blocks.length - 1];

  // a message the user just sent always brings the view to the bottom, and so does opening a session
  const lastUser = [...session.items].reverse().find((i) => i.kind === 'user')?.id;
  useLayoutEffect(() => {
    setAtBottom(true);
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastUser, session.info.id]);

  // after that, new content is followed only while the view is already at the bottom
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom) el.scrollTop = el.scrollHeight;
  });

  // a permission request waits docked above the prompt box, and the transcript ends in a marker that says so
  const asking = session.permissions.length > 0;

  const onScroll = () => {
    const el = scroller.current;
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <div className="content" ref={scroller} onScroll={onScroll}>
      <div className="column transcript">
        {blocks.map((block) => {
          if (block.kind === 'tools') return <ToolGroup key={block.id} tools={block.tools} live={session.running && block === lastBlock} />;
          const item = block.item;
          switch (item.kind) {
            case 'user':
              return <UserMessage key={item.id} text={item.text} />;
            case 'assistant':
              return <Markdown key={item.id} text={item.text} />;
            case 'thought':
              return <Thought key={item.id} item={item} now={now} />;
            case 'plan':
              return (
                <ul key={item.id} className="plan">
                  {item.entries.map((e, i) => (
                    <li key={i} className={e.status}>
                      <Leaf size={8} color={e.status === 'completed' ? 'var(--add)' : e.status === 'in_progress' ? 'var(--accent)' : 'var(--line)'} />
                      {e.content}
                    </li>
                  ))}
                </ul>
              );
            case 'edits':
              return <EditedFiles key={item.id} files={item.files} />;
            case 'error':
              return <ErrorBlock key={item.id} item={item} />;
            case 'notice':
              return (
                <div key={item.id} className="notice muted">
                  {item.text}
                </div>
              );
          }
        })}
        {asking ? (
          <div className="needs-input">
            <Leaf size={9} color="var(--remove)" style={{ animation: 'pulse 1.4s ease-in-out infinite' }} />
            <span className="needs-input-tag">Needs your input</span>
          </div>
        ) : session.running && session.turnStartedAt !== null && lastBlock?.kind !== 'tools' && (
          <div className="working muted">
            <Leaf size={9} style={{ animation: 'sway 1.6s ease-in-out infinite' }} />
            Working… {duration(now - session.turnStartedAt)}
          </div>
        )}
      </div>
      <QuotePopover sessionId={session.info.id} container={scroller} />
      {!atBottom && (
        <button
          className="to-bottom"
          aria-label="Scroll to bottom"
          onClick={() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })}
        >
          <Icon name="chevronDown" />
        </button>
      )}
    </div>
  );
}
