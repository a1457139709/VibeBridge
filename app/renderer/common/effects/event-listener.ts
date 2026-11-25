import { useEffect, useLayoutEffect } from 'react';
import { useLatest } from './latest';

type EventsOf<Target> = Target extends Window
  ? WindowEventMap
  : Target extends Document
    ? DocumentEventMap
    : Target extends HTMLElement
      ? HTMLElementEventMap
      : Record<string, Event>;

interface ListenerOptions {
  capture?: boolean;
}

const listenWith =
  (useTimedEffect: typeof useEffect) =>
  <Target extends EventTarget, Type extends keyof EventsOf<Target> & string>(
    target: Target | null | undefined,
    type: Type,
    listener: (event: Event & EventsOf<Target>[Type]) => void,
    { capture = false }: ListenerOptions = {},
  ) => {
    const latest = useLatest(listener);
    useTimedEffect(() => {
      if (!target) return;
      const handle = {
        handleEvent(event: Event & EventsOf<Target>[Type]) {
          latest.current(event);
        },
      };
      target.addEventListener(type, handle, capture);
      return () => target.removeEventListener(type, handle, capture);
    }, [target, type, capture]);
  };

export const useEventListener = listenWith(useEffect);
export const useEventListenerBeforePaint = listenWith(useLayoutEffect);
