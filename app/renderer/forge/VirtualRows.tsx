import { useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { readingPositionAt, restoredScrollTop, rowWindow, type ReadingPosition } from './virtual-rows';

/** How many rows render beyond the view on each side, so ↑/↓ always has a row to move to. */
const overscan = 4;
/** The height a row is taken to have until it has rendered, while no row has. */
const unmeasuredRowHeight = 56;

/** The height a row that has not rendered is taken to have: that of the rows that have, on average. */
function expectedRowHeight(measured: Map<number, number>) {
  if (!measured.size) return unmeasuredRowHeight;
  return [...measured.values()].reduce((total, height) => total + height, 0) / measured.size;
}

/** What a list of rows offers its owner: where it is being read, and scrolling. */
export interface VirtualRowsHandle {
  /** The row at the top of the view, its place and how far it is scrolled past; null with no rows. */
  readingPosition(): ReadingPosition | null;
  /** Scrolls back to `position`: to its row wherever it now is, else to the row now at its place. */
  restore(position: ReadingPosition): void;
  /** Scrolls the row `key` into view and renders it at once; false when the list has no such row. */
  reveal(key: number): boolean;
}

/** Where a list of rows scrolls, where its owner reaches it, and what it calls each time the rows it renders may have
 * changed. */
export interface VirtualRowsHost {
  scrollArea: HTMLElement | null;
  ref: Ref<VirtualRowsHandle>;
  rendered(): void;
}

/** A list that renders only the rows in view of its scroll area and a few around them; the space of the others stays,
 * so it scrolls as if they were all there. Each row is a list item, `row(index)`, whose height is measured once it
 * renders. */
export function VirtualRows({
  host,
  keys,
  row,
  ...list
}: {
  host: VirtualRowsHost;
  /** Each row's key, in order. */
  keys: number[];
  row(index: number): React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLUListElement>, 'children'>) {
  const { scrollArea } = host;
  const listElement = useRef<HTMLUListElement>(null);
  const measured = useRef(new Map<number, number>());
  const [view, setView] = useState({ scrollTop: 0, viewport: 0 });
  const [, remeasured] = useReducer((count: number) => count + 1, 0);
  const expected = expectedRowHeight(measured.current);
  const heights = keys.map(key => measured.current.get(key) ?? expected);
  const { start, end, before, after } = rowWindow(heights, { ...view, overscan });

  /** Takes the scroll area's position and size, rendering anew when they changed. */
  const follow = () => {
    if (!scrollArea) return;
    const { scrollTop, clientHeight: viewport } = scrollArea;
    setView(last => (last.scrollTop === scrollTop && last.viewport === viewport ? last : { scrollTop, viewport }));
  };
  useLayoutEffect(() => {
    if (!scrollArea) return;
    follow();
    scrollArea.addEventListener('scroll', follow);
    const resized = new ResizeObserver(follow);
    resized.observe(scrollArea);
    return () => {
      scrollArea.removeEventListener('scroll', follow);
      resized.disconnect();
    };
  }, [scrollArea]);
  // Each render measures the rows it rendered; a row whose height changed renders the window anew.
  useLayoutEffect(() => {
    const items = listElement.current?.children ?? [];
    let changed = false;
    for (const [offset, item] of [...items].entries()) {
      const key = keys[start + offset];
      const height = (item as HTMLElement).offsetHeight;
      if (key === undefined || measured.current.get(key) === height) continue;
      measured.current.set(key, height);
      changed = true;
    }
    if (changed) remeasured();
    follow();
    host.rendered();
  });

  /** Scrolls to `scrollTop`; the rows there render with the next render. */
  const scrollTo = (scrollTop: number) => {
    if (!scrollArea) return;
    scrollArea.scrollTop = scrollTop;
    follow();
  };
  useImperativeHandle(host.ref, () => ({
    readingPosition: () => readingPositionAt(keys, heights, scrollArea?.scrollTop ?? 0),
    restore: position => scrollTo(restoredScrollTop(position, keys, heights)),
    reveal(key) {
      const index = keys.indexOf(key);
      if (index < 0) return false;
      if (index < start || index >= end)
        flushSync(() => scrollTo(heights.slice(0, index).reduce((top, height) => top + height, 0)));
      return true;
    },
  }));

  return (
    <ul {...list} ref={listElement} style={{ paddingTop: before, paddingBottom: after }}>
      {keys.slice(start, end).map((_, offset) => row(start + offset))}
    </ul>
  );
}
