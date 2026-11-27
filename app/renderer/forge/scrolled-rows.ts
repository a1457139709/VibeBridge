import { useCallback, useRef, useState } from 'react';
import type { DetailItem, ForgeListTab } from '../../shared/forge/sidebar-data';
import { useResizeObserver } from '../common/resize-observer';
import { rowTitleOf } from './ForgeRows';
import type { ScrollAreaView, VirtualRowsHandle, VirtualRowsHost } from './VirtualRows';
import type { ReadingPosition } from './virtual-rows';

const viewOf = (scrollArea: HTMLElement): ScrollAreaView => ({
  scrollTop: scrollArea.scrollTop,
  viewport: scrollArea.clientHeight,
});
const sameView = (a: ScrollAreaView, b: ScrollAreaView) => a.scrollTop === b.scrollTop && a.viewport === b.viewport;

export function useScrolledRows(projectId: string, failed: (error: unknown) => void) {
  const [scrollArea, setScrollArea] = useState<HTMLDivElement | null>(null);
  const [view, setView] = useState<ScrollAreaView>({ scrollTop: 0, viewport: 0 });
  const readView = (element: HTMLElement) => {
    const read = viewOf(element);
    setView(last => (sameView(last, read) ? last : read));
  };
  const holdScrollArea = useCallback((element: HTMLDivElement | null) => {
    setScrollArea(element);
    if (!element) return;
    const read = viewOf(element);
    setView(last => (sameView(last, read) ? last : read));
  }, []);
  useResizeObserver(scrollArea, () => {
    if (scrollArea) readView(scrollArea);
  });
  const virtualRows = useRef<VirtualRowsHandle>(null);
  const readingPosition = useRef<ReadingPosition | null>(null);
  const rowsHost: VirtualRowsHost = {
    projectId,
    view,
    ref: virtualRows,
    failed,
    scrollTo(scrollTop) {
      if (!scrollArea) return;
      scrollArea.scrollTo({ top: scrollTop });
      readView(scrollArea);
    },
  };
  return {
    scrollArea,
    holdScrollArea,
    readScrollArea() {
      if (scrollArea) readView(scrollArea);
    },
    rowsHost,
    keepReadingPosition() {
      readingPosition.current = virtualRows.current?.readingPosition() ?? null;
    },
    restoreReadingPosition() {
      if (!readingPosition.current) return;
      virtualRows.current?.restore(readingPosition.current);
      readingPosition.current = null;
    },
    rowTitle(item: DetailItem, tab: ForgeListTab) {
      const title = rowTitleOf(scrollArea, item);
      if (title || (item.kind === 'issue') !== (tab === 'issues')) return title;
      return virtualRows.current?.reveal(item.number) ? rowTitleOf(scrollArea, item) : undefined;
    },
  };
}
