import { useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import type { DesktopAPI } from '../shared/api';
import { sidebars, type Sidebar, type SidebarPreferences, type Snapshot } from '../shared/model';
import { capturePointer } from './pointer-capture';

interface Options {
  sidebar: Sidebar;
  snapshot?: Snapshot;
  api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'>;
  /** Which way dragging the resize edge to the right changes the width: 1 for an edge on the right, -1 for one on the left. */
  edge: 1 | -1;
  report(message: string): void;
}

/** A sidebar's open state and width as the stored preferences hold them. Toggling and resizing show at once
 * and are saved; a failed save returns to the stored preferences. A newer operation replaces a pending one,
 * and snapshots never replace the preview of a pending operation. Keep it in the main window's lifetime. */
export function useSidebarPreferences(options: Options) {
  const { sidebar, snapshot, api: { subscribe } } = options;
  const { defaults } = sidebars[sidebar];
  const latest = useRef(options);
  latest.current = options;
  const [preferences, setPreferences] = useState<SidebarPreferences>(defaults);
  const confirmed = useRef<SidebarPreferences>(defaults);
  const knownSaved = useRef<SidebarPreferences>(defaults);
  const initialized = useRef(false);
  const pending = useRef<object | undefined>(undefined);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  useLayoutEffect(() => {
    if (snapshot && !initialized.current) {
      initialized.current = true;
      confirmed.current = knownSaved.current = snapshot[sidebar];
      setPreferences(confirmed.current);
    }
  }, [snapshot]);
  useLayoutEffect(() => {
    // Observe the preferences at delivery time, independently of React's batching of App snapshots. Old
    // writes remain known for failure recovery, but cannot become the base of another operation or replace its preview while pending.
    const unsubscribe = subscribe(event => {
      if (event.kind !== 'snapshot') return;
      initialized.current = true;
      knownSaved.current = event.snapshot[latest.current.sidebar];
      if (!pending.current) {
        confirmed.current = knownSaved.current;
        setPreferences(confirmed.current);
      }
    });
    return () => { unsubscribe(); pending.current = undefined; cancelResize.current?.(); };
  }, [subscribe]);

  function replaceOperation() {
    const operation = {};
    pending.current = operation;
    cancelResize.current?.();
    return operation;
  }
  function save(operation: object, next: SidebarPreferences) {
    void latest.current.api.saveSidebar(latest.current.sidebar, next).then(() => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current = next;
      setPreferences(next);
    }).catch(error => {
      if (pending.current !== operation) return;
      pending.current = undefined;
      confirmed.current = knownSaved.current;
      setPreferences(confirmed.current);
      latest.current.report(error.message);
    });
  }
  /** Shows or hides the sidebar; returns whether it is now visible. */
  function toggle() {
    if (!latest.current.snapshot) return preferences.visible;
    const next = { ...confirmed.current, visible: !preferences.visible };
    const operation = replaceOperation();
    setPreferences(next);
    save(operation, next);
    return next.visible;
  }
  function resize(event: PointerEvent<HTMLElement>) {
    if (!latest.current.snapshot || event.button !== 0) return;
    event.preventDefault();
    const { sidebar: current, edge } = latest.current;
    const bounded = sidebars[current].width;
    const operation = replaceOperation();
    const base = confirmed.current;
    const element = event.currentTarget, start = event.clientX;
    const width = element.parentElement!.getBoundingClientRect().width;
    let next = bounded(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = bounded(width + edge * (pointer.clientX - start));
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
