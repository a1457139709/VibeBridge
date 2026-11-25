import { useEffect, useLayoutEffect } from 'react';
import { useLatest } from './latest';

const cleanUpWith = (useTimedEffect: typeof useEffect) => (cleanup: () => void) => {
  const latest = useLatest(cleanup);
  useTimedEffect(() => () => latest.current(), []);
};

export const useUnmountCleanup = cleanUpWith(useEffect);
export const useUnmountCleanupBeforePaint = cleanUpWith(useLayoutEffect);
