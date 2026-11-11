import { z } from 'zod';

/** Code Hosting Platforms the Workbench has an adapter for. */
export const platformIds = ['github'] as const;
export type PlatformId = typeof platformIds[number];
export const platformIdSchema = z.enum(platformIds);

/** A repository on a Code Hosting Platform. The path is the platform's own repository path,
 * which may have more than two segments (nested groups). */
export interface RepositoryReference { platform: PlatformId; path: string }
export const repositoryReferenceSchema = z.strictObject({ platform: platformIdSchema, path: z.string().min(1) });
/** Whether both name the same repository, or neither names one. Platforms match repository paths whatever their case. */
export const sameRepository = (a: RepositoryReference | null | undefined, b: RepositoryReference | null | undefined) =>
  !a || !b ? !a && !b : a.platform === b.platform && a.path.toLowerCase() === b.path.toLowerCase();

/** Features that differ between platforms. The UI shows a feature only when the platform declares it. */
export type PlatformCapability = 'subIssues' | 'nativeBlocking' | 'mergeMethods' | 'mergeQueue' | 'autoMerge' | 'requiredChecks';

/** What the UI needs to name a platform and help the user when its CLI cannot be used. */
export interface PlatformDescription {
  id: PlatformId;
  name: string;
  /** Where to get the platform's CLI. */
  installUrl: string;
  /** The command that signs the platform's CLI in. */
  signInCommand: string;
  /** The host of the platform's web pages and git remotes. */
  host: string;
  /** Where the web pages of a repository's issues and merge requests sit under its path, before their number. */
  itemPaths: Record<RepositoryItem['kind'], string>;
  capabilities: PlatformCapability[];
}

/** Each platform's description, shared by its adapter and the UI that names it. */
export const platformDescriptions: Record<PlatformId, PlatformDescription> = {
  github: { id: 'github', name: 'GitHub', installUrl: 'https://cli.github.com', signInCommand: 'gh auth login',
    host: 'github.com', itemPaths: { issue: 'issues', mergeRequest: 'pull' },
    capabilities: ['subIssues', 'nativeBlocking', 'mergeMethods', 'mergeQueue', 'autoMerge', 'requiredChecks'] },
};

/** Why a platform call failed: its CLI is not installed, not signed in, cannot reach the
 * repository (missing and forbidden look the same), or anything else, which may pass. */
export type PlatformFailureKind = 'notInstalled' | 'signedOut' | 'unreachable' | 'transient';
/** `output` is what the platform's CLI reported, unchanged. */
export interface PlatformFailure { kind: PlatformFailureKind; platform: PlatformDescription; output: string }

/** The repositories a project may bind. `suggested` is the listed repository the project
 * directory's `origin` points to; it is not bound until the user saves it. */
export type RepositoryChoices = { ok: true; platform: PlatformDescription; account: string; repositories: RepositoryReference[]; suggested: RepositoryReference | null }
  | { ok: false; failure: PlatformFailure };

/** What an issue or merge request list shows: a server-side search over titles or the number,
 * open or closed (a merged merge request is closed), and labels the items must all carry.
 * A fresh list is open with no search or labels. */
export interface ListFilter { search: string; state: 'open' | 'closed'; labels: string[] }
export const defaultListFilter: ListFilter = { search: '', state: 'open', labels: [] };
export const listFilterSchema = z.strictObject({ search: z.string(), state: z.enum(['open', 'closed']), labels: z.array(z.string()) });
/** How many items one list page holds. */
export const listPageSize = 25;

/** `color` is the platform's hex colour without `#`. */
export interface IssueLabel { name: string; color: string }
/** Why a closed issue was closed. */
export type IssueClosure = 'completed' | 'notPlanned' | 'duplicate';
export interface IssueSummary {
  number: number;
  title: string;
  state: 'open' | 'closed';
  /** Null while open, or when the platform does not say. */
  closedAs: IssueClosure | null;
  /** ISO 8601. */
  createdAt: string;
  labels: IssueLabel[];
  url: string;
  /** The issue this one is a sub-issue of. Null without one, or when the platform lacks `subIssues`. */
  parent: number | null;
  /** How far its sub-issues are; null when it has none, or when the platform lacks `subIssues`. The sub-issues
   * themselves are read on their own, at any depth. */
  subIssues: SubIssueProgress | null;
  /** Open issues natively marked as blocking it, as many as the list reads; empty when the platform lacks `nativeBlocking`.
   * Text in the body is never read as a blocker. */
  blockedBy: IssueReference[];
  /** How many more open issues block it than `blockedBy` names; the detail names them all. */
  moreBlockers: number;
}
export interface IssueReference { number: number; title: string }
/** How many sub-issues an issue has, open and closed, and how many of them are closed. */
export interface SubIssueProgress { completed: number; total: number }
/** Every sub-issue of an issue, open and closed, in the platform's order, or why they could not be read. A missing issue reads as unreachable. */
export type SubIssuesResult = { ok: true; issues: IssueSummary[] } | { ok: false; failure: PlatformFailure };
/** One page of a list, newest first. `next` is the platform's opaque cursor for the following
 * page, null on the last. `labels` are the repository's labels, offered as filters. */
