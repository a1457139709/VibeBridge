import { useRef, useState } from 'react';
import { useEventListener } from './effects/event-listener';
import { useTimeout } from './effects/timeout';
import { useElementMeasurement } from './effects/element-measurement';

const showDelay = 400;
const gap = 6,
  margin = 8;
const hinted = (target: EventTarget | null) => {
  const found = target instanceof Element ? target.closest('[data-hint]') : null;
  return found instanceof HTMLElement ? found : null;
};

export function HoverHints() {
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [awaited, setAwaited] = useState<{ element: HTMLElement; delay: number }>();
  const hovered = useRef<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);
  const hint = useRef<HTMLDivElement>(null);
  useTimeout(() => setAnchor(awaited?.element), { delay: awaited?.delay, restartKey: awaited });
  const show = (element: HTMLElement, delay: number) => setAwaited({ element, delay });
  const hide = () => {
    setAwaited(undefined);
    setAnchor(focused.current ?? undefined);
  };
  useEventListener(document, 'pointerover', event => {
    const element = hinted(event.target);
    if (element === hovered.current) return;
    hovered.current = element;
    if (element) {
      setAnchor(undefined);
      show(element, showDelay);
    } else hide();
  });
  useEventListener(document, 'pointerout', event => {
    if (hinted(event.relatedTarget)) return;
    hovered.current = null;
    hide();
  });
  useEventListener(
    document,
    'pointerdown',
    () => {
      focused.current = null;
      hide();
    },
    { capture: true },
  );
  useEventListener(document, 'focusin', event => {
    const element = hinted(event.target);
    focused.current = element?.matches(':focus-visible') ? element : null;
    if (focused.current) show(focused.current, 0);
    else if (!hovered.current) hide();
  });
  useEventListener(document, 'focusout', () => {
    focused.current = null;
    if (!hovered.current) hide();
  });
  useElementMeasurement(() => {
    const element = hint.current;
    if (!anchor || !element) return;
    const box = anchor.getBoundingClientRect(),
      own = element.getBoundingClientRect();
    const below = box.bottom + gap + own.height <= window.innerHeight - margin;
    const left = Math.min(
      Math.max(margin, box.left + box.width / 2 - own.width / 2),
      window.innerWidth - margin - own.width,
    );
    element.style.left = `${left}px`;
    element.style.top = `${below ? box.bottom + gap : box.top - gap - own.height}px`;
  });
  if (!anchor?.isConnected || !anchor.dataset.hint) return null;
  return (
    <div ref={hint} role="tooltip" className="hover-hint">
      {anchor.dataset.hint}
    </div>
  );
}
