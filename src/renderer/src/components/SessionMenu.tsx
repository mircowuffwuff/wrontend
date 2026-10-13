// a session's menu, the same two items wherever it opens: the top bar's title and a sidebar row's ⋮. Rename turns the
// title into a field where the menu was opened; Delete asks first

import { useRef, useState, type ReactNode } from 'react';
import { confirm } from '../state/confirm';
import { useSessions, type SessionView } from '../state/sessions';
import { Menu, type MenuItem } from './Menu';

const ITEMS: MenuItem[] = [
  { key: 'rename', label: 'Rename', shortcut: 'R' },
  { key: 'delete', label: 'Delete', shortcut: 'D', danger: true, rule: true },
];

async function deleteSession(session: SessionView): Promise<void> {
  const ok = await confirm({
    title: 'Delete Session?',
    message: `“${session.info.title}” is removed from wrontend${session.running ? ', and its reply stops' : ''}. The harness keeps its own history of it.`,
    action: 'Delete Session',
  });
  if (ok) await useSessions.getState().remove(session.info.id);
}

export function SessionMenu({
  session,
  trigger,
  triggerClass,
  title,
  align,
  fixed,
  onRename,
}: {
  session: SessionView;
  trigger: ReactNode;
  triggerClass?: string;
  title?: string;
  align?: 'start' | 'end';
  fixed?: boolean;
  onRename: () => void;
}) {
  return (
    <Menu
      placement="below"
      align={align}
      fixed={fixed}
      trigger={trigger}
      triggerClass={triggerClass}
      title={title}
      menuClass="session-menu"
      items={ITEMS}
      onPick={(key) => {
        if (key === 'rename') onRename();
        else if (key === 'delete') void deleteSession(session);
      }}
    />
  );
}

// the title, editable: Enter or leaving the field keeps the new one, Esc keeps the old. an empty or unchanged title
// changes nothing
export function TitleField({ session, onDone }: { session: SessionView; onDone: () => void }) {
  const [value, setValue] = useState(session.info.title);
  const done = useRef(false);
  const finish = (keep: boolean) => {
    if (done.current) return;
    done.current = true;
    const title = value.trim();
    if (keep && title && title !== session.info.title) void useSessions.getState().rename(session.info.id, title);
    onDone();
  };
  return (
    <input
      className="title-field"
      aria-label="Session title"
      autoFocus
      spellCheck={false}
      value={value}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
        else return;
        // handled here: a permission request waiting below must not take the same Esc
        e.preventDefault();
        e.stopPropagation();
      }}
    />
  );
}
