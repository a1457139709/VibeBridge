import { useEffect, useLayoutEffect } from 'react';
import { useLatest } from './latest';

const observeWith =
  (useTimedEffect: typeof useEffect) => (target: Element | null | undefined, resized: ResizeObserverCallback) => {
    const latest = useLatest(resized);
    useTimedEffect(() => {
      if (!target) return;
      const observer = new ResizeObserver((entries, self) => latest.current(entries, self));
      observer.observe(target);
      return () => observer.disconnect();
    }, [target]);
  };

export const useResizeObserver = observeWith(useEffect);
export const useResizeObserverBeforePaint = observeWith(useLayoutEffect);
