import { useLayoutEffect } from 'react';
import { useLatest } from './latest';

export function useElementMeasurement(measure: () => void) {
  const latest = useLatest(measure);
  useLayoutEffect(() => latest.current());
}
