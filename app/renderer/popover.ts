import { useEffect, useRef, useState } from 'react';

/** A popover's open state and the element that holds it and its trigger. It closes on a pointer down outside that
 * element or on Esc, which goes no further. */
export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  return { open, setOpen, root };
}
