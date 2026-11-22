import { z } from 'zod';

export const forgeIds = ['github'] as const;
export type ForgeId = (typeof forgeIds)[number];
export const forgeIdSchema = z.enum(forgeIds);

export interface RepositoryReference {
  forge: ForgeId;
  host: string;
  id: string;
  path: string;
}
export const repositoryReferenceSchema = z.object({
  forge: forgeIdSchema,
  host: z.string().min(1),
  id: z.string().min(1),
  path: z.string().min(1),
});
export const sameRepository = (a: RepositoryReference | null, b: RepositoryReference | null) =>
  a === b || (!!a && !!b && a.forge === b.forge && a.host === b.host && a.id === b.id);

export const originElsewhereThanBinding = (
  bound: RepositoryReference | null,
  choices: RepositoryChoices | undefined,
) => (bound && choices?.ok && choices.origin && !sameRepository(choices.origin, bound) ? choices.origin : null);

export interface ForgeCapabilities {
  subIssues: boolean;
  blocking: boolean;
  requiredChecks: boolean;
  mergeQueue: boolean;
  mergeMethods: readonly MergeMethod[];
}

export const mergeMethods = ['merge', 'squash', 'rebase'] as const;
export type MergeMethod = (typeof mergeMethods)[number];

export interface ForgePresentation {
  name: string;
  cli: string;
  installUrl: string;
  loginCommand: string;
}

export type ForgeFailureKind = 'notInstalled' | 'loggedOut' | 'inaccessible' | 'transient';
export interface ForgeFailure {
  kind: ForgeFailureKind;
  detail: string;
  forge: ForgePresentation;
}

export type RepositoryChoices =
  | {
      ok: true;
      forge: ForgePresentation;
      account: string;
      repositories: RepositoryReference[];
      origin: RepositoryReference | null;
    }
  | { ok: false; failure: ForgeFailure };

export interface ForgeLabel {
  name: string;
  color: string;
}

export const listStates = ['open', 'closed'] as const;
export type ListState = (typeof listStates)[number];
export type ListCounts = Record<ListState, number>;
export type IssueState = 'open' | 'closed';

export interface IssueSummary {
  number: number;
  title: string;
  state: IssueState;
  closedAs: 'completed' | 'notPlanned' | 'duplicate' | null;
  createdAt: string;
  labels: ForgeLabel[];
  blockedBy: BlockerReference[];
  unlistedBlockers: number;
}

export interface BlockerReference {
  path: string | null;
  number: number;
  title: string;
}

export interface ListedIssue extends IssueSummary {
  url: string;
  parent: number | null;
  subIssues: { closed: number; total: number; issues: IssueSummary[]; unlisted: number };
}

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';
export type ChecksConclusion = 'passed' | 'failed' | 'pending' | 'none';
export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  createdAt: string;
  author: string | null;
  checks: ChecksConclusion;
  labels: ForgeLabel[];
}

