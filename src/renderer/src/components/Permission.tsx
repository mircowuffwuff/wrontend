// a permission request, docked above the prompt box: reject on the left, allow once as the primary, the rest behind a chevron

import { useEffect, useState } from 'react';
import type { PermissionOption } from '@agentclientprotocol/sdk';
import type { PermissionRequest } from '@shared/session';
import { Icon } from './Icon';
import { InputView } from './InputView';

function order(options: PermissionOption[]) {
  const reject = options.find((o) => o.kind === 'reject_once') ?? options.find((o) => o.kind.startsWith('reject'));
  const primary = options.find((o) => o.kind === 'allow_once') ?? options.find((o) => o.kind.startsWith('allow'));
  const rest = options.filter((o) => o !== reject && o !== primary);
  return { reject, primary, rest };
}

export function PermissionPrompt({ request, onAnswer }: { request: PermissionRequest; onAnswer: (optionId: string | null) => void }) {
  const [more, setMore] = useState(false);
  const { reject, primary, rest } = order(request.options);

  // the reference's keys: 1 rejects, 2 or Ctrl+Enter allows once, Esc dismisses
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement | null)?.tagName === 'TEXTAREA' && !e.ctrlKey;
      if (e.key === 'Escape') onAnswer(reject?.optionId ?? null);
      else if (typing) return;
      else if (e.key === '1' && reject) onAnswer(reject.optionId);
      else if ((e.key === '2' || (e.key === 'Enter' && e.ctrlKey)) && primary) onAnswer(primary.optionId);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reject, primary, onAnswer]);

  return (
    <div className="permission" role="dialog" aria-label="Permission request">
      <div className="permission-question">Allow {request.toolCall.title ?? 'this action'}?</div>
      <div className="permission-input">
        <InputView input={request.toolCall.rawInput} />
      </div>
      <div className="permission-actions">
        {reject && (
          <button className="button" onClick={() => onAnswer(reject.optionId)}>
            {reject.name} <kbd>1</kbd> <kbd>Esc</kbd>
          </button>
        )}
        <span className="spacer" />
        {primary && (
          <span className="split">
            <button className="button primary" autoFocus onClick={() => onAnswer(primary.optionId)}>
              {primary.name} <kbd>2</kbd> <kbd>Ctrl ↵</kbd>
            </button>
            {rest.length > 0 && (
              <button className="button primary chevron" aria-label="More options" onClick={() => setMore((m) => !m)}>
                <Icon name="chevronDown" size={14} />
              </button>
            )}
            {more && (
              <div className="menu above end">
                {rest.map((o) => (
                  <button key={o.optionId} className="menu-item" onClick={() => onAnswer(o.optionId)}>
                    <span className="label">{o.name}</span>
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
