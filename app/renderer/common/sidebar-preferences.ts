import { useRef, useState, type PointerEvent } from 'react';
import { useSubscriptionBeforePaint } from './effects/subscription';
import { useUnmountCleanupBeforePaint } from './effects/unmount';
import { useLatest } from './effects/latest';
import type { DesktopAPI } from '../../shared/api';
import { sidebars, type Sidebar, type SidebarPreferences, type Snapshot } from '../../shared/model';
import { errorMessage } from '../../shared/caught-error';
import { capturePointer } from './pointer-capture';
import { requireValue } from './required';
import { draggedWidth, type WidestOnResize } from './region-widths';

interface Options {
  sidebar: Sidebar;
  snapshot?: Snapshot;
  api: Pick<DesktopAPI, 'saveSidebar' | 'subscribe'>;
  edge: 1 | -1;
  widestOnResize: WidestOnResize;
  report(message: string): void;
}

export function useSidebarPreferences(options: Options) {
  const {
    sidebar,
    snapshot,
    api: { subscribe },
  } = options;
  const { defaults } = sidebars[sidebar];
  const latest = useLatest(options);
  const [shown, setShown] = useState<SidebarPreferences>();
  const preferences = shown ?? snapshot?.[sidebar] ?? defaults;
  const settled = useRef<SidebarPreferences>(undefined);
  const stored = useRef<SidebarPreferences>(undefined);
  const pending = useRef<object | undefined>(undefined);
  const cancelResize = useRef<(() => void) | undefined>(undefined);
  const storedBeforeAnyEvent = () => latest.current.snapshot?.[latest.current.sidebar] ?? defaults;
  const settledPreferences = () => settled.current ?? storedBeforeAnyEvent();
  useSubscriptionBeforePaint(subscribe, event => {
    if (event.kind !== 'snapshot') return;
    stored.current = event.snapshot[latest.current.sidebar];
    if (!pending.current) {
      settled.current = stored.current;
      setShown(settled.current);
    }
  });
  useUnmountCleanupBeforePaint(() => {
    pending.current = undefined;
    cancelResize.current?.();
  });

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
        setShown(next);
      })
      .catch(error => {
        if (pending.current !== operation) return;
        pending.current = undefined;
        settled.current = stored.current;
        setShown(settled.current);
        latest.current.report(errorMessage(error));
      });
  }
  function toggle() {
    if (!latest.current.snapshot) return preferences.visible;
    const next = { ...settledPreferences(), visible: !preferences.visible };
    const operation = replaceOperation();
    setShown(next);
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
    const base = settledPreferences();
    const element = event.currentTarget,
      start = event.clientX;
    const width = requireValue(element.parentElement, 'the sidebar').getBoundingClientRect().width;
    let next = bounded(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = bounded(width + edge * (pointer.clientX - start));
      setShown({ ...base, width: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel);
      cancelResize.current = undefined;
      if (pending.current !== operation) return;
      if (commit) save(operation, { ...base, width: next });
      else {
        pending.current = undefined;
        settled.current = stored.current;
        setShown(settled.current);
      }
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }
  return { preferences, toggle, startResize };
}
