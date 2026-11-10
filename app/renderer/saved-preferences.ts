import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { DesktopAPI } from '../shared/api';
import type { Snapshot } from '../shared/model';
import { capturePointer } from './pointer-capture';

/** An app-wide side area's saved state: whether it shows and how wide it is. */
export interface SidePreferences { visible: boolean; width: number }

interface Options<P extends SidePreferences> {
  snapshot?: Snapshot;
  /** The saved value in a snapshot. */
  read(snapshot: Snapshot): P;
  fallback: P;
  save(preferences: P): Promise<void>;
  /** The width the area may take for a requested one. */
  clamp(width: number): number;
  /** The edge the resize handle sits on: dragging it outward widens the area. */
  edge: 'left' | 'right';
  report(message: string): void;
}

/**
 * Shows a side area's saved preferences at once while their save is pending. The latest
 * operation owns the preview: a failed save falls back to the last saved value, and saves
 * that an operation replaced neither become the base of another nor replace its preview.
 */
export function useSavedPreferences<P extends SidePreferences>(options: Options<P>, api: Pick<DesktopAPI, 'subscribe'> = window.workbench) {
  const { snapshot, read, fallback, save: store, clamp, edge, report } = options;
  const [preferences, setPreferences] = useState(fallback);
  const confirmed = useRef(fallback);
  const knownSaved = useRef(fallback);
  const initialized = useRef(false);
  const pending = useRef<object | undefined>(undefined);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (snapshot && !initialized.current) {
      initialized.current = true;
      confirmed.current = knownSaved.current = read(snapshot);
      setPreferences(confirmed.current);
    }
  }, [snapshot]);
  useLayoutEffect(() => {
    // Observe saved values at delivery time, independently of React's batching of App snapshots.
    const unsubscribe = api.subscribe(event => {
      if (event.kind !== 'snapshot') return;
      initialized.current = true;
      knownSaved.current = read(event.snapshot);
      if (!pending.current) {
        confirmed.current = knownSaved.current;
        setPreferences(confirmed.current);
      }
    });
    return () => { unsubscribe(); pending.current = undefined; cancelResize.current?.(); };
  }, [api]);

  function replaceOperation() {
    const operation = {};
    pending.current = operation;
    cancelResize.current?.();
    return operation;
  }
  function save(operation: object, next: P) {
    void store(next).then(() => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current = next;
      setPreferences(next);
    }).catch(error => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current;
      setPreferences(confirmed.current);
      report(error.message);
    });
  }
  function toggle() {
    if (!snapshot) return;
    const next = { ...confirmed.current, visible: !preferences.visible };
    const operation = replaceOperation();
    setPreferences(next);
    save(operation, next);
  }
  function resize(event: PointerEvent<HTMLElement>) {
    if (!snapshot || event.button !== 0) return;
    event.preventDefault();
    const operation = replaceOperation();
    const base = confirmed.current;
    const element = event.currentTarget, start = event.clientX;
    const width = element.parentElement!.getBoundingClientRect().width;
    const direction = edge === 'right' ? 1 : -1;
    let next = clamp(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = clamp(width + direction * (pointer.clientX - start));
      setPreferences({ ...base, width: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel); cancelResize.current = undefined;
      if (pending.current !== operation) return;
      if (commit) save(operation, { ...base, width: next });
      else {
        pending.current = undefined;
        confirmed.current = knownSaved.current;
        setPreferences(confirmed.current);
      }
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }
  return { preferences, toggle, resize };
}
