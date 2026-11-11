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

/** What an issue list shows: a server-side search over titles or the issue number, open or
 * closed, and labels the issues must all carry. A fresh list is open with no search or labels. */
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
/** A list page, or why it could not be read. An unreachable repository names the signed-in account when the platform tells it. */
export type IssuePageResult = { ok: true; page: IssuePage } | { ok: false; failure: PlatformFailure; account?: string };
