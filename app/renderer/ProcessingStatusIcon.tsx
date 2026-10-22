import type { ReactNode } from 'react';
import type { ProcessingState } from '../shared/processing-status';

export const processingLabels: Record<ProcessingState, string> = {
  ready: 'Ready', busy: 'Busy', 'needs-input': 'Needs input', done: 'Done', error: 'Error',
};
const shapes: Record<ProcessingState, ReactNode> = {
  ready: <circle cx="10" cy="10" r="6.5" />,
  busy: <path d="M10 3.5a6.5 6.5 0 0 1 5.6 3.2M15.6 13.3a6.5 6.5 0 0 1-5.6 3.2M4.4 13.3a6.5 6.5 0 0 1 0-6.6" />,
  'needs-input': <path d="M4 3.5h12a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4.5 3v-3H4A1.5 1.5 0 0 1 2.5 13V5A1.5 1.5 0 0 1 4 3.5Z" />,
  done: <path d="m3.5 10 4.2 4.2 8.8-8.8" />,
  error: <><path d="m6.5 2.5 7 0 4 4v7l-4 4h-7l-4-4v-7Z" /><path d="m7.5 7.5 5 5m0-5-5 5" /></>,
};

export function ProcessingStatusIcon({ state, focusable = false }: { state?: ProcessingState; focusable?: boolean }) {
  if (!state) return null;
  const label = processingLabels[state];
  return <span className={`processing-status processing-${state}`} role="img" aria-label={label} title={label}
    tabIndex={focusable ? 0 : undefined} onPointerDown={event => { if (focusable) event.stopPropagation(); }}
    onClick={event => { if (focusable) event.stopPropagation(); }}>
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[state]}</svg>
  </span>;
}
