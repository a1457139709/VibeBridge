import { useEffect, useLayoutEffect, useRef, useState } from 'react';

type FindElement = () => HTMLElement | null | undefined;

interface FocusOptions {
  scrollIntoView?: boolean;
}

const requestFocusWith =
  (useTimedEffect: typeof useEffect) =>
  ({ scrollIntoView = false }: FocusOptions = {}) => {
    const [request, setRequest] = useState<{ find: FindElement }>();
    useTimedEffect(() => {
      const element = request?.find();
      if (scrollIntoView) element?.scrollIntoView({ block: 'nearest' });
      element?.focus();
    }, [request]);
    return (find: FindElement) => setRequest({ find });
  };

export const useFocusRequest = requestFocusWith(useEffect);
export const useFocusRequestBeforePaint = requestFocusWith(useLayoutEffect);

export function useFocusAtTopBeforePaint<Target extends HTMLElement>(shown: readonly unknown[]) {
  const element = useRef<Target>(null);
  useLayoutEffect(() => {
    element.current?.focus({ preventScroll: true });
    element.current?.scrollTo?.({ top: 0 });
  }, shown);
  return element;
}
