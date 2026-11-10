import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Native `title` tooltips do not show in the workbench window, so the app draws its own hover hints.
// Any element marks its hint with `data-hint`; the innermost hinted element under the pointer or
// keyboard focus wins, so a status icon inside a tray card shows its own hint.
const showDelay = 400;
const gap = 6, margin = 8;
const hinted = (target: EventTarget | null) => (target as Element | null)?.closest?.<HTMLElement>('[data-hint]') ?? null;

/** Shows the hint of the hovered or keyboard-focused element, below it or above it near the window bottom. */
export function HoverHints() {
  const [anchor, setAnchor] = useState<HTMLElement>();
  const hint = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The hovered hint wins; without one, the keyboard-focused element keeps its hint.
    let hovered: HTMLElement | null = null, focused: HTMLElement | null = null;
    const show = (element: HTMLElement, delay: number) => { clearTimeout(timer); timer = setTimeout(() => setAnchor(element), delay); };
    const hide = () => { clearTimeout(timer); setAnchor(focused ?? undefined); };
    const over = (event: PointerEvent) => {
      const element = hinted(event.target);
      if (element === hovered) return;
      hovered = element;
      if (element) { setAnchor(undefined); show(element, showDelay); } else hide();
    };
    const leave = (event: PointerEvent) => {
      if (hinted(event.relatedTarget)) return;
      hovered = null; hide();
    };
    // Pressing starts a click or a drag; the hint steps aside until the pointer enters another element.
    const press = () => { focused = null; hide(); };
    const focus = (event: FocusEvent) => {
      const element = hinted(event.target);
      focused = element?.matches(':focus-visible') ? element : null;
      if (focused) show(focused, 0); else if (!hovered) hide();
    };
    const blur = () => { focused = null; if (!hovered) hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', leave);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', leave);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
    };
  }, []);
  // The hint text follows its element on every render (a status change renames a panel's hint), so its place does too.
  useLayoutEffect(() => {
    const element = hint.current;
    if (!anchor || !element) return;
    const box = anchor.getBoundingClientRect(), own = element.getBoundingClientRect();
    const below = box.bottom + gap + own.height <= window.innerHeight - margin;
    const left = Math.min(Math.max(margin, box.left + box.width / 2 - own.width / 2), window.innerWidth - margin - own.width);
    element.style.left = `${left}px`;
    element.style.top = `${below ? box.bottom + gap : box.top - gap - own.height}px`;
  });
  if (!anchor?.isConnected || !anchor.dataset.hint) return null;
  return <div ref={hint} role="tooltip" className="hover-hint">{anchor.dataset.hint}</div>;
}
