import { useEffect, useEffectEvent, useState } from 'react';

export function useRequestResult<Result>(key: string | undefined, request: (key: string) => Promise<Result>) {
  const requested = useEffectEvent(request);
  const [settled, setSettled] = useState<{ key: string; result: Result }>();
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    void requested(key).then(result => {
      if (live) setSettled({ key, result });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return settled && settled.key === key ? settled.result : undefined;
}
