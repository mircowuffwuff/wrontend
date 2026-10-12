// the confirmation dialog: says what an action stops or removes, and goes ahead only on its own red button.
// Cancel has the focus, so Enter and Escape both leave things as they are

import { useEffect } from 'react';
import { answer, useConfirm } from '../state/confirm';

export function ConfirmDialog() {
  const request = useConfirm((s) => s.request);

  useEffect(() => {
    if (!request) return;
    // on the window, in the capture phase: the dialog underneath must not take the same Escape
    const escape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      answer(false);
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [request]);

  if (!request) return null;
  return (
    <div className="dialog-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && answer(false)}>
      <div className="confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
        <h2 id="confirm-title">{request.title}</h2>
        <p id="confirm-message">{request.message}</p>
        {request.items && request.items.length > 0 && (
          <ul className="confirm-items">
            {request.items.map((item, n) => (
              <li key={n}>{item}</li>
            ))}
          </ul>
        )}
        <div className="confirm-actions">
          <button className="button" autoFocus onClick={() => answer(false)}>
            Cancel
          </button>
          <button className="button danger strong" onClick={() => answer(true)}>
            {request.action}
          </button>
        </div>
      </div>
    </div>
  );
}
