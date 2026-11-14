import { z } from 'zod';

/** The Forges the Workbench has an adapter for, in a closed table (app/main/forge/forges.ts). */
export const forgeIds = ['github'] as const;
export type ForgeId = typeof forgeIds[number];
export const forgeIdSchema = z.enum(forgeIds);

/** A repository on a Forge. The path is the forge's own repository path and may have more
 * than two segments (nested groups), so it is never split into owner and name outside the adapter. */
export interface RepositoryReference { forge: ForgeId; path: string }
export const sameRepository = (a: RepositoryReference | null, b: RepositoryReference | null) =>
  a === b || (!!a && !!b && a.forge === b.forge && a.path === b.path);

/** Features that differ between forges. The UI shows a feature only when the bound forge declares it. */
export interface ForgeCapabilities {
  /** Issues nest under a parent issue, and a parent reports its sub-issues' progress. */
  subIssues: boolean;
  /** The forge records natively which issues block an issue. */
  blocking: boolean;
  /** The repository can require checks to pass before a merge, and says which. */
  requiredChecks: boolean;
  /** The repository can require merging through a merge queue. */
  mergeQueue: boolean;
  /** The ways the forge can merge a pull request; a repository allows some of them. */
  mergeMethods: readonly MergeMethod[];
}

/** How a pull request's changes join its base branch: a merge commit, one squashed commit, or rebased commits. */
export type MergeMethod = 'merge' | 'squash' | 'rebase';

/** What the UI shows for a forge; each adapter provides its own. */
export interface ForgePresentation {
  /** Display name, e.g. GitHub. */
  name: string;
  /** The forge CLI whose active account is the Workbench's identity, e.g. gh. */
  cli: string;
  installUrl: string;
  loginCommand: string;
}

/** Every forge failure falls into one of these kinds. `detail` is the forge's own text, unchanged. */
export type ForgeFailureKind = 'notInstalled' | 'loggedOut' | 'inaccessible' | 'transient';
export interface ForgeFailure { kind: ForgeFailureKind; detail: string; forge: ForgePresentation }

/** The repositories a project can bind: those of the forge CLI's active account, and the one the project
 * directory's `origin` points at when it is among them. Offering it does not bind it. */
export type RepositoryChoices =
  | { ok: true; forge: ForgePresentation; account: string; repositories: RepositoryReference[]; origin: RepositoryReference | null }
  | { ok: false; failure: ForgeFailure };

/** A label as the forge shows it; `color` is a hex colour without `#`. */
export interface ForgeLabel { name: string; color: string }

/** Every list filters on open or closed; for pull requests, closed includes merged ones. */
export const listStates = ['open', 'closed'] as const;
export type ListState = typeof listStates[number];
/** How many items are open and closed. */
export type ListCounts = Record<ListState, number>;
/** An issue is open or closed. */
export type IssueState = 'open' | 'closed';

/** An issue as a list row shows it. A closed issue says how it was closed when the forge tells. */
export interface IssueSummary {
  number: number;
  title: string;
  state: IssueState;
  closedAs: 'completed' | 'notPlanned' | 'duplicate' | null;
  /** ISO 8601. */
  createdAt: string;
  labels: ForgeLabel[];
  /** The open issues blocking it, from the forge's native dependencies only; empty when the forge has no blocking. */
  blockedBy: BlockerReference[];
  /** How many more open issues block it than `blockedBy` lists, when the forge lists only some of its blockers. */
  unlistedBlockers: number;
}

/** An issue blocking a listed one. `path` names its repository when it is not the listed one, else it is null. */
export interface BlockerReference { path: string | null; number: number; title: string }

/** An issue as the list holds it, with its place in the issue tree. Empty of tree data when the forge has no sub-issues. */
export interface ListedIssue extends IssueSummary {
  /** The parent issue's number when the parent is in the same repository, else null. */
  parent: number | null;
  /** How many sub-issues it has and how many of them are closed, and those in the same repository. */
  subIssues: { closed: number; total: number; issues: IssueSummary[] };
}

/** A pull request's state. A draft is open; merged and closed are both closed. */
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';
/** The combined conclusion of a pull request's checks on its latest commit: `none` when it has none. */
export type ChecksConclusion = 'passed' | 'failed' | 'pending' | 'none';
/** A pull request as a list row shows it. */
export interface PullRequestSummary {
  number: number;
  title: string;
  state: PullRequestState;
  /** ISO 8601. */
  createdAt: string;
  /** The author's account name, or null when the account no longer exists. */
  author: string | null;
  checks: ChecksConclusion;
  labels: ForgeLabel[];
}

