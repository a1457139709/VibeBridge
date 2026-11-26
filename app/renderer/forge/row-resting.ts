import { useMemo } from 'react';
import { useSubscription, type Subscribe } from '../common/effects/subscription';
import { sameItem, type DetailItem } from '../../shared/forge/sidebar-data';
import { listRowOf } from './ForgeRows';

const restingOn =
  (scrollArea: HTMLElement): Subscribe<DetailItem | null> =>
  report => {
    let resting: { row: Element; item: DetailItem } | null = null;
    const restOn = (target: EventTarget | null) => {
      const found = target instanceof Element && scrollArea.contains(target) ? listRowOf(target) : null;
      const changed = !sameItem(resting?.item ?? null, found?.item ?? null);
      resting = found;
      if (changed) report(found?.item ?? null);
    };
    const pointerOver = (event: PointerEvent) => restOn(event.target);
    const pointerLeave = () => restOn(null);
    const focusIn = (event: FocusEvent) => restOn(event.target);
    const focusOut = (event: FocusEvent) => restOn(event.relatedTarget);
    const unmounted = new MutationObserver(() => {
      if (resting && !resting.row.isConnected) restOn(null);
    });
    scrollArea.addEventListener('pointerover', pointerOver);
    scrollArea.addEventListener('pointerleave', pointerLeave);
    scrollArea.addEventListener('focusin', focusIn);
    scrollArea.addEventListener('focusout', focusOut);
    unmounted.observe(scrollArea, { childList: true, subtree: true });
    return () => {
      scrollArea.removeEventListener('pointerover', pointerOver);
      scrollArea.removeEventListener('pointerleave', pointerLeave);
      scrollArea.removeEventListener('focusin', focusIn);
      scrollArea.removeEventListener('focusout', focusOut);
      unmounted.disconnect();
      if (resting) report(null);
    };
  };

const restingNowhere: Subscribe<DetailItem | null> = () => () => {};

export function useRowResting(scrollArea: HTMLElement | null, report: (item: DetailItem | null) => void) {
  const subscribe = useMemo(() => (scrollArea ? restingOn(scrollArea) : restingNowhere), [scrollArea]);
  useSubscription(subscribe, report);
}
