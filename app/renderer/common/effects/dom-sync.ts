import { useLayoutEffect } from 'react';
import { useLatest } from './latest';

export function useDomSyncBeforePaint(sync: () => void, triggers?: readonly unknown[]) {
  const latest = useLatest(sync);
  useLayoutEffect(() => latest.current(), triggers);
}
