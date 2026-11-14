import { z } from 'zod';
import type { Check, PullRequestDetail } from '../../shared/forge';
import { graphql } from './github-cli';
import { checksState, issueReference, issueReferenceFields, issueReferenceSchema, labelSchema, loginSchema, pullRequestState, relatedLimit, repositoryLinks, canWrite, viewerPermission } from './github-fields';

// One pull request's read-only detail from GitHub: its timeline and what stands between it and a merge.

const checkContextSchema = z.discriminatedUnion('__typename', [
  z.object({ __typename: z.literal('CheckRun'), name: z.string(), status: z.string(), conclusion: z.string().nullable(), permalink: z.string(), isRequired: z.boolean() }),
  z.object({ __typename: z.literal('StatusContext'), context: z.string(), state: checksState, targetUrl: z.string().nullable(), isRequired: z.boolean() }),
]);
const pullRequestDetailSchema = z.object({ repository: z.object({ url: z.string(), viewerPermission,
  mergeCommitAllowed: z.boolean(), squashMergeAllowed: z.boolean(), rebaseMergeAllowed: z.boolean(), pullRequest: z.object({
  number: z.number(), title: z.string(), state: z.enum(['OPEN', 'MERGED', 'CLOSED']), isDraft: z.boolean(), createdAt: z.string(), url: z.string(),
  bodyHTML: z.string(), author: loginSchema, headRefName: z.string(), baseRefName: z.string(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  closingIssuesReferences: z.object({ nodes: z.array(issueReferenceSchema) }),
  comments: z.object({ totalCount: z.number(), nodes: z.array(z.object({ author: loginSchema, createdAt: z.string(), bodyHTML: z.string() })) }),
  reviews: z.object({ nodes: z.array(z.object({ author: loginSchema, state: z.enum(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']),
    submittedAt: z.string().nullable(), bodyHTML: z.string(), comments: z.object({ totalCount: z.number() }) })) }),
  reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
  baseRef: z.object({ refUpdateRule: z.object({ requiredApprovingReviewCount: z.number().nullable() }).nullable() }).nullable(),
  mergeable: z.enum(['MERGEABLE', 'CONFLICTING', 'UNKNOWN']),
  isMergeQueueEnabled: z.boolean(),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ contexts: z.object({ nodes: z.array(checkContextSchema) }) }).nullable() }) })) }),
}) }) });
// Closing issues may be in other repositories; their URLs say where.
// `refUpdateRule` is the base branch's protection as the viewer may read it; `isRequired` asks whether a check is required for this pull request.
const pullRequestDetailQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { url viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number: $number) {
    number title state isDraft createdAt url bodyHTML author { login } headRefName baseRefName
    labels(first: 20) { nodes { name color } }
    closingIssuesReferences(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    comments(first: 100) { totalCount nodes { author { login } createdAt bodyHTML } }
    reviews(first: 100) { nodes { author { login } state submittedAt bodyHTML comments { totalCount } } }
    reviewDecision baseRef { refUpdateRule { requiredApprovingReviewCount } } mergeable isMergeQueueEnabled
    commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename
      ... on CheckRun { name status conclusion permalink isRequired(pullRequestNumber: $number) }
      ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }
    } } } } } }
  } }
}`;
const reviewState = { APPROVED: 'approved', CHANGES_REQUESTED: 'changesRequested', REVIEW_REQUIRED: 'required' } as const;
const conflicts = { MERGEABLE: 'none', CONFLICTING: 'conflicting', UNKNOWN: 'unknown' } as const;
/** A check run's result: pending until it completes, then by its conclusion; neutral, skipped and stale runs do not count against a merge. */
const checkRunResult = (status: string, conclusion: string | null): Check['result'] =>
  status !== 'COMPLETED' || conclusion === null ? 'pending' : conclusion === 'SUCCESS' ? 'passed' : ['NEUTRAL', 'SKIPPED', 'STALE'].includes(conclusion) ? 'skipped' : 'failed';
const statusResult = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'pending', EXPECTED: 'pending' } as const;
const check = (context: z.infer<typeof checkContextSchema>): Check => context.__typename === 'CheckRun'
  ? { name: context.name, result: checkRunResult(context.status, context.conclusion), required: context.isRequired, url: context.permalink }
  : { name: context.context, result: statusResult[context.state], required: context.isRequired, url: context.targetUrl };
const reviewVerdict = { COMMENTED: 'commented', APPROVED: 'approved', CHANGES_REQUESTED: 'changesRequested', DISMISSED: 'dismissed' } as const;

/** One pull request of the repository at `path` with its rendered body, timeline and merge requirements. */
export async function pullRequestDetail(path: string, number: number): Promise<PullRequestDetail> {
  const [owner, name] = path.split('/');
  const { repository } = await graphql(pullRequestDetailQuery, { owner, name, number }, pullRequestDetailSchema);
  const { pullRequest: pull } = repository;
  // A pending review is the viewer's own, not yet submitted. Replies to code comments arrive as reviews without a summary.
  const reviews = pull.reviews.nodes.flatMap(({ state, submittedAt, ...review }) => state === 'PENDING' || submittedAt === null ? [] : [{ ...review, state, submittedAt }]);
  const timeline = [
    ...pull.comments.nodes.map(comment => ({ author: comment.author?.login ?? null, createdAt: comment.createdAt, html: comment.bodyHTML, verdict: null })),
    ...reviews.filter(review => review.bodyHTML.trim()).map(review =>
      ({ author: review.author?.login ?? null, createdAt: review.submittedAt, html: review.bodyHTML, verdict: reviewVerdict[review.state] })),
  ].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return {
    number: pull.number, title: pull.title, state: pullRequestState(pull.state, pull.isDraft), createdAt: pull.createdAt,
    author: pull.author?.login ?? null, labels: pull.labels.nodes,
    url: pull.url, changesUrl: `${pull.url}/files`, head: pull.headRefName, base: pull.baseRefName, body: pull.bodyHTML,
    timeline, commentCount: pull.comments.totalCount, codeComments: reviews.reduce((sum, review) => sum + review.comments.totalCount, 0),
    closingIssues: pull.closingIssuesReferences.nodes.map(issueReference),
    links: repositoryLinks(repository.url),
    review: { state: pull.reviewDecision ? reviewState[pull.reviewDecision] : 'notRequired',
      requiredApprovals: pull.baseRef?.refUpdateRule?.requiredApprovingReviewCount || null },
    checks: (pull.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(check),
    conflicts: conflicts[pull.mergeable],
    merge: { methods: ([['merge', repository.mergeCommitAllowed], ['squash', repository.squashMergeAllowed], ['rebase', repository.rebaseMergeAllowed]] as const)
      .filter(([, allowed]) => allowed).map(([method]) => method), queue: pull.isMergeQueueEnabled },
    canWrite: canWrite(repository.viewerPermission),
  };
}
