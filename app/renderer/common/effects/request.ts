import { useEffect, useState } from 'react';
import { useLatest } from './latest';

export function useRequestResult<Result>(key: string | undefined, request: (key: string) => Promise<Result>) {
  const latest = useLatest(request);
  const [settled, setSettled] = useState<{ key: string; result: Result }>();
  if (settled && settled.key !== key) setSettled(undefined);
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    void latest.current(key).then(result => {
      if (live) setSettled({ key, result });
    });
    return () => {
      live = false;
    };
  }, [key]);
  return settled?.result;
}
