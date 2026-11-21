import { useEffect, useRef } from 'react';
import { sameItem, type DetailItem } from '../../shared/forge/sidebar-data';
import { listRowOf } from './ForgeRows';

/** Reports with `report` the list row within `scrollArea` that the pointer or keyboard focus rests on, each time it
 * changes, and null once neither rests on a row: the pointer or focus left the rows, the row unmounted as the list
 * scrolled, or the lists closed. The main process reads that row's detail ahead once it rested long enough. */
export function useRowResting(scrollArea: HTMLElement | null, report: (item: DetailItem | null) => void) {
  const reportLatest = useRef(report);
  reportLatest.current = report;
  useEffect(() => {
    if (!scrollArea) return;
    let resting: { row: Element; item: DetailItem } | null = null;
    const restOn = (target: EventTarget | null) => {
      const found = target && scrollArea.contains(target as Node) ? listRowOf(target as Element) : null;
      const changed = !sameItem(resting?.item ?? null, found?.item ?? null);
      resting = found;
      if (changed) reportLatest.current(found?.item ?? null);
    };
    const pointerOver = (event: PointerEvent) => restOn(event.target);
    const pointerLeave = () => restOn(null);
    const focusIn = (event: FocusEvent) => restOn(event.target);
    const focusOut = (event: FocusEvent) => restOn(event.relatedTarget);
    // A virtualized row may unmount under a resting pointer or focus, which then rest on no row.
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
      if (resting) reportLatest.current(null);
    };
  }, [scrollArea]);
}
