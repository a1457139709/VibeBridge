import { z } from 'zod';
import type { BlockerReference, ChecksConclusion, IssueState, PullRequestState } from '../../shared/forge/forge';

export const labelSchema = z.object({ name: z.string(), color: z.string() });
const closedAs = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate', REOPENED: null } as const;
export const issueStateFields = {
  state: z.enum(['OPEN', 'CLOSED']),
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).nullable(),
};
export const openOrClosed = (state: z.infer<typeof issueStateFields.state>): IssueState =>
  state === 'OPEN' ? 'open' : 'closed';
export const issueState = (issue: z.infer<z.ZodObject<typeof issueStateFields>>) => ({
  state: openOrClosed(issue.state),
  closedAs: issue.state === 'OPEN' || !issue.stateReason ? null : closedAs[issue.stateReason],
});
export const checksState = z.enum(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED']);
export const relatedLimit = 50;
export const issueReferenceSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  ...issueStateFields,
});
export const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export const repositorySchema = z.object({ nameWithOwner: z.string() });
export const pathUnlessSameRepository = (repository: z.infer<typeof repositorySchema>, path: string) =>
  samePath(repository.nameWithOwner, path) ? null : repository.nameWithOwner;
export const blockerSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: issueStateFields.state,
  repository: repositorySchema,
});
export const blockerFields = 'number title state repository { nameWithOwner }';
export const blockerReference = (blocker: z.infer<typeof blockerSchema>, path: string): BlockerReference => ({
  path: pathUnlessSameRepository(blocker.repository, path),
  number: blocker.number,
  title: blocker.title,
});
export const unlistedOpenBlockers = (listed: z.infer<typeof blockerSchema>[], openTotal: number) =>
  Math.max(0, openTotal - listed.filter(blocker => blocker.state === 'OPEN').length);
export const loginSchema = z.object({ login: z.string() }).nullable();
export const issueReferenceFields = 'number title state stateReason url';
export const issueReference = (issue: z.infer<typeof issueReferenceSchema>) => ({
  number: issue.number,
  title: issue.title,
  ...issueState(issue),
  url: issue.url,
});
export const pullRequestState = (state: 'OPEN' | 'MERGED' | 'CLOSED', draft: boolean): PullRequestState =>
  state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : draft ? 'draft' : 'open';
export const viewerPermission = z.enum(['ADMIN', 'MAINTAIN', 'WRITE', 'TRIAGE', 'READ']).nullable();
export const canWrite = (permission: z.infer<typeof viewerPermission>) =>
  permission === 'ADMIN' || permission === 'MAINTAIN' || permission === 'WRITE';
export const repositoryLinks = (url: string) => ({ issuePrefix: `${url}/issues/`, pullRequestPrefix: `${url}/pull/` });
export const answeringFields = 'databaseId nameWithOwner';
export const answeringSchema = { databaseId: z.number(), nameWithOwner: z.string() };
export const answeredBy = (repository: { databaseId: number; nameWithOwner: string }) => ({
  id: String(repository.databaseId),
  path: repository.nameWithOwner,
});

export const statusStateResult = {
  SUCCESS: 'passed',
  FAILURE: 'failed',
  ERROR: 'failed',
  PENDING: 'pending',
  EXPECTED: 'pending',
} as const satisfies Record<z.infer<typeof checksState>, ChecksConclusion>;
export const latestChecks = (commits: {
  nodes: { commit: { statusCheckRollup: { state: z.infer<typeof checksState> } | null } }[];
}): ChecksConclusion => {
  const rollup = commits.nodes[0]?.commit.statusCheckRollup;
  return rollup ? statusStateResult[rollup.state] : 'none';
};
