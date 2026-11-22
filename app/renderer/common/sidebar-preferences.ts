import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { DesktopAPI } from '../../shared/api';
import { sidebars, type Sidebar, type SidebarPreferences, type Snapshot } from '../../shared/model';
import { errorMessage } from '../../shared/error-message';
import { capturePointer } from './pointer-capture';
import { requireValue } from './required';
import { draggedWidth, type WidestOnResize } from './region-widths';

interface Options {
  sidebar: Sidebar;
  snapshot?: Snapshot;
  api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'>;
  /** Which way dragging the resize edge to the right changes the width: 1 for an edge on the right, -1 for one on the left. */
  edge: 1 | -1;
  widestOnResize: WidestOnResize;
  report(message: string): void;
}

/** A sidebar's open state and width as the stored preferences hold them. Toggling and resizing show at once
 * and are saved; a failed save returns to the stored preferences. A newer operation replaces a pending one,
 * and snapshots never replace the preview of a pending operation. Keep it in the main window's lifetime. */
export function useSidebarPreferences(options: Options) {
  const {
    sidebar,
    snapshot,
    api: { subscribe },
  } = options;
  const { defaults } = sidebars[sidebar];
  const latest = useRef(options);
  latest.current = options;
  const [preferences, setPreferences] = useState<SidebarPreferences>(defaults);
  /** The preferences no operation is changing: the base of the next toggle or resize, shown when none is pending. */
  const settled = useRef<SidebarPreferences>(defaults);
  /** The preferences the main process last stored, which a pending operation falls back to when it fails. */
  const stored = useRef<SidebarPreferences>(defaults);
  const initialized = useRef(false);
  const pending = useRef<object | undefined>(undefined);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (snapshot && !initialized.current) {
      initialized.current = true;
      settled.current = stored.current = snapshot[sidebar];
      setPreferences(settled.current);
    }
  }, [snapshot]);
  useLayoutEffect(() => {
    // Observe the preferences at delivery time, independently of React's batching of App snapshots. Old
    // writes remain known for failure recovery, but cannot become the base of another operation or replace its preview while pending.
    const unsubscribe = subscribe(event => {
      if (event.kind !== 'snapshot') return;
      initialized.current = true;
      stored.current = event.snapshot[latest.current.sidebar];
      if (!pending.current) {
        settled.current = stored.current;
        setPreferences(settled.current);
      }
    });
    return () => {
      unsubscribe();
      pending.current = undefined;
      cancelResize.current?.();
    };
  }, [subscribe]);

  function replaceOperation() {
    const operation = {};
    pending.current = operation;
    cancelResize.current?.();
    return operation;
  }
  function save(operation: object, next: SidebarPreferences) {
    void latest.current.api
      .saveSidebar(latest.current.sidebar, next)
      .then(() => {
        if (pending.current !== operation) return;
        pending.current = undefined;
        settled.current = stored.current = next;
        setPreferences(next);
      })
      .catch(error => {
        if (pending.current !== operation) return;
        pending.current = undefined;
        settled.current = stored.current;
        setPreferences(settled.current);
        latest.current.report(errorMessage(error));
      });
  }
  /** Shows or hides the sidebar; returns whether it is now visible. */
  function toggle() {
    if (!latest.current.snapshot) return preferences.visible;
    const next = { ...settled.current, visible: !preferences.visible };
    const operation = replaceOperation();
    setPreferences(next);
    save(operation, next);
    return next.visible;
  }
  function startResize(event: PointerEvent<HTMLElement>) {
    if (!latest.current.snapshot || event.button !== 0) return;
    event.preventDefault();
    const { sidebar: current, edge } = latest.current;
    const { minWidth } = sidebars[current];
    const widest = latest.current.widestOnResize(current);
    const bounded = (width: number) => draggedWidth(width, minWidth, widest);
    const operation = replaceOperation();
    const base = settled.current;
    const element = event.currentTarget,
      start = event.clientX;
    const width = requireValue(element.parentElement, 'the sidebar').getBoundingClientRect().width;
    let next = bounded(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = bounded(width + edge * (pointer.clientX - start));
      setPreferences({ ...base, width: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel);
      cancelResize.current = undefined;
      if (pending.current !== operation) return;
      if (commit) save(operation, { ...base, width: next });
      else {
        pending.current = undefined;
        settled.current = stored.current;
        setPreferences(settled.current);
      }
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }
  return { preferences, toggle, startResize };
}
