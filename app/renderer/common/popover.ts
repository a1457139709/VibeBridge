import { useRef, useState } from 'react';
import { useDocumentEvent } from './document-events';

interface Dismissal {
  open: boolean;
  inside(target: Node): boolean;
  dismiss(by: 'pointer' | 'escape'): void;
}

export function useDismissal({ open, inside, dismiss }: Dismissal) {
  useDocumentEvent('pointerdown', event => {
    if (open && !(event.target instanceof Node && inside(event.target))) dismiss('pointer');
  });
  useDocumentEvent(
    'keydown',
    event => {
      if (!open || event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dismiss('escape');
    },
    { capture: true },
  );
}

export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  useDismissal({ open, inside: target => !!root.current?.contains(target), dismiss: () => setOpen(false) });
  return { open, setOpen, root };
}
