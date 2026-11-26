import { useEffect, useEffectEvent, useState } from 'react';

export function useRequestResult<Result>(
  key: string | undefined,
  request: (key: string, signal: AbortSignal) => Promise<Result>,
  recover: (error: unknown) => Result,
) {
  const requested = useEffectEvent(request);
  const recovered = useEffectEvent(recover);
  const [settled, setSettled] = useState<{ key: string; result: Result }>();
  useEffect(() => {
    if (key === undefined) return;
    const controller = new AbortController();
    const settle = (result: () => Result) => {
      if (!controller.signal.aborted) setSettled({ key, result: result() });
    };
    void new Promise<Result>(resolve => resolve(requested(key, controller.signal))).then(
      result => settle(() => result),
      (error: unknown) => settle(() => recovered(error)),
    );
    return () => controller.abort();
  }, [key]);
  return settled && settled.key === key ? settled.result : undefined;
}