export interface IssuePage { issues: IssueSummary[]; next: string | null; labels: IssueLabel[] }
/** Why a list page could not be read. An unreachable repository names the signed-in account when the platform tells it. */
export interface ListFailure { ok: false; failure: PlatformFailure; account?: string }
export type IssuePageResult = { ok: true; page: IssuePage } | ListFailure;

/** A draft is open; the UI tells it apart from other open merge requests. */
export type MergeRequestState = 'open' | 'merged' | 'closed';
/** The combined conclusion of the checks on a merge request's latest commit. */
export type CheckConclusion = 'passing' | 'failing' | 'pending';
export interface MergeRequestSummary {
  number: number;
  title: string;
  state: MergeRequestState;
  draft: boolean;
  /** The author's account, or null when the platform no longer knows it. */
  author: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Null when nothing reports checks on it. */
  checks: CheckConclusion | null;
  labels: IssueLabel[];
  url: string;
}
/** One page of merge requests, as an IssuePage is for issues. */
export interface MergeRequestPage { mergeRequests: MergeRequestSummary[]; next: string | null; labels: IssueLabel[] }
export type MergeRequestPageResult = { ok: true; page: MergeRequestPage } | ListFailure;

/** An issue another issue relates to; its repository may differ from the bound one. */
export interface RelatedIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  closedAs: IssueClosure | null;
  repository: RepositoryReference;
  url: string;
}
export interface MergeRequestReference {
  number: number;
  title: string;
  state: MergeRequestState;
  draft: boolean;
  /** Null when nothing reports checks on it. */
  checks: CheckConclusion | null;
  url: string;
}
/** `body` is HTML as the platform renders it, before the Workbench's allowlist filter. */
export interface IssueComment { author: string | null; createdAt: string; body: string }
/** What an issue's detail shows: every relation, open or closed. Relations a platform does not declare as capabilities stay empty. */
export interface IssueDetail extends Omit<IssueSummary, 'parent' | 'subIssues' | 'blockedBy' | 'moreBlockers'> {
  author: string | null;
  assignees: string[];
  /** HTML as the platform renders it, before the Workbench's allowlist filter. */
  body: string;
  commentCount: number;
  comments: IssueComment[];
  parent: RelatedIssue | null;
  subIssues: RelatedIssue[];
  blockedBy: RelatedIssue[];
  blocking: RelatedIssue[];
  /** Merge requests that close the issue when merged, closed ones included. */
  closingMergeRequests: MergeRequestReference[];
  /** Whether the signed-in account may write to the repository, and so take direct actions on it. */
  writable: boolean;
}
/** An issue's detail, or why it could not be read. A missing issue reads as unreachable. */
export type IssueDetailResult = { ok: true; issue: IssueDetail } | { ok: false; failure: PlatformFailure };

/** How a merge request's changes reach its base branch: a merge commit, one squashed commit, or its commits rebased. */
export type MergeMethod = 'merge' | 'squash' | 'rebase';
/** Whether the reviews a merge request has meet what its base branch asks for. */
export type ReviewDecision = 'approved' | 'changesRequested' | 'reviewRequired';
export type ReviewState = 'approved' | 'changesRequested' | 'commented' | 'dismissed';
/** A submitted review's summary. Its line comments are only counted; `url` opens them on the platform. */
export interface MergeRequestReview { author: string | null; state: ReviewState; submittedAt: string; body: string; codeComments: number; url: string }
/** One check on a merge request's latest commit. `url` opens its log on the platform, when it has one. */
export interface Check { name: string; conclusion: CheckConclusion; required: boolean; url: string | null }
/** What a merge must go through on the platform instead of merging directly. */
export type MergeRoute = 'mergeQueue' | 'autoMerge';
/** What decides whether a merge request can merge. Without the platform capability, `required` is
 * always false (`requiredChecks`), `methods` is empty (`mergeMethods`) and `mergeThrough` is never that route
 * (`mergeQueue`, `autoMerge`). */
