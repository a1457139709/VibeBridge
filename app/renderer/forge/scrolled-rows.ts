import { useCallback, useRef, useState } from 'react';
import { useRenderSyncBeforePaint } from '../common/effects/render-sync';
import type { DetailItem, ForgeListTab, ForgeLists } from '../../shared/forge/sidebar-data';
import { rowTitleOf } from './ForgeRows';
import type { VirtualRowsHandle, VirtualRowsHost } from './VirtualRows';
import type { ReadingPosition } from './virtual-rows';

export function useScrolledRows(projectId: string, lists: ForgeLists, declare: (declaration: Promise<void>) => void) {
  const scrollArea = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const holdScrollArea = useCallback((element: HTMLDivElement | null) => {
    scrollArea.current = element;
    setScrollElement(element);
  }, []);
  const virtualRows = useRef<VirtualRowsHandle>(null);
  const declaredRows = useRef('');
  const rowsHost: VirtualRowsHost = {
    scrollArea: scrollElement,
    ref: virtualRows,
    rendered() {
      const numbers = [
        ...(scrollArea.current?.querySelectorAll<HTMLElement>('[data-issue], [data-pull-request]') ?? []),
      ].map(row => Number(row.dataset.issue ?? row.dataset.pullRequest));
      const key = numbers.join();
      if (key === declaredRows.current) return;
      declaredRows.current = key;
      declare(window.workbench.showForgeRows(projectId, numbers));
    },
  };
  const kept = useRef<{ position: ReadingPosition; lists: ForgeLists } | null>(null);
  useRenderSyncBeforePaint(() => {
    if (!kept.current || kept.current.lists === lists || lists.loading) return;
    virtualRows.current?.restore(kept.current.position);
    kept.current = null;
  });
  return {
    scrollArea,
    scrollElement,
    holdScrollArea,
    rowsHost,
    keepReadingPosition() {
      const position = virtualRows.current?.readingPosition();
      kept.current = position ? { position, lists } : null;
    },
    rowTitle(item: DetailItem, tab: ForgeListTab) {
      const title = rowTitleOf(scrollArea.current, item);
      if (title || (item.kind === 'issue') !== (tab === 'issues')) return title;
      return virtualRows.current?.reveal(item.number) ? rowTitleOf(scrollArea.current, item) : undefined;
    },
  };
}
