import { useEventListener } from './effects/event-listener';

interface Dismissal {
  contains(target: Node): boolean;
  dismiss(): void;
  dismissOnEscape?: { beforeOtherHandlers: boolean; dismiss(): void };
}

export function useDismissalWhileOpen(open: boolean, { contains, dismiss, dismissOnEscape }: Dismissal) {
  useEventListener(open ? document : null, 'pointerdown', event => {
    if (!(event.target instanceof Node && contains(event.target))) dismiss();
  });
  useEventListener(
    open && dismissOnEscape ? document : null,
    'keydown',
    event => {
      if (event.key !== 'Escape' || !dismissOnEscape) return;
      event.preventDefault();
      event.stopPropagation();
      dismissOnEscape.dismiss();
    },
    { capture: dismissOnEscape?.beforeOtherHandlers ?? false },
  );
}
