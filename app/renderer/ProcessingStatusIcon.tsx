import { useLocalization } from './Localization';
import type { AnimationEvent, ReactNode } from 'react';
import type { ProcessingState } from '../shared/processing-status';

const ring = <circle cx="10" cy="10" r="7" />;
const shapes: Record<ProcessingState, ReactNode> = {
  ready: ring,
  busy: <><circle cx="10" cy="10" r="7" opacity=".3" /><path d="M10 3a7 7 0 0 1 7 7" /></>,
  'needs-input': <>{ring}<path d="M10 6.5v4M10 13.5h.01" /></>,
  done: <>{ring}<path d="m7 10.2 2 2 4-4.2" /></>,
  error: <>{ring}<path d="m7.5 7.5 5 5m0-5-5 5" /></>,
};
// Anchoring each Busy rotation to the document timeline origin keeps every Busy icon in one phase,
// however late its animation starts; it also re-anchors after reduced motion is lifted.
function alignRotation(event: AnimationEvent<HTMLElement>) {
  for (const animation of (event.target as Element).getAnimations()) animation.startTime = 0;
}

export function ProcessingStatusIcon({ state, focusable = false }: { state?: ProcessingState; focusable?: boolean }) {
  const { t } = useLocalization();
  if (!state) return null;
  const label = t(state);
  return <span className={`processing-status processing-${state}`} role="img" aria-label={label} title={label}
    onAnimationStart={alignRotation}
    tabIndex={focusable ? 0 : undefined} onPointerDown={event => { if (focusable) event.stopPropagation(); }}
    onClick={event => { if (focusable) event.stopPropagation(); }}>
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[state]}</svg>
  </span>;
}
