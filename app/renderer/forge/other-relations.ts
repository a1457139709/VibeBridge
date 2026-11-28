import type { IssueDetail, IssueReference } from '../../shared/forge/forge';

export interface OtherRelations {
  blockers: { issues: IssueReference[]; unresolved: number } | null;
  unblocks: IssueReference[] | null;
}

export function presentOtherRelations(
  issue: Pick<IssueDetail, 'blockedBy' | 'blocking'>,
  { siblings, blocking }: { siblings: Pick<IssueReference, 'url'>[] | null; blocking: boolean },
): OtherRelations {
  if (!blocking) return { blockers: null, unblocks: null };
  const listed = new Set(siblings?.map(sibling => sibling.url));
  const unlisted = (issues: IssueReference[]) => issues.filter(related => !listed.has(related.url));
  const blockers = unlisted(issue.blockedBy);
  const unblocks = unlisted(issue.blocking);
  return {
    blockers: blockers.length
      ? { issues: blockers, unresolved: blockers.filter(blocker => blocker.state === 'open').length }
      : null,
    unblocks: unblocks.length ? unblocks : null,
  };
}
