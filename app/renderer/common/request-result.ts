import { useEffect, useEffectEvent, useState } from 'react';

export function useRequestResult<Result>(
  key: string | undefined,
  request: (key: string) => Promise<Result>,
  { recover }: { recover?: (error: unknown) => Result } = {},
) {
  const requested = useEffectEvent(request);
  const recovered = useEffectEvent((error: unknown) => {
    if (!recover) throw error;
    return recover(error);
  });
  const [settled, setSettled] = useState<{ key: string; result: Result }>();
  useEffect(() => {
    if (key === undefined) return;
    let live = true;
    void requested(key).then(
      result => {
        if (live) setSettled({ key, result });
      },
      (error: unknown) => {
        if (live) setSettled({ key, result: recovered(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  return settled && settled.key === key ? settled.result : undefined;
}
