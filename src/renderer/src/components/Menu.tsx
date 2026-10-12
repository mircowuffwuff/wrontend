// a small popover list anchored above or below its trigger

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface MenuItem {
  key: string;
  // drawn before the label, the detail lining up under the label
  icon?: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  selected?: boolean;
  // a button at the row's end that does something to the item instead of picking it
  action?: MenuAction;
}

export interface MenuAction {
  icon: IconName;
  label: string;
  // turns red when pointed at: the action removes something
  danger?: boolean;
  // a refused action keeps its button, and its title says why
  refused?: string;
  run: () => void;
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
  footer,
  fixed = false,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  onPick: (key: string) => void;
  placement?: 'above' | 'below';
  align?: 'start' | 'end';
  empty?: ReactNode;
  triggerClass?: string;
  title?: string;
  // an entry under the items that leads somewhere else, such as the model browser
  footer?: { icon: IconName; label: string; run: () => void };
  // placed against the window rather than its trigger, so a scrolling container around the trigger does not clip it; a
  // scroll closes it, since it would no longer sit by its trigger
  fixed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const scrolled = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    if (fixed) document.addEventListener('scroll', scrolled, true);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('scroll', scrolled, true);
    };
  }, [open, fixed]);

  const toggle = () => {
    if (!open && fixed && root.current) {
      const r = root.current.getBoundingClientRect();
      setPosition({
        ...(placement === 'below' ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
        ...(align === 'end' ? { right: window.innerWidth - r.right } : { left: r.left }),
      });
    }
    setOpen((o) => !o);
  };

  return (
    <div ref={root} style={{ position: 'relative' }}>
      <button className={triggerClass} title={title} aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>
        {trigger}
      </button>
      {open && (
        <div className={`menu ${fixed ? 'fixed' : `${placement} ${align}`}`} style={fixed ? position : undefined} role="listbox">
          {items.length === 0 && <div className="menu-empty">{empty}</div>}
          {items.map((item) => (
            <div key={item.key} className={`menu-row${item.selected ? ' selected' : ''}`}>
              <button
                role="option"
                aria-selected={item.selected}
                className={`menu-item${item.icon ? ' with-icon' : ''}`}
                onClick={() => {
                  setOpen(false);
                  onPick(item.key);
                }}
              >
                {item.icon && <span className="menu-icon">{item.icon}</span>}
                <span className="label">{item.label}</span>
                {item.detail && <span className="detail">{item.detail}</span>}
              </button>
              {item.action && <RowAction action={item.action} close={() => setOpen(false)} />}
            </div>
          ))}
          {footer && (
            <button
              className="menu-item menu-footer"
              onClick={() => {
                setOpen(false);
                footer.run();
              }}
            >
              <span className="label">
                <Icon name={footer.icon} size={15} />
                {footer.label}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// aria-disabled rather than disabled: a disabled button shows no tooltip, and the tooltip is what says why
function RowAction({ action, close }: { action: MenuAction; close: () => void }) {
  return (
    <button
      className={`icon-button small menu-action${action.danger ? ' danger' : ''}`}
      aria-label={action.label}
      aria-disabled={!!action.refused}
      title={action.refused ?? action.label}
      onClick={() => {
        if (action.refused) return;
        close();
        action.run();
      }}
    >
      <Icon name={action.icon} size={15} />
    </button>
  );
}
