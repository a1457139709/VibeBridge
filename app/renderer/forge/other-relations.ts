import type { IssueDetail, IssueReference, RelatedIssue } from '../../shared/forge/forge';

interface RelatedIssues {
  issues: RelatedIssue[];
  unlisted: number;
}
export interface OtherRelations {
  blockers: (RelatedIssues & { unresolved: number; allResolved: boolean }) | null;
  unblocks: RelatedIssues | null;
}

export function presentOtherRelations(
  issue: Pick<IssueDetail, 'blockedBy' | 'blockedByTotal' | 'blocking' | 'blockingTotal'>,
  { siblings, blocking }: { siblings: Pick<IssueReference, 'url'>[] | null; blocking: boolean },
): OtherRelations {
  if (!blocking) return { blockers: null, unblocks: null };
  const listed = new Set(siblings?.map(sibling => sibling.url));
  const shown = (issues: RelatedIssue[], total: number): RelatedIssues | null => {
    const related = {
      issues: issues.filter(other => !listed.has(other.url)),
      unlisted: Math.max(0, total - issues.length),
    };
    return related.issues.length || related.unlisted ? related : null;
  };
  const blockers = shown(issue.blockedBy, issue.blockedByTotal);
  const unresolved = blockers?.issues.filter(blocker => blocker.state === 'open').length ?? 0;
  return {
    blockers: blockers && { ...blockers, unresolved, allResolved: !unresolved && !blockers.unlisted },
    unblocks: shown(issue.blocking, issue.blockingTotal),
  };
}
