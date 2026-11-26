import { useLayoutEffect, useRef } from 'react';
import { useLatest } from './latest';

export function useElementAttachmentBeforePaint<Target extends HTMLElement>(
  key: string | undefined,
  attach: (element: Target, key: string) => () => void,
) {
  const element = useRef<Target>(null);
  const latest = useLatest(attach);
  useLayoutEffect(() => {
    if (key === undefined || !element.current) return;
    return latest.current(element.current, key);
  }, [key]);
  return element;
}
