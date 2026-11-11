import type { KeyboardEvent } from 'react';

/** Marks an issue row in the sidebar; its value is the issue number. Rows nest: a sub-issue's row lies inside its parent's. */
export const issueRowAttribute = 'data-issue-row';

/** The row of an issue shown under `container`, if it is shown. */
export function issueRow(container: Element | null | undefined, number: number) {
  return container?.querySelector<HTMLElement>(`[${issueRowAttribute}="${number}"]`) ?? null;
}

/** The row focus enters the list on: the one reachable by Tab, else the first. */
export function entryRow(container: Element) {
  return container.querySelector<HTMLElement>(`[${issueRowAttribute}][tabindex="0"]`) ?? container.querySelector<HTMLElement>(`[${issueRowAttribute}]`);
}

interface RowState { expandable: boolean; expanded: boolean; setExpanded(expanded: boolean): void; open(): void }

/**
 * The fixed keys on a focused issue row. Things that unfold to the left are entered with ←
 * and left with →: ↑/↓ move through the rows shown without wrapping, ← expands the
 * sub-issues and then enters the first, → collapses them and then climbs to the parent,
 * Space or Enter opens the detail. Escape does nothing. Keys inside the row's controls,
 * or with modifiers, are left alone.
 */
export function issueRowKeyDown(event: KeyboardEvent<HTMLElement>, row: RowState) {
  const item = event.currentTarget;
  if (event.target !== item || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
  const rows = [...(item.closest('.issue-list') ?? item.ownerDocument).querySelectorAll<HTMLElement>(`[${issueRowAttribute}]`)];
  const index = rows.indexOf(item);
  if (event.key === 'ArrowUp') rows[index - 1]?.focus();
  else if (event.key === 'ArrowDown') rows[index + 1]?.focus();
  else if (event.key === 'ArrowLeft') {
    if (row.expandable && !row.expanded) row.setExpanded(true);
    else if (row.expanded) item.querySelector<HTMLElement>(`[${issueRowAttribute}]`)?.focus();
  } else if (event.key === 'ArrowRight') {
    if (row.expanded) row.setExpanded(false);
    else item.parentElement?.closest<HTMLElement>(`[${issueRowAttribute}]`)?.focus();
  } else if (event.key === ' ' || event.key === 'Enter') row.open();
  else if (event.key !== 'Escape') return;
  event.preventDefault();
}
