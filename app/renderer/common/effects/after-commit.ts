import { useEffect } from 'react';
import { useLatest } from './latest';

export function useAfterCommit(run: () => void, triggers: readonly unknown[]) {
  const latest = useLatest(run);
  useEffect(() => latest.current(), triggers);
}
