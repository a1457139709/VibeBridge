import { useEffect, useRef } from 'react';
import { useLatest } from './latest';

interface Timing {
  delay: number | undefined;
  restartKey?: unknown;
  paused?: boolean;
}

export function useTimeout(callback: () => void, { delay, restartKey, paused = false }: Timing) {
  const latest = useLatest(callback);
  const remaining = useRef(delay);
  useEffect(() => {
    remaining.current = delay;
  }, [delay, restartKey]);
  useEffect(() => {
    const duration = remaining.current;
    if (paused || duration === undefined) return;
    const started = performance.now();
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      remaining.current = undefined;
      latest.current();
    }, duration);
    return () => {
      clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, duration - (performance.now() - started));
    };
  }, [delay, restartKey, paused]);
}