export const listQuerySchema = z.object({
  filter: z.object({ search: z.string(), state: z.enum(listStates), labels: z.array(z.string()) }),
  cursor: z.string().nullable(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListFilter = ListQuery['filter'];

export interface ListPage<Item> {
  items: Item[];
  nextCursor: string | null;
  labels: ForgeLabel[];
  counts: ListCounts;
}
export type Page<Item> = ({ ok: true } & ListPage<Item>) | { ok: false; failure: ForgeFailure; account: string | null };
export type IssuePage = Page<ListedIssue>;
export type PullRequestPage = Page<PullRequestSummary>;
export type ItemsByNumber<Item> = { ok: true; items: Item[] } | Extract<Page<Item>, { ok: false }>;
export type IssuesByNumber = ItemsByNumber<ListedIssue>;
export type PullRequestsByNumber = ItemsByNumber<PullRequestSummary>;

export interface IssueReference {
  number: number;
  title: string;
  state: IssueState;
  closedAs: IssueSummary['closedAs'];
  url: string;
}
export interface PullRequestReference {
  number: number;
  title: string;
  state: PullRequestState;
  checks: ChecksConclusion;
  url: string;
}
export interface SubIssueProgress {
  closed: number;
  total: number;
}
export interface ForgeLinks {
  issuePrefix: string;
  pullRequestPrefix: string;
}
export interface ForgeComment {
  author: string | null;
  createdAt: string;
  html: string;
}

export interface IssueDetail extends Omit<IssueSummary, 'blockedBy' | 'unlistedBlockers'> {
  url: string;
  author: string | null;
  assignees: string[];
  body: string;
  comments: ForgeComment[];
  commentCount: number;
  parent: (IssueReference & { progress: SubIssueProgress }) | null;
  subIssues: IssueReference[];
  subIssueProgress: SubIssueProgress;
  blockedBy: IssueReference[];
  blocking: IssueReference[];
  closingPullRequests: PullRequestReference[];
  links: ForgeLinks;
  canWrite: boolean;
}
export const itemNumberSchema = z.number().int().positive();
export const itemsPerRead = 100;
export const itemNumbersSchema = z.array(itemNumberSchema).max(itemsPerRead);
export type IssueDetailResult = { ok: true; issue: IssueDetail } | { ok: false; failure: ForgeFailure };

export type ReviewVerdict = 'approved' | 'changesRequested' | 'commented' | 'dismissed';
export interface TimelineEntry extends ForgeComment {
  verdict: ReviewVerdict | null;
}

export type ReviewDecision = 'approved' | 'changesRequested' | 'reviewRequired';
export type MergeState = 'clean' | 'hasHooks' | 'unstable' | 'dirty' | 'behind' | 'blocked' | 'unknown';
export type CheckOutcome =
  | 'queued'
  | 'inProgress'
  | 'waiting'
  | 'pending'
  | 'requested'
  | 'expected'
  | 'completed'
  | 'success'
  | 'failure'
  | 'error'
  | 'cancelled'
  | 'timedOut'
  | 'actionRequired'
  | 'startupFailure'
  | 'neutral'
  | 'skipped'
  | 'stale';
export type CheckTone = 'passed' | 'failed' | 'pending' | 'neutral';
export type CheckState =
  { outcome: CheckOutcome; tone: CheckTone } | { outcome: 'unrecognized'; raw: string; tone: 'neutral' };
export type Check = CheckState & {
  workflow: string | null;
  name: string;
  description: string | null;
  required: boolean;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
};
export interface PullRequestChecks {
  state: CheckState | null;
  counts: (CheckState & { count: number })[];
  total: number;
  url: string;
  listed: Check[];
}

export interface PullRequestDetail extends Omit<PullRequestSummary, 'checks'> {
  url: string;
  changesUrl: string;
  head: string;
  base: string;
  body: string;
  timeline: TimelineEntry[];
  earlierEntries: number;
  closingIssues: IssueReference[];
  links: ForgeLinks;
  reviewDecision: ReviewDecision | null;
  checks: PullRequestChecks;
  mergeState: MergeState | null;
  mergeOptions: { methods: MergeMethod[]; queue: boolean };
  canWrite: boolean;
}
export type PullRequestDetailResult =
  { ok: true; pullRequest: PullRequestDetail } | { ok: false; failure: ForgeFailure };

export const directActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('closeIssue'), number: itemNumberSchema, reason: z.enum(['completed', 'notPlanned']) }),
  z.object({ kind: z.literal('reopenIssue'), number: itemNumberSchema }),
  z.object({ kind: z.literal('merge'), number: itemNumberSchema, method: z.enum(mergeMethods) }),
  z.object({ kind: z.literal('closePullRequest'), number: itemNumberSchema }),
  z.object({ kind: z.literal('reopenPullRequest'), number: itemNumberSchema }),
]);
export type DirectAction = z.infer<typeof directActionSchema>;
export type DirectActionResult = { ok: true; detail: string } | { ok: false; failure: ForgeFailure };
