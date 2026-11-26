import { useEffect, useLayoutEffect } from 'react';
import type { WorkbenchEvent } from '../../../shared/model';
import { useLatest } from './latest';

export type Subscribe<Event> = (listener: (event: Event) => void) => () => void;

const subscribeWith =
  (useTimedEffect: typeof useEffect) =>
  <Event>(subscribe: Subscribe<Event>, listener: (event: Event) => void) => {
    const latest = useLatest(listener);
    useTimedEffect(() => subscribe(event => latest.current(event)), [subscribe]);
  };

export const useSubscription = subscribeWith(useEffect);
export const useSubscriptionBeforePaint = subscribeWith(useLayoutEffect);

const subscribeToMainProcess: Subscribe<WorkbenchEvent> = listener => window.workbench.subscribe(listener);

export const useMainProcessEvents = (listener: (event: WorkbenchEvent) => void) =>
  useSubscription(subscribeToMainProcess, listener);
