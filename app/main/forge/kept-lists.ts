import type { ListFilter, Page } from '../../shared/forge/forge';
import type { ForgeListTab, ForgeListView, ForgeLists, TabList } from '../../shared/forge/sidebar-data';

/** A project's kept lists, with the view the sidebar last declared, where each page a tab loaded ends in its rows (the
 * count of rows through it), the numbers of the shown tab's rows the sidebar renders, and the request that may settle
 * them while it runs. */
export interface KeptLists {
  view: ForgeListView;
  lists: ForgeLists;
  pageEnds: Record<ForgeListTab, number[]>;
  rows: number[];
  request: object | null;
  settled: Promise<void>;
}

/** How a first page or the next one joins a tab's rows: `replace` shows the first page alone, `update` replaces the rows
 * it holds in place and keeps the others, and `append` adds the next page. */
export type Joining = 'replace' | 'update' | 'append';

const noRows = { loaded: null, failed: null };

/** Empty lists on `view`, with no request running. */
export const emptyLists = (view: ForgeListView): KeptLists => ({
  view,
  lists: { issues: noRows, pullRequests: noRows, loading: false },
  pageEnds: { issues: [], pullRequests: [] },
  rows: [],
  request: null,
  settled: Promise.resolve(),
});

export const sameFilter = (a: ListFilter, b: ListFilter) =>
  a.search === b.search && a.state === b.state && a.labels.join('\n') === b.labels.join('\n');

/** `rows` with each one `fresh` also holds replaced in place; the others stay as they were. */
export function replacedInPlace<Item extends { number: number }>(rows: Item[], fresh: Item[]) {
  const answered = new Map(fresh.map(item => [item.number, item]));
  return rows.map(row => answered.get(row.number) ?? row);
}

/** `rows` with each one `fresh` also holds replaced in place, and each new one placed after the row before it in
 * `fresh`, or first. Rows `fresh` does not hold stay where they were. */
export function updatedInPlace<Item extends { number: number }>(rows: Item[], fresh: Item[]) {
  const updated = replacedInPlace(rows, fresh);
  const held = new Set(rows.map(row => row.number));
  let at = 0;
  for (const item of fresh) {
    if (held.has(item.number)) at = updated.findIndex(row => row.number === item.number) + 1;
    else updated.splice(at++, 0, item);
  }
  return updated;
}

/** A tab's rows and page ends once the pages read in `filter` joined `previous` as `joining` says: `items` are their
 * rows, `pageEnds` where each page ends in them, and `last` the last page read, whose failure stands beside the rows. */
export function joinedPages<Item extends { number: number }>(
  previous: TabList<Item>,
  previousEnds: number[],
  filter: ListFilter,
  joining: Joining,
  last: Page<Item>,
  items: Item[],
  pageEnds: number[],
): { rows: TabList<Item>; pageEnds: number[] } {
  if (!last.ok) return { rows: { ...previous, failed: last }, pageEnds: previousEnds };
  const { ok: _, ...page } = last;
  const held = previous.loaded && sameFilter(previous.loaded.filter, filter) ? previous.loaded : null;
  if (joining === 'append' && held) {
    const numbers = new Set(held.items.map(item => item.number));
    const joined = [...held.items, ...items.filter(item => !numbers.has(item.number))];
    return {
      rows: { failed: null, loaded: { ...page, filter, items: joined } },
      pageEnds: [...previousEnds, joined.length],
    };
  }
  if (joining === 'update' && held) {
    const cursor = previousEnds.length > 1 ? held.cursor : page.cursor;
    const updated = updatedInPlace(held.items, items);
    return { rows: { failed: null, loaded: { ...page, filter, items: updated, cursor } }, pageEnds: previousEnds };
  }
  return { rows: { failed: null, loaded: { ...page, filter, items } }, pageEnds };
}

/** How many pages of the shown tab, from the first, hold every row the sidebar renders; at least one. The forge's pages
 * hold the rows by position: a row an update pushed past the pages loaded, by the rows it added above, sits on the pages
 * after them, each as long as the first. */
export function pagesThroughRows(kept: KeptLists) {
  const { tab } = kept.view;
  const items: { number: number }[] = kept.lists[tab].loaded?.items ?? [];
  const rendered = new Set(kept.rows);
  const last = items.findLastIndex(item => rendered.has(item.number));
  const ends = kept.pageEnds[tab];
  const holding = ends.findIndex(end => end > last);
  if (holding >= 0) return holding + 1;
  const pastLoaded = last + 1 - (ends.at(-1) ?? 0);
  return Math.max(ends.length + Math.ceil(pastLoaded / (ends[0] || 1)), 1);
}
