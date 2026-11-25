import { useLayoutEffect, useState } from 'react';

type FindElement = () => HTMLElement | null | undefined;

export function useFocusRequestBeforePaint() {
  const [request, setRequest] = useState<{ find: FindElement }>();
  useLayoutEffect(() => {
    const element = request?.find();
    element?.scrollIntoView({ block: 'nearest' });
    element?.focus();
  }, [request]);
  return (find: FindElement) => setRequest({ find });
}
