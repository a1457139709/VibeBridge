import { useRef, useState } from 'react';
import { useDocumentEvent } from './document-events';
import { Timeout } from './timer';

const showDelay = 400;
const gap = 6,
  margin = 8;
const hinted = (target: EventTarget | null) => {
  const found = target instanceof Element ? target.closest('[data-hint]') : null;
  return found instanceof HTMLElement ? found : null;
};

function placeHint(hint: HTMLElement, anchor: HTMLElement) {
  const box = anchor.getBoundingClientRect(),
    own = hint.getBoundingClientRect();
  const below = box.bottom + gap + own.height <= window.innerHeight - margin;
  const left = Math.min(
    Math.max(margin, box.left + box.width / 2 - own.width / 2),
    window.innerWidth - margin - own.width,
  );
  hint.style.left = `${left}px`;
  hint.style.top = `${below ? box.bottom + gap : box.top - gap - own.height}px`;
}

export function HoverHints() {
  const [anchor, setAnchor] = useState<HTMLElement>();
  const [waiting, setWaiting] = useState<{ element: HTMLElement; delay: number; request: number }>();
  const requests = useRef(0);
  const hovered = useRef<HTMLElement | null>(null);
  const focused = useRef<HTMLElement | null>(null);
  const show = (element: HTMLElement, delay: number) => setWaiting({ element, delay, request: ++requests.current });
  const hide = () => {
    setWaiting(undefined);
    setAnchor(focused.current ?? undefined);
  };
  useDocumentEvent('pointerover', event => {
    const element = hinted(event.target);
    if (element === hovered.current) return;
    hovered.current = element;
    if (element) {
      setAnchor(undefined);
      show(element, showDelay);
    } else hide();
  });
  useDocumentEvent('pointerout', event => {
    if (hinted(event.relatedTarget)) return;
    hovered.current = null;
    hide();
  });
  useDocumentEvent(
    'pointerdown',
    () => {
      focused.current = null;
      hide();
    },
    { capture: true },
  );
  useDocumentEvent('focusin', event => {
    const element = hinted(event.target);
    focused.current = element?.matches(':focus-visible') ? element : null;
    if (focused.current) show(focused.current, 0);
    else if (!hovered.current) hide();
  });
  useDocumentEvent('focusout', () => {
    focused.current = null;
    if (!hovered.current) hide();
  });
  return (
    <>
      {waiting && (
        <Timeout
          key={waiting.request}
          delay={waiting.delay}
          onTimeout={() => {
            setAnchor(waiting.element);
            setWaiting(undefined);
          }}
        />
      )}
      {anchor?.isConnected && anchor.dataset.hint && (
        <div
          ref={hint => {
            if (hint) placeHint(hint, anchor);
          }}
          role="tooltip"
          className="hover-hint"
        >
          {anchor.dataset.hint}
        </div>
      )}
    </>
  );
}
