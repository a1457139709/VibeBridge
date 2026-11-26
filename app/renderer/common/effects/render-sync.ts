import { useLayoutEffect } from 'react';
import { useLatest } from './latest';

export function useRenderSyncBeforePaint(sync: () => void) {
  const latest = useLatest(sync);
  useLayoutEffect(() => latest.current());
}
