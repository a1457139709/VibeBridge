import { useImperativeHandle, useLayoutEffect, useReducer, useRef, useState, type Ref } from 'react';
import { flushSync } from 'react-dom';
import { heightBefore, readingPositionAt, restoredScrollTop, rowWindow, type ReadingPosition } from './virtual-rows';

const overscan = 4;
const unmeasuredRowHeight = 56;

function expectedRowHeight(measured: Map<number, number>) {
  if (!measured.size) return unmeasuredRowHeight;
  return [...measured.values()].reduce((total, height) => total + height, 0) / measured.size;
}

export interface VirtualRowsHandle {
  readingPosition(): ReadingPosition | null;
  restore(position: ReadingPosition): void;
  reveal(key: number): boolean;
}

export interface VirtualRowsHost {
  scrollArea: HTMLElement | null;
  ref: Ref<VirtualRowsHandle>;
  rendered(): void;
}

export function VirtualRows({
  host,
  keys,
  row,
  ...list
}: {
  host: VirtualRowsHost;
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

  const readScrollArea = () => {
    if (!scrollArea) return;
    const { scrollTop, clientHeight: viewport } = scrollArea;
    setView(last => (last.scrollTop === scrollTop && last.viewport === viewport ? last : { scrollTop, viewport }));
  };
  useLayoutEffect(() => {
    if (!scrollArea) return;
    readScrollArea();
    scrollArea.addEventListener('scroll', readScrollArea);
    const resized = new ResizeObserver(readScrollArea);
    resized.observe(scrollArea);
    return () => {
      scrollArea.removeEventListener('scroll', readScrollArea);
      resized.disconnect();
    };
  }, [scrollArea]);
  useLayoutEffect(() => {
    const items = listElement.current?.children ?? [];
    let changed = false;
    for (const [offset, item] of [...items].entries()) {
      const key = keys[start + offset];
      if (key === undefined || !(item instanceof HTMLElement)) continue;
      const height = item.offsetHeight;
      if (measured.current.get(key) === height) continue;
      measured.current.set(key, height);
      changed = true;
    }
    if (changed) remeasured();
    readScrollArea();
    host.rendered();
  });

  const scrollTo = (scrollTop: number) => {
    if (!scrollArea) return;
    scrollArea.scrollTop = scrollTop;
    readScrollArea();
  };
  useImperativeHandle(host.ref, () => ({
    readingPosition: () => readingPositionAt(keys, heights, scrollArea?.scrollTop ?? 0),
    restore: position => scrollTo(restoredScrollTop(position, keys, heights)),
    reveal(key) {
      const index = keys.indexOf(key);
      if (index < 0) return false;
      if (index < start || index >= end) flushSync(() => scrollTo(heightBefore(heights, index)));
      return true;
    },
  }));

  return (
    <ul {...list} ref={listElement} style={{ paddingTop: before, paddingBottom: after }}>
      {keys.slice(start, end).map((_, offset) => row(start + offset))}
    </ul>
  );
}
