import { useRef, useState, type PointerEvent } from 'react';
import type { DesktopAPI } from '../../shared/api';
import { sidebars, type Sidebar, type SidebarPreferences, type Snapshot } from '../../shared/model';
import { errorMessage } from '../../shared/caught-error';
import { capturePointer } from './pointer-capture';
import { requireValue } from './required';
import { LatestRequest, type RequestTicket } from '../../shared/latest-request';
import { draggedWidth, type WidestOnResize } from './region-widths';

interface Options {
  sidebar: Sidebar;
  snapshot: Snapshot | undefined;
  api: Pick<DesktopAPI, 'saveSidebar'>;
  edge: 1 | -1;
  widestOnResize: WidestOnResize;
  report(message: string): void;
}

export function useSidebarPreferences({ sidebar, snapshot, api, edge, widestOnResize, report }: Options) {
  const { defaults, minWidth } = sidebars[sidebar];
  const [stored, setStored] = useState<{ preferences: SidebarPreferences; snapshot?: Snapshot }>({
    preferences: defaults,
  });
  if (snapshot && snapshot !== stored.snapshot) setStored({ preferences: snapshot[sidebar], snapshot });
  const [unsaved, setUnsaved] = useState<SidebarPreferences>();
  const preferences = unsaved ?? stored.preferences;
  const [pending] = useState(() => new LatestRequest());
  const cancelResize = useRef<(() => void) | undefined>(undefined);

  function replaceOperation() {
    const operation = pending.start();
    cancelResize.current?.();
    return operation;
  }
  function settle(operation: RequestTicket) {
    if (!pending.finish(operation)) return false;
    setUnsaved(undefined);
    return true;
  }
  function save(operation: RequestTicket, next: SidebarPreferences) {
    void api
      .saveSidebar(sidebar, next)
      .then(() => {
        if (settle(operation)) setStored(previous => ({ ...previous, preferences: next }));
      })
      .catch(error => {
        if (settle(operation)) report(errorMessage(error));
      });
  }
  function toggle() {
    if (!snapshot) return preferences.visible;
    const next = { ...stored.preferences, visible: !preferences.visible };
    const operation = replaceOperation();
    setUnsaved(next);
    save(operation, next);
    return next.visible;
  }
  function startResize(event: PointerEvent<HTMLElement>) {
    if (!snapshot || event.button !== 0) return;
    event.preventDefault();
    const widest = widestOnResize(sidebar);
    const bounded = (width: number) => draggedWidth(width, minWidth, widest);
    const operation = replaceOperation();
    const base = stored.preferences;
    const element = event.currentTarget,
      start = event.clientX;
    const width = requireValue(element.parentElement, 'the sidebar').getBoundingClientRect().width;
    let next = bounded(width);
    const move = (pointer: globalThis.PointerEvent) => {
      next = bounded(width + edge * (pointer.clientX - start));
      setUnsaved({ ...base, width: next });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener('blur', cancel);
      cancelResize.current = undefined;
      if (!pending.isLatest(operation)) return;
      if (commit) save(operation, { ...base, width: next });
      else settle(operation);
    };
    const cancel = capturePointer(element, event.pointerId, { move, finish });
    cancelResize.current = cancel;
    window.addEventListener('blur', cancel);
  }
  return { preferences, toggle, startResize };
}
