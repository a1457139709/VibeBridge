import type { BlockerReference, RelatedBlocker, SubIssue } from '../../shared/forge/forge';

export type SubIssueRelation = 'lit' | 'blocksLit' | 'blockedByLit' | 'unrelated';

export interface SubIssueRow {
  key: string;
  issue: SubIssue;
  relation: SubIssueRelation | null;
  openBlockers: RelatedBlocker[];
  unlistedBlockers: number;
}

export const subIssueKey = (issue: Pick<BlockerReference, 'path' | 'number'>) => `${issue.path ?? ''}#${issue.number}`;

export function presentSubIssueRows(
  subIssues: SubIssue[],
  { lit, blocking }: { lit: string | null; blocking: boolean },
): SubIssueRow[] {
  const litIssue = blocking ? subIssues.find(issue => subIssueKey(issue) === lit) : undefined;
  const litBlockers = new Set(litIssue?.blockedBy.map(subIssueKey));
  const relationOf = (issue: SubIssue, key: string): SubIssueRelation | null => {
    if (!litIssue) return null;
    if (key === lit) return 'lit';
    if (litBlockers.has(key)) return 'blocksLit';
    if (issue.blockedBy.some(blocker => subIssueKey(blocker) === lit)) return 'blockedByLit';
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
    };
  });
}
