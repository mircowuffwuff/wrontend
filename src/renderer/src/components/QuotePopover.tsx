// selecting text in the transcript opens this: the selection as a quote, and a field for the reply to it

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQuotes } from '../state/quotes';
import { Icon } from './Icon';

interface Anchor {
  quote: string;
  left: number;
  // one of the two: above the selection the popover grows upwards from its bottom edge
  top?: number;
  bottom?: number;
}

const WIDTH = 380;

export function QuotePopover({ sessionId, container }: { sessionId: string; container: RefObject<HTMLElement | null> }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [reply, setReply] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const add = useQuotes((s) => s.add);

  useEffect(() => {
    const onMouseUp = (e: MouseEvent) => {
      if (box.current?.contains(e.target as Node)) return;
      // wait for the browser to settle the selection the click made
      setTimeout(() => {
        const selection = window.getSelection();
        const text = selection?.toString().trim() ?? '';
        const root = container.current;
        if (!selection || !text || selection.rangeCount === 0 || !root || !root.contains(selection.anchorNode)) {
          setAnchor(null);
          return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const left = Math.min(Math.max(12, rect.left + rect.width / 2 - WIDTH / 2), window.innerWidth - WIDTH - 12);
        // above the selection where there is room, otherwise below it
        const above = rect.top > 160;
        setAnchor(above ? { quote: text, left, bottom: window.innerHeight - rect.top + 8 } : { quote: text, left, top: rect.bottom + 8 });
        setReply('');
      });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [container]);

  if (!anchor) return null;

  const submit = () => {
    add(sessionId, anchor.quote, reply);
    setAnchor(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div className="quote-popover" ref={box} style={{ left: anchor.left, top: anchor.top, bottom: anchor.bottom, width: WIDTH }} role="dialog" aria-label="Reply to the selected text">
      <div className="quote-text">{anchor.quote}</div>
      <div className="quote-input">
        <input
          autoFocus
          value={reply}
          placeholder="Reply to this…"
          onChange={(e) => setReply(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              setAnchor(null);
            }
          }}
        />
        <button className="icon-button" aria-label="Add the reply" title="Add the reply" onClick={submit}>
          <Icon name="plus" size={16} />
        </button>
      </div>
    </div>
  );
}