export interface MergeState {
  /** Null when the base branch asks for no review. */
  review: ReviewDecision | null;
  checks: Check[];
  /** Whether it conflicts with its base branch; false while the platform has not worked it out. */
  conflicting: boolean;
  /** The merge methods the repository allows, in the platform's order. */
  methods: MergeMethod[];
  /** Null when it can merge directly. */
  mergeThrough: MergeRoute | null;
}
/** Something visible that keeps the platform from merging a merge request. */
export type MergeBlocker = 'draft' | 'conflicts' | 'reviewRequired' | 'changesRequested' | 'checksFailing' | 'checksPending';
/** What keeps the platform from merging it, in the merge area's order. Checks count when required, or all of them where the platform marks none. */
export function mergeBlockers(draft: boolean, { review, checks, conflicting }: Pick<MergeState, 'review' | 'checks' | 'conflicting'>,
  platform: PlatformDescription): MergeBlocker[] {
  const counted = platform.capabilities.includes('requiredChecks') ? checks.filter(check => check.required) : checks;
  return ([
    draft && 'draft',
    conflicting && 'conflicts',
    review === 'reviewRequired' && 'reviewRequired',
    review === 'changesRequested' && 'changesRequested',
    counted.some(check => check.conclusion === 'failing') ? 'checksFailing' : counted.some(check => check.conclusion === 'pending') && 'checksPending',
  ] as const).filter((blocker): blocker is MergeBlocker => blocker !== false);
}
/** What a merge request's detail shows. It has no diff, change counts or reviewer list. */
export interface MergeRequestDetail extends Omit<MergeRequestSummary, 'checks'> {
  /** Branch names; a head branch in another repository is prefixed with that repository's owner. */
  head: string;
  base: string;
  /** Where the platform shows its changes. */
  changesUrl: string;
  /** HTML as the platform renders it, before the Workbench's allowlist filter. */
  body: string;
  comments: IssueComment[];
  reviews: MergeRequestReview[];
  /** Issues it closes when merged. */
  closingIssues: RelatedIssue[];
  merge: MergeState;
  /** Whether the signed-in account may write to the repository, and so take direct actions on it. */
  writable: boolean;
}
/** A merge request's detail, or why it could not be read. A missing merge request reads as unreachable. */
export type MergeRequestDetailResult = { ok: true; mergeRequest: MergeRequestDetail } | { ok: false; failure: PlatformFailure };

/** A one-click change to an issue or merge request of the bound repository. A merge takes the platform's own commit message. */
export type DirectAction = { kind: 'closeIssue'; number: number; reason: 'completed' | 'notPlanned' } | { kind: 'reopenIssue'; number: number }
  | { kind: 'mergeMergeRequest'; number: number; method: MergeMethod } | { kind: 'closeMergeRequest'; number: number } | { kind: 'reopenMergeRequest'; number: number };
const actionNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const directActionSchema: z.ZodType<DirectAction> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('closeIssue'), number: actionNumber, reason: z.enum(['completed', 'notPlanned']) }),
  z.strictObject({ kind: z.literal('mergeMergeRequest'), number: actionNumber, method: z.enum(['merge', 'squash', 'rebase']) }),
  ...(['reopenIssue', 'closeMergeRequest', 'reopenMergeRequest'] as const).map(kind => z.strictObject({ kind: z.literal(kind), number: actionNumber })),
]);
/** Whether the platform took the change; a refusal carries the platform's own words. Success shows only through a fresh read. */
export type DirectActionResult = { ok: true } | { ok: false; failure: PlatformFailure };

/** An issue or merge request of a repository, as a link names it. */
export interface RepositoryItem { kind: 'issue' | 'mergeRequest'; number: number }
/** The platform's web page of the repository's issue or merge request. */
export function itemUrl(repository: RepositoryReference, item: RepositoryItem): string {
  const { host, itemPaths } = platformDescriptions[repository.platform];
  return `https://${host}/${repository.path}/${itemPaths[item.kind]}/${item.number}`;
}
/** The repository's issue or merge request a link points to, or null for any other link. */
export function repositoryItem(repository: RepositoryReference, href: string): RepositoryItem | null {
  const { host, itemPaths } = platformDescriptions[repository.platform];
  const url = URL.parse(href);
  if (!url || !/^https?:$/.test(url.protocol) || url.hostname.toLowerCase() !== host) return null;
  const prefix = `/${repository.path.toLowerCase()}/`;
  const path = url.pathname.replace(/\/$/, '');
  if (!path.toLowerCase().startsWith(prefix)) return null;
  const rest = path.slice(prefix.length);
  const number = rest.slice(rest.lastIndexOf('/') + 1);
  const kind = (['issue', 'mergeRequest'] as const).find(kind => rest === `${itemPaths[kind]}/${number}`);
  return kind && /^\d+$/.test(number) ? { kind, number: Number(number) } : null;
}
