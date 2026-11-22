import { z } from 'zod';
import type {
  Check,
  CheckState,
  PullRequestDetail,
  RepositoryReference,
  TimelineEntry,
} from '../../shared/forge/forge';
import { graphql } from './github-cli';
import {
  issueReference,
  issueReferenceFields,
  issueReferenceSchema,
  labelSchema,
  loginSchema,
  pullRequestState,
  relatedLimit,
  repositoryLinks,
  canWrite,
  viewerPermission,
  answeredBy,
  answeringFields,
  answeringSchema,
} from './github-fields';
import type { Answered } from './forge';

const checkContextSchema = z.discriminatedUnion('__typename', [
  z.object({
    __typename: z.literal('CheckRun'),
    name: z.string(),
    status: z.string(),
    conclusion: z.string().nullable(),
    title: z.string().nullable(),
    startedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    permalink: z.string(),
    isRequired: z.boolean(),
    checkSuite: z.object({ workflowRun: z.object({ workflow: z.object({ name: z.string() }) }).nullable() }).nullable(),
  }),
  z.object({
    __typename: z.literal('StatusContext'),
    context: z.string(),
    state: z.string(),
    description: z.string().nullable(),
    targetUrl: z.string().nullable(),
    isRequired: z.boolean(),
  }),
]);
const stateCountsSchema = z.array(z.object({ state: z.string(), count: z.number() })).nullable();
const pullRequestDetailSchema = z.object({
  repository: z.object({
    ...answeringSchema,
    url: z.string(),
    viewerPermission,
    mergeCommitAllowed: z.boolean(),
    squashMergeAllowed: z.boolean(),
    rebaseMergeAllowed: z.boolean(),
    pullRequest: z.object({
      number: z.number(),
      title: z.string(),
      state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
      isDraft: z.boolean(),
      createdAt: z.string(),
      url: z.string(),
      bodyHTML: z.string(),
      author: loginSchema,
      headRefName: z.string(),
      baseRefName: z.string(),
      labels: z.object({ nodes: z.array(labelSchema) }),
      closingIssuesReferences: z.object({ nodes: z.array(issueReferenceSchema) }),
      comments: z.object({
        totalCount: z.number(),
        nodes: z.array(z.object({ author: loginSchema, createdAt: z.string(), bodyHTML: z.string() })),
      }),
      reviews: z.object({
        totalCount: z.number(),
        nodes: z.array(
          z.object({
            author: loginSchema,
            state: z.enum(['PENDING', 'COMMENTED', 'APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']),
            createdAt: z.string(),
            submittedAt: z.string().nullable(),
            bodyHTML: z.string(),
          }),
        ),
      }),
      reviewDecision: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'REVIEW_REQUIRED']).nullable(),
      mergeStateStatus: z.enum(['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'DIRTY', 'BEHIND', 'BLOCKED', 'DRAFT', 'UNKNOWN']),
      isMergeQueueEnabled: z.boolean(),
      checksUrl: z.string(),
      commits: z.object({
        nodes: z.array(
          z.object({
            commit: z.object({
              statusCheckRollup: z
                .object({
                  state: z.string(),
                  contexts: z.object({
                    totalCount: z.number(),
                    checkRunCountsByState: stateCountsSchema,
                    statusContextCountsByState: stateCountsSchema,
                    nodes: z.array(checkContextSchema),
                  }),
                })
                .nullable(),
            }),
          }),
        ),
      }),
    }),
  }),
});
const checksLimit = 100,
  timelineLimit = 100;
const pullRequestDetailQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { ${answeringFields} url viewerPermission mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed pullRequest(number: $number) {
    number title state isDraft createdAt url bodyHTML author { login } headRefName baseRefName
    labels(first: 20) { nodes { name color } }
    closingIssuesReferences(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    comments(last: ${timelineLimit}) { totalCount nodes { author { login } createdAt bodyHTML } }
    reviews(last: ${timelineLimit}) { totalCount nodes { author { login } state createdAt submittedAt bodyHTML } }
    reviewDecision mergeStateStatus isMergeQueueEnabled checksUrl
    commits(last: 1) { nodes { commit { statusCheckRollup { state contexts(first: ${checksLimit}) {
      totalCount checkRunCountsByState { state count } statusContextCountsByState { state count }
      nodes { __typename
        ... on CheckRun { name status conclusion title startedAt completedAt permalink isRequired(pullRequestNumber: $number)
          checkSuite { workflowRun { workflow { name } } } }
        ... on StatusContext { context state description targetUrl isRequired(pullRequestNumber: $number) }
      }
    } } } } }
  } }
}`;
const reviewDecision = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  REVIEW_REQUIRED: 'reviewRequired',
} as const;
const mergeState = {
  CLEAN: 'clean',
  HAS_HOOKS: 'hasHooks',
  UNSTABLE: 'unstable',
  DIRTY: 'dirty',
  BEHIND: 'behind',
  BLOCKED: 'blocked',
  DRAFT: null,
  UNKNOWN: 'unknown',
} as const;
const checkStates = new Map<string, CheckState>(
  Object.entries({
    QUEUED: { outcome: 'queued', tone: 'pending' },
    IN_PROGRESS: { outcome: 'inProgress', tone: 'pending' },
    WAITING: { outcome: 'waiting', tone: 'pending' },
    PENDING: { outcome: 'pending', tone: 'pending' },
    REQUESTED: { outcome: 'requested', tone: 'pending' },
    EXPECTED: { outcome: 'expected', tone: 'pending' },
    COMPLETED: { outcome: 'completed', tone: 'neutral' },
    SUCCESS: { outcome: 'success', tone: 'passed' },
    FAILURE: { outcome: 'failure', tone: 'failed' },
    ERROR: { outcome: 'error', tone: 'failed' },
    CANCELLED: { outcome: 'cancelled', tone: 'failed' },
    TIMED_OUT: { outcome: 'timedOut', tone: 'failed' },
    ACTION_REQUIRED: { outcome: 'actionRequired', tone: 'failed' },
    STARTUP_FAILURE: { outcome: 'startupFailure', tone: 'failed' },
    NEUTRAL: { outcome: 'neutral', tone: 'neutral' },
    SKIPPED: { outcome: 'skipped', tone: 'neutral' },
    STALE: { outcome: 'stale', tone: 'neutral' },
  } as const satisfies Record<string, CheckState>),
);
const checkState = (raw: string): CheckState =>
  checkStates.get(raw) ?? { outcome: 'unrecognized', raw, tone: 'neutral' };
const check = (context: z.infer<typeof checkContextSchema>): Check =>
  context.__typename === 'CheckRun'
    ? {
        ...checkState(context.status === 'COMPLETED' && context.conclusion ? context.conclusion : context.status),
        workflow: context.checkSuite?.workflowRun?.workflow.name ?? null,
        name: context.name,
        description: context.title,
        required: context.isRequired,
        startedAt: context.startedAt,
        completedAt: context.completedAt,
        url: context.permalink,
      }
    : {
        ...checkState(context.state),
        workflow: null,
        name: context.context,
        description: context.description,
        required: context.isRequired,
        startedAt: null,
        completedAt: null,
        url: context.targetUrl,
      };
type FetchedPullRequest = z.infer<typeof pullRequestDetailSchema>['repository']['pullRequest'];
function pullRequestChecks(pull: FetchedPullRequest) {
  const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup;
  const counts = new Map<string, CheckState & { count: number }>();
  for (const { state, count } of [
    ...(rollup?.contexts.checkRunCountsByState ?? []),
    ...(rollup?.contexts.statusContextCountsByState ?? []),
  ]) {
    const counting = checkState(state);
    const key = counting.outcome === 'unrecognized' ? `unrecognized ${counting.raw}` : counting.outcome;
    const counted = counts.get(key);
    if (count) counts.set(key, { ...counting, count: (counted?.count ?? 0) + count });
  }
  return {
    state: rollup ? checkState(rollup.state) : null,
    counts: [...counts.values()],
    total: rollup?.contexts.totalCount ?? 0,
    url: pull.checksUrl,
    listed: (rollup?.contexts.nodes ?? []).map(check),
  };
}
const reviewVerdict = {
  COMMENTED: 'commented',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changesRequested',
  DISMISSED: 'dismissed',
} as const;

const leftOutBefore = (connection: { totalCount: number; nodes: unknown[] }, fetchedTimes: string[]) =>
  connection.totalCount > connection.nodes.length ? fetchedTimes.toSorted()[0] : undefined;

function latestTimeline({ comments, reviews }: FetchedPullRequest) {
  const fetched: { entry: TimelineEntry; entersTimeline: boolean }[] = [
    ...comments.nodes.map(comment => ({
      entry: {
        author: comment.author?.login ?? null,
        createdAt: comment.createdAt,
        html: comment.bodyHTML,
        verdict: null,
      },
      entersTimeline: true,
    })),
    ...reviews.nodes.map(({ state, submittedAt, createdAt, ...review }) => ({
      entry: {
        author: review.author?.login ?? null,
        createdAt: submittedAt ?? createdAt,
        html: review.bodyHTML,
        verdict: state === 'PENDING' ? null : reviewVerdict[state],
      },
      entersTimeline: state !== 'PENDING' && submittedAt !== null && !!review.bodyHTML.trim(),
    })),
  ].sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt));
  const timelineStart = [
    leftOutBefore(
      comments,
      comments.nodes.map(comment => comment.createdAt),
    ),
    leftOutBefore(
      reviews,
      reviews.nodes.map(review => review.submittedAt ?? review.createdAt),
    ),
  ]
    .filter(time => time !== undefined)
    .toSorted()
    .at(-1);
  const timeline: TimelineEntry[] = [];
  let coveredEntries = 0;
  for (const { entry, entersTimeline } of fetched.reverse()) {
    if (timeline.length === timelineLimit || (timelineStart !== undefined && entry.createdAt < timelineStart)) break;
    coveredEntries++;
    if (entersTimeline) timeline.unshift(entry);
  }
  return { timeline, earlierEntries: comments.totalCount + reviews.totalCount - coveredEntries };
}

export async function fetchPullRequestDetail(
  { host, path }: RepositoryReference,
  number: number,
): Promise<Answered<PullRequestDetail>> {
  const [owner, name] = path.split('/');
  const { repository } = await graphql(host, pullRequestDetailQuery, { owner, name, number }, pullRequestDetailSchema);
  const { pullRequest: pull } = repository;
  const { timeline, earlierEntries } = latestTimeline(pull);
  const detail: PullRequestDetail = {
    number: pull.number,
    title: pull.title,
    state: pullRequestState(pull.state, pull.isDraft),
    createdAt: pull.createdAt,
    author: pull.author?.login ?? null,
    labels: pull.labels.nodes,
    url: pull.url,
    changesUrl: `${pull.url}/files`,
    head: pull.headRefName,
    base: pull.baseRefName,
    body: pull.bodyHTML,
    timeline,
    earlierEntries,
    closingIssues: pull.closingIssuesReferences.nodes.map(issueReference),
    links: repositoryLinks(repository.url),
    reviewDecision: pull.reviewDecision && reviewDecision[pull.reviewDecision],
    checks: pullRequestChecks(pull),
    mergeState: mergeState[pull.mergeStateStatus],
    mergeOptions: {
      methods: (
        [
          ['merge', repository.mergeCommitAllowed],
          ['squash', repository.squashMergeAllowed],
          ['rebase', repository.rebaseMergeAllowed],
        ] as const
      )
        .filter(([, allowed]) => allowed)
        .map(([method]) => method),
      queue: pull.isMergeQueueEnabled,
    },
    canWrite: canWrite(repository.viewerPermission),
  };
  return { answeredBy: answeredBy(repository), data: detail };
}
