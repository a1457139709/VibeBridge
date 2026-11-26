import { useRef, useState } from 'react';
import { useDocumentEvent } from './document-events';

export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  useDocumentEvent('pointerdown', event => {
    if (open && !(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
  });
  useDocumentEvent(
    'keydown',
    event => {
      if (open && event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    },
    { capture: true },
  );
  return { open, setOpen, root };
}
