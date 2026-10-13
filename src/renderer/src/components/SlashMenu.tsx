// the harness's slash commands, listed above the prompt box while a command name is typed: names only, the active
// one's description in a tooltip beside the list. the prompt box keeps the focus and drives it with its keys

import { useLayoutEffect, useRef, useState } from 'react';
import type { CommandMatch } from '../state/commands';

function Name({ match, length }: { match: CommandMatch; length: number }) {
  const { name } = match.command;
  if (match.at === null || length === 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, match.at)}
      <strong>{name.slice(match.at, match.at + length)}</strong>
      {name.slice(match.at + length)}
    </>
  );
}

export function SlashMenu({
  matches,
  query,
  active,
  onActive,
  onPick,
}: {
  matches: CommandMatch[];
  query: string;
  active: number;
  onActive: (index: number) => void;
  onPick: (index: number) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);
  // where the tooltip sits, level with the active row; null while that row is scrolled out of sight
  const [tipTop, setTipTop] = useState<number | null>(null);
  // more rows below the visible ones: the last visible row fades
  const [more, setMore] = useState(false);

  const place = () => {
    const el = list.current;
    const row = rows.current[active];
    if (!el) return;
    // measured to the last row rather than the list's end: scrolling a row into view leaves the padding under it hidden
    const last = rows.current[matches.length - 1];
    setMore(!!last && last.offsetTop + last.offsetHeight > el.scrollTop + el.clientHeight + 1);
    if (!row) return setTipTop(null);
    const top = row.offsetTop - el.scrollTop;
    setTipTop(top < 0 || top + row.offsetHeight > el.clientHeight ? null : el.clientTop + top);
  };

  useLayoutEffect(() => {
    rows.current[active]?.scrollIntoView({ block: 'nearest' });
    place();
  }, [active, matches]);

  const description = matches[active]?.command.description;

  return (
    <div className="slash-menu">
      <div ref={list} className={`menu${more ? ' more' : ''}`} role="listbox" aria-label="Commands" onScroll={place}>
        {matches.map((match, i) => (
          <button
            key={match.command.name}
            ref={(el) => {
              rows.current[i] = el;
            }}
            role="option"
            aria-selected={i === active}
            className={`menu-item${i === active ? ' active' : ''}`}
            // the prompt box keeps the focus
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => i !== active && onActive(i)}
            onClick={() => onPick(i)}
          >
            <span className="label">
              <Name match={match} length={query.length} />
            </span>
          </button>
        ))}
      </div>
      {description && tipTop !== null && (
        <div className="slash-tip" role="tooltip" style={{ top: tipTop }}>
          {description}
        </div>
      )}
    </div>
  );
}
