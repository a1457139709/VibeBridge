import { useImperativeHandle, useState, type Ref, type RefCallback } from 'react';
import { flushSync } from 'react-dom';
import { useShownForgeRows } from './sidebar-reports';
import { heightBefore, readingPositionAt, restoredScrollTop, rowWindow, type ReadingPosition } from './virtual-rows';

const overscan = 4;
const unmeasuredRowHeight = 56;

function expectedRowHeight(measured: ReadonlyMap<number, number>) {
  if (!measured.size) return unmeasuredRowHeight;
  return [...measured.values()].reduce((total, height) => total + height, 0) / measured.size;
}

export interface VirtualRowsHandle {
  readingPosition(): ReadingPosition | null;
  restore(position: ReadingPosition): void;
  reveal(key: number): boolean;
}

export interface ScrollAreaView {
  scrollTop: number;
  viewport: number;
}

export interface VirtualRowsHost {
  projectId: string;
  view: ScrollAreaView;
  scrollTo(scrollTop: number): void;
  ref: Ref<VirtualRowsHandle>;
  failed(error: unknown): void;
}

export function VirtualRows({
  host,
  keys,
  row,
  shownNumbers = index => [keys[index]],
  ...list
}: {
  host: VirtualRowsHost;
  keys: number[];
  row(index: number, measure: RefCallback<HTMLLIElement>): React.ReactNode;
  shownNumbers?(index: number): number[];
} & Omit<React.HTMLAttributes<HTMLUListElement>, 'children'>) {
  const [measured, setMeasured] = useState<ReadonlyMap<number, number>>(new Map());
  const expected = expectedRowHeight(measured);
  const heights = keys.map(key => measured.get(key) ?? expected);
  const { start, end, before, after } = rowWindow(heights, { ...host.view, overscan });
  const rendered = keys.slice(start, end).map((_, offset) => start + offset);
  useShownForgeRows(host.projectId, rendered.flatMap(shownNumbers), host.failed);

  const measure =
    (key: number): RefCallback<HTMLLIElement> =>
    item => {
      if (!item) return;
      const height = item.offsetHeight;
      setMeasured(last => (last.get(key) === height ? last : new Map(last).set(key, height)));
    };
  useImperativeHandle(host.ref, () => ({
    readingPosition: () => readingPositionAt(keys, heights, host.view.scrollTop),
    restore: position => host.scrollTo(restoredScrollTop(position, keys, heights)),
    reveal(key) {
      const index = keys.indexOf(key);
      if (index < 0) return false;
      if (index < start || index >= end) flushSync(() => host.scrollTo(heightBefore(heights, index)));
      return true;
    },
  }));

  return (
    <ul {...list} style={{ paddingTop: before, paddingBottom: after }}>
      {rendered.map(index => row(index, measure(keys[index])))}
    </ul>
  );
}
