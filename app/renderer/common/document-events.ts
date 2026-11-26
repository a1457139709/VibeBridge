import { useEffect, useEffectEvent } from 'react';

export function useDocumentEvent<Type extends keyof DocumentEventMap>(
  type: Type,
  listener: (event: DocumentEventMap[Type]) => void,
  { capture = false }: { capture?: boolean } = {},
) {
  const dispatched = useEffectEvent(listener);
  useEffect(() => {
    const handle = (event: DocumentEventMap[Type]) => dispatched(event);
    document.addEventListener(type, handle, capture);
    return () => document.removeEventListener(type, handle, capture);
  }, [type, capture]);
}
