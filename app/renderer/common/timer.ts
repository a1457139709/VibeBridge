import { useEffect, useEffectEvent, useRef } from 'react';

export function Timeout({ delay, paused = false, onTimeout }: { delay: number; paused?: boolean; onTimeout(): void }) {
  const timedOut = useEffectEvent(onTimeout);
  const remaining = useRef<number | undefined>(delay);
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
  }, [paused]);
  return null;
}

export function wait(delay: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, delay);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });
}
