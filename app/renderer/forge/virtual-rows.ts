/** Which of a long list's rows render: the rows in view and `overscan` rows around them, `start` to `end` (exclusive),
 * with the space the rows before and after them take. */
export interface RowWindow {
  start: number;
  end: number;
  before: number;
  after: number;
}

/** Where the list's scrolled view is, and how many rows to render beyond it on each side. */
export interface ViewOfRows {
  scrollTop: number;
  viewport: number;
  overscan: number;
}

/** Where a list was being read: the row at the top of the view, its place in the list, and how far it was scrolled
 * past. */
export interface ReadingPosition {
  key: number;
  index: number;
  offset: number;
}

/** How far from the top of the list the row at `index` starts: the height of the rows before it. */
export const heightBefore = (heights: number[], index: number) =>
  heights.slice(0, index).reduce((total, height) => total + height, 0);

/** The index of the row at `offset` from the top of the list: the last row when the list is shorter. */
function rowAt(heights: number[], offset: number) {
  let top = 0;
  for (const [index, height] of heights.entries()) {
    if (top + height > offset) return index;
    top += height;
  }
  return heights.length - 1;
}

/** The rows of `heights` to render for `view`. */
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

/** The reading position of rows `keys`, `heights` high, scrolled to `scrollTop`; null with no rows. */
export function readingPositionAt(keys: number[], heights: number[], scrollTop: number): ReadingPosition | null {
  if (!keys.length) return null;
  const index = rowAt(heights, scrollTop);
  return { key: keys[index], index, offset: scrollTop - heightBefore(heights, index) };
}

/** Where to scroll rows `keys`, `heights` high, to return to `position`: to its row wherever it now is, or, when that
 * row is gone, to the row now at its place. */
export function restoredScrollTop(position: ReadingPosition, keys: number[], heights: number[]) {
  if (!keys.length) return 0;
  const found = keys.indexOf(position.key);
  const index = found >= 0 ? found : Math.min(position.index, keys.length - 1);
  return heightBefore(heights, index) + position.offset;
}
