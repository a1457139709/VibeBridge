import type { Check, IssueLabel, MergeMethod, MergeRequestDetail, MergeRoute, MergeRequestReview, ReviewDecision, ReviewState } from '../../shared/code-hosting';
import { PlatformError, type CommandEnvironment } from './platform';
import { commentFields, description, graphql, issueComment, labelFields, listLabels, ownerAndName, pullRequestStates, relatedIssue, relatedIssueFields, writable,
  type CommentNode, type PageInfo, type RelatedIssueNode } from './github-graphql';

// A pull request's detail: the GitHub adapter's reading of a merge request.

const checkFields = `__typename
  ... on CheckRun { name status conclusion detailsUrl isRequired(pullRequestNumber: $number) }
  ... on StatusContext { context state targetUrl isRequired(pullRequestNumber: $number) }`;
const query = `query($owner: String!, $name: String!, $number: Int!, $comments: String, $reviews: String) {
  repository(owner: $owner, name: $name) { viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed
    pullRequest(number: $number) { number title state isDraft createdAt url author { login } ${labelFields}
      headRefName baseRefName isCrossRepository headRepositoryOwner { login } bodyHTML
      comments(first: 100, after: $comments) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }
      reviews(first: 100, after: $reviews) { nodes { author { login } state submittedAt bodyHTML url comments { totalCount } } pageInfo { hasNextPage endCursor } }
      closingIssuesReferences(first: 50) { nodes { ${relatedIssueFields} } }
      reviewDecision mergeable isMergeQueueEnabled mergeStateStatus viewerCanEnableAutoMerge
      commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { ${checkFields} } } } } } } } } }`;

type CheckNode = { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null; detailsUrl: string | null; isRequired: boolean }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; isRequired: boolean };
interface ReviewNode { author: { login: string } | null; state: string; submittedAt: string | null; bodyHTML: string; url: string; comments: { totalCount: number } }
interface PullRequestDetailNode {
  number: number; title: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean; createdAt: string; url: string;
  author: { login: string } | null; labels: { nodes: IssueLabel[] };
  headRefName: string; baseRefName: string; isCrossRepository: boolean; headRepositoryOwner: { login: string } | null; bodyHTML: string;
  comments: { nodes: CommentNode[]; pageInfo: PageInfo };
  reviews: { nodes: ReviewNode[]; pageInfo: PageInfo };
  closingIssuesReferences: { nodes: RelatedIssueNode[] };
  reviewDecision: string | null; mergeable: string; isMergeQueueEnabled: boolean; mergeStateStatus: string; viewerCanEnableAutoMerge: boolean;
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: CheckNode[] } } | null } }[] };
}
interface DetailPage { repository: { viewerPermission: string | null; mergeCommitAllowed: boolean; squashMergeAllowed: boolean; rebaseMergeAllowed: boolean; pullRequest: PullRequestDetailNode | null } }

const decisions: Record<string, ReviewDecision> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changesRequested', REVIEW_REQUIRED: 'reviewRequired' };
// PENDING is the viewer's own unsubmitted review, which is not part of the conversation yet.
const reviewStates: Record<string, ReviewState> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changesRequested', COMMENTED: 'commented', DISMISSED: 'dismissed' };
const passedRuns = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const statusConclusions = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' } as const;

/**
 * A base branch with a merge queue merges only through it. Otherwise GitHub has no setting that requires auto-merge;
 * what it reads as such is branch protection blocking a direct merge (BLOCKED) while it offers this viewer auto-merge
 * instead, which is the route its own merge box then offers.
 */
function mergeThrough(node: PullRequestDetailNode): MergeRoute | null {
  if (node.isMergeQueueEnabled) return 'mergeQueue';
  return node.mergeStateStatus === 'BLOCKED' && node.viewerCanEnableAutoMerge ? 'autoMerge' : null;
}

/** Check runs report a status and, once completed, a conclusion; commit statuses report one state. */
function check(node: CheckNode): Check {
  if (node.__typename === 'CheckRun') {
    const conclusion = node.status !== 'COMPLETED' ? 'pending' : passedRuns.has(node.conclusion ?? '') ? 'passing' : 'failing';
    return { name: node.name, conclusion, required: node.isRequired, url: node.detailsUrl };
  }
  return { name: node.context, conclusion: statusConclusions[node.state as keyof typeof statusConclusions] ?? 'pending', required: node.isRequired, url: node.targetUrl };
}

function reviews(nodes: ReviewNode[]): MergeRequestReview[] {
  return nodes.flatMap(node => {
    const state = reviewStates[node.state];
    return state && node.submittedAt ? [{ author: node.author?.login ?? null, state, submittedAt: node.submittedAt, body: node.bodyHTML,
      codeComments: node.comments.totalCount, url: node.url }] : [];
  });
}

/** The repository's pull request with that number, reading every page of its comments and reviews. A missing one throws an unreachable PlatformError. */
export async function mergeRequest(environment: CommandEnvironment, path: string, number: number): Promise<MergeRequestDetail> {
  const { owner, name } = ownerAndName(path);
  const read = async (comments: string | null, reviews: string | null) => {
    const { repository } = await graphql<DetailPage>(environment, query,
      { owner, name, number, ...(comments ? { comments } : {}), ...(reviews ? { reviews } : {}) });
    if (!repository.pullRequest) throw new PlatformError('unreachable', description, `#${number}`);
    return { repository, node: repository.pullRequest };
  };
  const { repository, node } = await read(null, null);
  const comments = [...node.comments.nodes];
  const reviewNodes = [...node.reviews.nodes];
  // A connection already read to its end gives an empty page from its end cursor.
  for (let pages = [node.comments.pageInfo, node.reviews.pageInfo]; pages.some(page => page.hasNextPage);) {
    const { node: next } = await read(pages[0].endCursor, pages[1].endCursor);
    comments.push(...next.comments.nodes);
    reviewNodes.push(...next.reviews.nodes);
    pages = [next.comments.pageInfo, next.reviews.pageInfo];
  }
  const methods: MergeMethod[] = [...(repository.mergeCommitAllowed ? ['merge' as const] : []), ...(repository.squashMergeAllowed ? ['squash' as const] : []),
    ...(repository.rebaseMergeAllowed ? ['rebase' as const] : [])];
  const head = node.isCrossRepository && node.headRepositoryOwner ? `${node.headRepositoryOwner.login}:${node.headRefName}` : node.headRefName;
  return { number: node.number, title: node.title, state: pullRequestStates[node.state], draft: node.isDraft, author: node.author?.login ?? null,
    createdAt: node.createdAt, labels: listLabels(node.labels), url: node.url, changesUrl: `${node.url}/files`,
    head, base: node.baseRefName, body: node.bodyHTML, comments: comments.map(issueComment), reviews: reviews(reviewNodes),
    closingIssues: node.closingIssuesReferences.nodes.map(relatedIssue),
    merge: { review: decisions[node.reviewDecision ?? ''] ?? null, checks: (node.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(check),
      conflicting: node.mergeable === 'CONFLICTING', methods, mergeThrough: mergeThrough(node) }, writable: writable(repository.viewerPermission) };
}
