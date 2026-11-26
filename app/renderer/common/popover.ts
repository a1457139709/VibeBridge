import { useRef, useState } from 'react';
import { useDismissalWhileOpen } from './dismissal';

export function usePopover<Root extends HTMLElement>() {
  const [open, setOpen] = useState(false);
  const root = useRef<Root>(null);
  const close = () => setOpen(false);
  useDismissalWhileOpen(open, {
    contains: target => !!root.current?.contains(target),
    dismiss: close,
    dismissOnEscape: { beforeOtherHandlers: true, dismiss: close },
  });
  return { open, setOpen, root };
}
