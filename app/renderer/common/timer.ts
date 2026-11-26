import { useEffect, useEffectEvent, useRef } from 'react';

interface Timing {
  delay: number | undefined;
  restartKey?: unknown;
  paused?: boolean;
}

export function useTimeout(onTimeout: () => void, { delay, restartKey, paused = false }: Timing) {
  const timedOut = useEffectEvent(onTimeout);
  const remaining = useRef(delay);
  useEffect(() => {
    remaining.current = delay;
  }, [delay, restartKey]);
  useEffect(() => {
    const duration = remaining.current;
    if (paused || duration === undefined) return;
    const started = Date.now();
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      remaining.current = undefined;
      timedOut();
    }, duration);
    return () => {
      clearTimeout(timer);
      if (!fired) remaining.current = Math.max(0, duration - (Date.now() - started));
    };
  }, [delay, restartKey, paused]);
}
