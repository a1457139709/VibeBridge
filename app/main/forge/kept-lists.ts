import type { ListFilter, Page } from '../../shared/forge/forge';
import type { ForgeListTab, ForgeListView, ForgeLists, TabList } from '../../shared/forge/sidebar-data';

export interface KeptLists {
  view: ForgeListView;
  lists: ForgeLists;
  pageEnds: Record<ForgeListTab, number[]>;
  rows: number[];
  request: object | null;
  settled: Promise<void>;
}

export type Joining = 'replace' | 'update' | 'append';

const noRows = { loaded: null, failed: null };

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

export function replacedInPlace<Item extends { number: number }>(rows: Item[], fresh: Item[]) {
  const answered = new Map(fresh.map(item => [item.number, item]));
  return rows.map(row => answered.get(row.number) ?? row);
}

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
    const cursor = previousEnds.length > 1 ? held.nextCursor : page.nextCursor;
    const updated = updatedInPlace(held.items, items);
    return {
      rows: { failed: null, loaded: { ...page, filter, items: updated, nextCursor: cursor } },
      pageEnds: previousEnds,
    };
  }
  return { rows: { failed: null, loaded: { ...page, filter, items } }, pageEnds };
}

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
