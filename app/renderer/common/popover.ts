import { useEffect, useRef, useState } from 'react';

export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return { open, setOpen, root };
}
