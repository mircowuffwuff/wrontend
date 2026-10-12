// a small popover list anchored above or below its trigger

import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface MenuItem {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  selected?: boolean;
}

export function Menu({
  trigger,
  items,
  onPick,
  placement = 'above',
  align = 'start',
  empty,
  triggerClass = 'picker',
  title,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  onPick: (key: string) => void;
  placement?: 'above' | 'below';
  align?: 'start' | 'end';
  empty?: ReactNode;
  triggerClass?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button className={triggerClass} title={title} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div className={`menu ${placement} ${align}`} role="listbox">
          {items.length === 0 && <div className="menu-empty">{empty}</div>}
          {items.map((item) => (
            <button
              key={item.key}
              role="option"
              aria-selected={item.selected}
              className={`menu-item${item.selected ? ' selected' : ''}`}
              onClick={() => {
                setOpen(false);
                onPick(item.key);
              }}
            >
              <span className="label">{item.label}</span>
              {item.detail && <span className="detail">{item.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
