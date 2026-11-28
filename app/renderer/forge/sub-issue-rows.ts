import type { BlockerReference, RelatedBlocker, SubIssue } from '../../shared/forge/forge';

export type SubIssueRelation = 'highlighted' | 'blocksHighlighted' | 'blockedByHighlighted' | 'unrelated';

export interface SubIssueRow {
  key: string;
  issue: SubIssue;
  relation: SubIssueRelation | null;
  openBlockers: RelatedBlocker[];
  unlistedBlockers: number;
  dispatchable: boolean;
}

export const subIssueKey = (issue: Pick<BlockerReference, 'path' | 'number'>) => `${issue.path ?? ''}#${issue.number}`;

export function presentSubIssueRows(
  subIssues: SubIssue[],
  { highlighted, current, blocking }: { highlighted: string | null; current: string | null; blocking: boolean },
): SubIssueRow[] {
  const highlightedIssue = blocking ? subIssues.find(issue => subIssueKey(issue) === highlighted) : undefined;
  const highlightedBlockers = new Set(highlightedIssue?.blockedBy.map(subIssueKey));
  const relationOf = (issue: SubIssue, key: string): SubIssueRelation | null => {
    if (!highlightedIssue) return null;
    if (key === highlighted) return 'highlighted';
    if (highlightedBlockers.has(key)) return 'blocksHighlighted';
    if (issue.blockedBy.some(blocker => subIssueKey(blocker) === highlighted)) return 'blockedByHighlighted';
    return 'unrelated';
  };
  return subIssues.map(issue => {
    const key = subIssueKey(issue);
    const openBlockers =
      blocking && issue.state === 'open' ? issue.blockedBy.filter(blocker => blocker.state === 'open') : [];
    return {
      key,
      issue,
      relation: relationOf(issue, key),
      openBlockers,
      unlistedBlockers: openBlockers.length ? issue.unlistedBlockers : 0,
      dispatchable: issue.state === 'open' && issue.path === null && key !== current,
    };
  });
}
