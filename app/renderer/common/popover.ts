import { useRef, useState } from 'react';
import { useEventListener } from './effects/event-listener';

export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  const listening = open ? document : null;
  useEventListener(listening, 'pointerdown', event => {
    if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
  });
  useEventListener(
    listening,
    'keydown',
    event => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    },
    { capture: true },
  );
  return { open, setOpen, root };
}
