export interface RowWindow {
  start: number;
  end: number;
  before: number;
  after: number;
}

export interface ViewOfRows {
  scrollTop: number;
  viewport: number;
  overscan: number;
}

export interface ReadingPosition {
  key: number;
  index: number;
  offset: number;
}

export const heightBefore = (heights: number[], index: number) =>
  heights.slice(0, index).reduce((total, height) => total + height, 0);

function rowAt(heights: number[], offset: number) {
  let top = 0;
  for (const [index, height] of heights.entries()) {
    if (top + height > offset) return index;
    top += height;
  }
  return heights.length - 1;
}

export function rowWindow(heights: number[], { scrollTop, viewport, overscan }: ViewOfRows): RowWindow {
  if (!heights.length) return { start: 0, end: 0, before: 0, after: 0 };
  const first = rowAt(heights, scrollTop);
  const last = viewport > 0 ? rowAt(heights, scrollTop + viewport - 1) : first;
  const start = Math.max(first - overscan, 0);
  const end = Math.min(last + 1 + overscan, heights.length);
  return {
    start,
    end,
    before: heightBefore(heights, start),
    after: heightBefore(heights, heights.length) - heightBefore(heights, end),
  };
}

export function readingPositionAt(keys: number[], heights: number[], scrollTop: number): ReadingPosition | null {
  if (!keys.length) return null;
  const index = rowAt(heights, scrollTop);
  return { key: keys[index], index, offset: scrollTop - heightBefore(heights, index) };
}

export function restoredScrollTop(position: ReadingPosition, keys: number[], heights: number[]) {
  if (!keys.length) return 0;
  const found = keys.indexOf(position.key);
  const index = found >= 0 ? found : Math.min(position.index, keys.length - 1);
  return heightBefore(heights, index) + position.offset;
}
