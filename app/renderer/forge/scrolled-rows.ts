import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { DetailItem, ForgeListTab, ForgeLists } from '../../shared/forge/sidebar-data';
import { rowTitleOf } from './ForgeRows';
import type { VirtualRowsHandle, VirtualRowsHost } from './VirtualRows';
import type { ReadingPosition } from './virtual-rows';

/** The scroll area of a project's lists and the rows in it: it declares the rows it renders to the main process with
 * `declare`, returns to where it was being read once a refresh settles `lists`, and finds the row of an item for focus. */
export function useScrolledRows(projectId: string, lists: ForgeLists, declare: (declaration: Promise<void>) => void) {
  /** The rows: where focus returns from the detail, and where it rests when no row of the detail's items shows. */
  const scrollArea = useRef<HTMLDivElement>(null);
  /** The scroll area as the list of rows follows it. */
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const holdScrollArea = useCallback((element: HTMLDivElement | null) => {
    scrollArea.current = element;
    setScrollElement(element);
  }, []);
  const virtualRows = useRef<VirtualRowsHandle>(null);
  /** The numbers of the rows last declared rendered. */
  const declaredRows = useRef('');
  const rowsHost: VirtualRowsHost = {
    scrollArea: scrollElement,
    ref: virtualRows,
    // Declares the rows the list renders, sub-issues shown under their parents included, whenever they change.
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
  /** Where the list was being read when a refresh was asked for, to return to once it settles. */
  const readingPosition = useRef<ReadingPosition | null>(null);
  useLayoutEffect(() => {
    if (lists.loading || !readingPosition.current) return;
    virtualRows.current?.restore(readingPosition.current);
    readingPosition.current = null;
  }, [lists]);
  return {
    scrollArea,
    holdScrollArea,
    rowsHost,
    /** Notes where the list is being read, to return to once the refresh about to be asked for settles. */
    keepReadingPosition() {
      readingPosition.current = virtualRows.current?.readingPosition() ?? null;
    },
    /** The title of `item`'s row in `tab`'s list, scrolling the row into view when the list holds it out of view. */
    rowTitle(item: DetailItem, tab: ForgeListTab) {
      const title = rowTitleOf(scrollArea.current, item);
      if (title || (item.kind === 'issue') !== (tab === 'issues')) return title;
      return virtualRows.current?.reveal(item.number) ? rowTitleOf(scrollArea.current, item) : undefined;
    },
  };
}
