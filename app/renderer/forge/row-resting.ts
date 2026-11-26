import { useEffect, useEffectEvent, useRef } from 'react';
import { sameItem, type DetailItem } from '../../shared/forge/sidebar-data';
import { useChildListObserver } from '../common/child-list-observer';
import { listRowOf } from './ForgeRows';

interface RestingRow {
  row: Element;
  item: DetailItem;
}

export function useRowResting(scrollArea: HTMLElement | null, report: (item: DetailItem | null) => void) {
  const resting = useRef<RestingRow | null>(null);
  const restOn = useEffectEvent((found: RestingRow | null) => {
    const changed = !sameItem(resting.current?.item ?? null, found?.item ?? null);
    resting.current = found;
    if (changed) report(found?.item ?? null);
  });
  useEffect(() => {
    if (!scrollArea) return;
    const rowAt = (target: EventTarget | null) =>
      target instanceof Element && scrollArea.contains(target) ? listRowOf(target) : null;
    const pointerOver = (event: PointerEvent) => restOn(rowAt(event.target));
    const pointerLeave = () => restOn(null);
    const focusIn = (event: FocusEvent) => restOn(rowAt(event.target));
    const focusOut = (event: FocusEvent) => restOn(rowAt(event.relatedTarget));
    scrollArea.addEventListener('pointerover', pointerOver);
    scrollArea.addEventListener('pointerleave', pointerLeave);
    scrollArea.addEventListener('focusin', focusIn);
    scrollArea.addEventListener('focusout', focusOut);
    return () => {
      scrollArea.removeEventListener('pointerover', pointerOver);
      scrollArea.removeEventListener('pointerleave', pointerLeave);
      scrollArea.removeEventListener('focusin', focusIn);
      scrollArea.removeEventListener('focusout', focusOut);
      restOn(null);
    };
  }, [scrollArea]);
  useChildListObserver(scrollArea, () => {
    if (resting.current && !resting.current.row.isConnected) {
      resting.current = null;
      report(null);
    }
  });
}
