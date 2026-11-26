import { useEffect, useEffectEvent } from 'react';

export function useResizeObserver(element: Element | null, resized: (entry: ResizeObserverEntry) => void) {
  const observed = useEffectEvent(resized);
  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) observed(entry);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
}
