import { z } from 'zod';

/** Code Hosting Platforms the Workbench has an adapter for. */
export const platformIds = ['github'] as const;
export type PlatformId = typeof platformIds[number];
export const platformIdSchema = z.enum(platformIds);

/** A repository on a Code Hosting Platform. The path is the platform's own repository path,
 * which may have more than two segments (nested groups). */
export interface RepositoryReference { platform: PlatformId; path: string }
export const repositoryReferenceSchema = z.strictObject({ platform: platformIdSchema, path: z.string().min(1) });
export const sameRepository = (a: RepositoryReference | null | undefined, b: RepositoryReference | null | undefined) =>
  a?.platform === b?.platform && a?.path === b?.path;

/** Features that differ between platforms. The UI shows a feature only when the platform declares it. */
export type PlatformCapability = 'subIssues' | 'nativeBlocking' | 'mergeMethods' | 'mergeQueue' | 'requiredChecks';

/** What the UI needs to name a platform and help the user when its CLI cannot be used. */
export interface PlatformDescription {
  id: PlatformId;
  name: string;
  /** Where to get the platform's CLI. */
  installUrl: string;
  /** The command that signs the platform's CLI in. */
  signInCommand: string;
  capabilities: PlatformCapability[];
}

/** Each platform's description, shared by its adapter and the UI that names it. */
export const platformDescriptions: Record<PlatformId, PlatformDescription> = {
  github: { id: 'github', name: 'GitHub', installUrl: 'https://cli.github.com', signInCommand: 'gh auth login',
    capabilities: ['subIssues', 'nativeBlocking', 'mergeMethods', 'mergeQueue', 'requiredChecks'] },
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
export interface IssueFilter { search: string; state: 'open' | 'closed'; labels: string[] }
export const defaultIssueFilter: IssueFilter = { search: '', state: 'open', labels: [] };
export const issueFilterSchema = z.strictObject({ search: z.string(), state: z.enum(['open', 'closed']), labels: z.array(z.string()) });
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
  /** Null when it has none, when it is itself read as a sub-issue (the list reads one level),
   * or when the platform lacks `subIssues`. */
  subIssues: SubIssues | null;
  /** The open issues natively marked as blocking it; empty when the platform lacks `nativeBlocking`.
   * Text in the body is never read as a blocker. */
  blockedBy: IssueReference[];
}
export interface IssueReference { number: number; title: string }
/** An issue's sub-issues, open and closed, in the platform's order, with how many are closed. */
export interface SubIssues { completed: number; total: number; issues: IssueSummary[] }
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

/** An issue another issue relates to; `repository` is its repository's path, which may differ from the bound one. */
export interface RelatedIssue {
  number: number;
  title: string;
  state: 'open' | 'closed';
  closedAs: IssueClosure | null;
  repository: string;
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
export interface IssueDetail extends Omit<IssueSummary, 'parent' | 'subIssues' | 'blockedBy'> {
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
/** What decides whether a merge request can merge. Without the platform capability, `required` is
 * always false (`requiredChecks`), `methods` is empty (`mergeMethods`) and `queue` false (`mergeQueue`). */
export interface MergeState {
  /** Null when the base branch asks for no review. */
  review: ReviewDecision | null;
  checks: Check[];
  /** Whether it conflicts with its base branch; false while the platform has not worked it out. */
  conflicting: boolean;
  /** The merge methods the repository allows, in the platform's order. */
  methods: MergeMethod[];
  /** Whether its base branch merges only through a merge queue. */
  queue: boolean;
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
}
/** A merge request's detail, or why it could not be read. A missing merge request reads as unreachable. */
export type MergeRequestDetailResult = { ok: true; mergeRequest: MergeRequestDetail } | { ok: false; failure: PlatformFailure };

/** An issue or merge request of a repository, as a link names it. */
export interface RepositoryItem { kind: 'issue' | 'mergeRequest'; number: number }
const itemLinks: Record<PlatformId, (path: string, url: URL) => RepositoryItem | null> = {
  github(path, url) {
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    const match = /^\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)\/?$/.exec(url.pathname);
    if (!match || match[1].toLowerCase() !== path.toLowerCase()) return null;
    return { kind: match[2] === 'issues' ? 'issue' : 'mergeRequest', number: Number(match[3]) };
  },
};
/** The repository's issue or merge request a link points to, or null for any other link. */
export function repositoryItem(repository: RepositoryReference, href: string): RepositoryItem | null {
  const url = URL.parse(href);
  return url && /^https?:$/.test(url.protocol) ? itemLinks[repository.platform](repository.path, url) : null;
}
