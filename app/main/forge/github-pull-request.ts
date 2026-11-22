import { z } from 'zod';
import type {
  Check,
  CheckOutcome,
  CheckState,
  PullRequestDetail,
  RepositoryReference,
  TimelineEntry,
} from '../../shared/forge/forge';
import { graphql } from './github-cli';
import {
  checksState,
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

const checkRunStatus = z.enum(['QUEUED', 'IN_PROGRESS', 'WAITING', 'PENDING', 'REQUESTED', 'COMPLETED']);
const checkConclusion = z.enum([
  'SUCCESS',
  'FAILURE',
  'CANCELLED',
  'TIMED_OUT',
  'ACTION_REQUIRED',
  'STARTUP_FAILURE',
  'NEUTRAL',
  'SKIPPED',
  'STALE',
]);
const checkRunState = z.union([checkRunStatus, checkConclusion]);
const checkContextSchema = z.discriminatedUnion('__typename', [
  z.object({
    __typename: z.literal('CheckRun'),
    name: z.string(),
    status: checkRunStatus,
    conclusion: checkConclusion.nullable(),
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
    state: checksState,
    description: z.string().nullable(),
    targetUrl: z.string().nullable(),
    isRequired: z.boolean(),
  }),
]);
const stateCountsSchema = <State extends z.ZodType>(state: State) =>
  z.array(z.object({ state, count: z.number() })).nullable();
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
                  state: checksState,
                  contexts: z.object({
                    totalCount: z.number(),
                    checkRunCountsByState: stateCountsSchema(checkRunState),
                    statusContextCountsByState: stateCountsSchema(checksState),
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
    reviews(last: ${timelineLimit}) { totalCount nodes { author { login } state submittedAt bodyHTML } }
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
  DRAFT: 'blocked',
  UNKNOWN: 'unknown',
} as const;
const checkStates = {
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
} as const satisfies Record<z.infer<typeof checkRunState> | z.infer<typeof checksState>, CheckState>;
const check = (context: z.infer<typeof checkContextSchema>): Check =>
  context.__typename === 'CheckRun'
    ? {
        ...checkStates[context.status === 'COMPLETED' && context.conclusion ? context.conclusion : context.status],
        workflow: context.checkSuite?.workflowRun?.workflow.name ?? null,
        name: context.name,
        description: context.title,
        required: context.isRequired,
        startedAt: context.startedAt,
        completedAt: context.completedAt,
        url: context.permalink,
      }
    : {
        ...checkStates[context.state],
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
  const counts = new Map<CheckOutcome, CheckState & { count: number }>();
  for (const { state, count } of [
    ...(rollup?.contexts.checkRunCountsByState ?? []),
    ...(rollup?.contexts.statusContextCountsByState ?? []),
  ]) {
    const known = checkStates[state];
    const counted = counts.get(known.outcome);
    if (count) counts.set(known.outcome, { ...known, count: (counted?.count ?? 0) + count });
  }
  return {
    state: rollup ? checkStates[rollup.state] : null,
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

const oldestFetched = (connection: { totalCount: number; nodes: unknown[] }, times: string[]) =>
  connection.totalCount > connection.nodes.length ? times.toSorted()[0] : undefined;

function latestTimeline({ comments, reviews }: FetchedPullRequest) {
  const submitted = reviews.nodes.flatMap(({ state, submittedAt, ...review }) =>
    state === 'PENDING' || submittedAt === null ? [] : [{ ...review, state, submittedAt }],
  );
  const fetched: { entry: TimelineEntry; shown: boolean }[] = [
    ...comments.nodes.map(comment => ({
      entry: {
        author: comment.author?.login ?? null,
        createdAt: comment.createdAt,
        html: comment.bodyHTML,
        verdict: null,
      },
      shown: true,
    })),
    ...submitted.map(review => ({
      entry: {
        author: review.author?.login ?? null,
        createdAt: review.submittedAt,
        html: review.bodyHTML,
        verdict: reviewVerdict[review.state],
      },
      shown: !!review.bodyHTML.trim(),
    })),
  ].sort((a, b) => a.entry.createdAt.localeCompare(b.entry.createdAt));
  const cutoff = [
    oldestFetched(
      comments,
      comments.nodes.map(comment => comment.createdAt),
    ),
    oldestFetched(
      reviews,
      submitted.map(review => review.submittedAt),
    ),
  ]
    .filter(time => time !== undefined)
    .toSorted()
    .at(-1);
  const timeline: TimelineEntry[] = [];
  let walked = reviews.nodes.length - submitted.length;
  for (const { entry, shown } of fetched.reverse()) {
    if (timeline.length === timelineLimit || (cutoff !== undefined && entry.createdAt < cutoff)) break;
    walked++;
    if (shown) timeline.unshift(entry);
  }
  return { timeline, earlierEntries: comments.totalCount + reviews.totalCount - walked };
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
