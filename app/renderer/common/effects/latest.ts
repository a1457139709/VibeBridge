import { useInsertionEffect, useRef } from 'react';

export function useLatest<Value>(value: Value) {
  const latest = useRef(value);
  useInsertionEffect(() => {
    latest.current = value;
  });
  return latest;
}
