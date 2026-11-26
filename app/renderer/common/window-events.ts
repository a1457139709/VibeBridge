import { useEffect, useEffectEvent } from 'react';

export function useWindowEvent<Type extends keyof WindowEventMap>(
  type: Type,
  listener: (event: WindowEventMap[Type]) => void,
  { capture = false }: { capture?: boolean } = {},
) {
  const dispatched = useEffectEvent(listener);
  useEffect(() => {
    const handle = (event: WindowEventMap[Type]) => dispatched(event);
    window.addEventListener(type, handle, capture);
    return () => window.removeEventListener(type, handle, capture);
  }, [type, capture]);
}