/** What a list asks for. The forge filters on its side: the search matches a title or a number, and every label must be present. */
export const listQuerySchema = z.object({
  filter: z.object({ search: z.string(), state: z.enum(listStates), labels: z.array(z.string()) }),
  /** Opaque, from the previous page; null asks for the first page. */
  cursor: z.string().nullable(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListFilter = ListQuery['filter'];

/** One page of a repository's issues or pull requests, newest created first, with the next page's cursor (null on the
 * last page), the labels the repository defines, and how many open and closed items the filter's search and labels match. */
export interface ListPage<Item> { items: Item[]; cursor: string | null; labels: ForgeLabel[]; counts: ListCounts }
/** A page of a list of the bound repository, or the forge failure. A failure that the repository is inaccessible
 * names the active account when the forge can still tell it. */
export type Page<Item> = ({ ok: true } & ListPage<Item>) | { ok: false; failure: ForgeFailure; account: string | null };
export type IssuePage = Page<ListedIssue>;
export type PullRequestPage = Page<PullRequestSummary>;

/** Another issue as a detail names it. `url` is its page on the forge: one outside the bound repository opens in the browser. */
export interface IssueReference { number: number; title: string; state: IssueState; closedAs: IssueSummary['closedAs']; url: string }
export interface PullRequestReference { number: number; title: string; state: PullRequestState; checks: ChecksConclusion; url: string }
/** How many of an issue's sub-issues are closed. */
export interface SubIssueProgress { closed: number; total: number }
/** URL prefixes of the bound repository's issues and pull requests: a link to `<prefix><number>` opens in the sidebar. */
export interface ForgeLinks { issues: string; pullRequests: string }
/** A comment as the forge rendered it. `html` is the forge's own HTML, unfiltered: filter it before it joins a page. */
export interface ForgeComment { author: string | null; createdAt: string; html: string }

/** An issue as its read-only detail shows it. `body` and the comments are the forge's rendered HTML, unfiltered.
 * `commentCount` counts every comment, also those beyond the ones listed. Relations the forge does not declare
 * (ForgeCapabilities) are empty. Sub-issues are in number order. */
export interface IssueDetail extends Omit<IssueSummary, 'blockedBy' | 'unlistedBlockers'> {
  url: string;
  author: string | null;
  assignees: string[];
  body: string;
  comments: ForgeComment[];
  commentCount: number;
  /** The parent, with how many of its sub-issues are closed. */
  parent: (IssueReference & { progress: SubIssueProgress }) | null;
  subIssues: IssueReference[];
  blockedBy: IssueReference[];
  blocking: IssueReference[];
  /** Pull requests that close this issue when merged, closed ones included. */
  closingPullRequests: PullRequestReference[];
  links: ForgeLinks;
}
/** The number of an issue or pull request. */
export const itemNumberSchema = z.number().int().positive();
/** An issue of the bound repository, or the forge failure. */
export type IssueDetailResult = { ok: true; issue: IssueDetail } | { ok: false; failure: ForgeFailure };

/** How a review left a pull request. */
export type ReviewVerdict = 'approved' | 'changesRequested' | 'commented' | 'dismissed';
/** A comment, or a review's summary with its verdict. */
export interface TimelineEntry extends ForgeComment { verdict: ReviewVerdict | null }

/** Where a pull request's review stands: approved, changes requested, or still waiting for a required review; or no
 * review is required. `requiredApprovals` is how many approvals the base branch requires; null when the forge does not tell or none are required. */
export interface ReviewStatus { state: 'approved' | 'changesRequested' | 'required' | 'notRequired'; requiredApprovals: number | null }
/** A check on the latest commit. A skipped check does not hold up a merge. `url` opens its log on the forge, or where it ran. */
export interface Check { name: string; result: 'passed' | 'failed' | 'pending' | 'skipped'; required: boolean; url: string | null }
/** Whether the pull request conflicts with its base branch; `unknown` while the forge has not worked it out yet. */
export type Conflicts = 'none' | 'conflicting' | 'unknown';

/** A pull request as its read-only detail shows it. `body` is the forge's rendered HTML, unfiltered. `changesUrl` is where the
 * forge shows its changes. */
export interface PullRequestDetail extends Omit<PullRequestSummary, 'checks'> {
  url: string;
  changesUrl: string;
  /** The branch it merges, and the branch it merges into. */
  head: string;
  base: string;
  body: string;
  /** Comments and review summaries, oldest first. Code comments are only counted. */
  timeline: TimelineEntry[];
  /** Every comment, also those beyond the ones listed. */
  commentCount: number;
  codeComments: number;
  /** Issues the forge closes when it is merged. */
  closingIssues: IssueReference[];
  links: ForgeLinks;
  review: ReviewStatus;
  /** Checks on the latest commit; `required` only when the forge declares required checks (ForgeCapabilities). */
  checks: Check[];
  conflicts: Conflicts;
  /** The merge methods the repository allows, and whether it merges through a merge queue; the UI uses them as far as the forge declares them (ForgeCapabilities). */
  merge: { methods: MergeMethod[]; queue: boolean };
}
/** A pull request of the bound repository, or the forge failure. */
export type PullRequestDetailResult = { ok: true; pullRequest: PullRequestDetail } | { ok: false; failure: ForgeFailure };
