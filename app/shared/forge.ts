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
}

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

/** An issue as a list row shows it. A closed issue says how it was closed when the forge tells. */
export const issueStates = ['open', 'closed'] as const;
export type IssueState = typeof issueStates[number];
/** How many issues are open and closed. */
export type IssueCounts = Record<IssueState, number>;

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

/** What a list asks for. The forge filters on its side: the search matches a title or a number, and every label must be present. */
export const issueListQuerySchema = z.object({
  filter: z.object({ search: z.string(), state: z.enum(issueStates), labels: z.array(z.string()) }),
  /** Opaque, from the previous page; null asks for the first page. */
  cursor: z.string().nullable(),
});
export type IssueListQuery = z.infer<typeof issueListQuerySchema>;
export type IssueListFilter = IssueListQuery['filter'];

/** One page of a repository's issues, newest created first, with the next page's cursor (null on the last page),
 * the labels the repository defines, and how many open and closed issues the filter's search and labels match. */
export interface IssueListPage { issues: ListedIssue[]; cursor: string | null; labels: ForgeLabel[]; counts: IssueCounts }
/** A page of the bound repository's issues, or the forge failure. A failure that the repository is inaccessible
 * names the active account when the forge can still tell it. */
export type IssuePage = ({ ok: true } & IssueListPage) | { ok: false; failure: ForgeFailure; account: string | null };

/** Another issue as a detail names it. `url` is its page on the forge: one outside the bound repository opens in the browser. */
export interface IssueReference { number: number; title: string; state: IssueState; closedAs: IssueSummary['closedAs']; url: string }
export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';
/** The combined conclusion of a pull request's checks: `none` when it has none. */
export type ChecksConclusion = 'passed' | 'failed' | 'pending' | 'none';
export interface PullRequestReference { number: number; title: string; state: PullRequestState; checks: ChecksConclusion; url: string }
/** How many of an issue's sub-issues are closed. */
export interface SubIssueProgress { closed: number; total: number }
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
  /** The URL prefix of the bound repository's issues: a link to `<prefix><number>` opens in the sidebar. */
  issueLinks: string;
}
export const issueNumberSchema = z.number().int().positive();
/** An issue of the bound repository, or the forge failure. */
export type IssueDetailResult = { ok: true; issue: IssueDetail } | { ok: false; failure: ForgeFailure };
