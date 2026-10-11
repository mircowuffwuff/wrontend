// Canopy's signature shape: a leaf, two opposite corners rounded and two sharp

import type { CSSProperties } from 'react';

export function Leaf({ size = 9, color = 'var(--accent)', style }: { size?: number; color?: string; style?: CSSProperties }) {
  return <i className="leaf" aria-hidden="true" style={{ width: size, height: size, background: color, ...style }} />;
}

// the context meter: three leaves that fill in turn as the window fills
export function ContextLeaves({ used, window }: { used: number | null; window: number | null }) {
  const share = used !== null && window ? Math.min(1, used / window) : 0;
  const filled = share === 0 ? 0 : Math.ceil(share * 3);
  const near = share >= 0.85;
  const label =
    used !== null && window ? `${used.toLocaleString()} of ${window.toLocaleString()} tokens of context used` : 'No context used yet';
  return (
    <span title={label} aria-label={label} style={{ display: 'inline-flex', gap: 3, padding: '0 6px' }}>
      {[0, 1, 2].map((i) => (
        <Leaf key={i} size={8} color={i < filled ? (near ? 'var(--remove)' : 'var(--accent)') : 'var(--line)'} />
      ))}
    </span>
  );
}
