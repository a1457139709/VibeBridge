import { useEffect, useEffectEvent } from 'react';

export function useChildListObserver(element: Element | null, changed: () => void) {
  const observed = useEffectEvent(changed);
  useEffect(() => {
    if (!element) return;
    const observer = new MutationObserver(() => observed());
    observer.observe(element, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [element]);
}
