import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { writeGhDoubleScripts } from './gh-double-scripts.cjs';

/** An issue of every repository the double lists, as GitHub's API names its fields. */
export interface GhIssue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  stateReason: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | null;
  createdAt: string;
  labels: string[];
  /** The number of the issue this one is a sub-issue of. */
  parent?: number;
  /** Numbers of the issues natively marked as blocking this one. */
  blockedBy?: number[];
  author?: string;
  assignees?: string[];
  /** The body as GitHub renders it; the double passes it through unchanged. */
  bodyHTML?: string;
  comments?: { author: string; createdAt: string; bodyHTML: string }[];
  /** Pull requests, by number, that close the issue when merged. */
  closedBy?: number[];
}

/** A pull request of every repository the double lists, as GitHub's API names its fields.
 * `checks` is the head commit's check rollup state, null when nothing reports on it. */
export interface GhPullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  /** Null for a deleted account. */
  author: string | null;
  createdAt: string;
  labels: string[];
  checks: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null;
  /** The owner of the head branch's repository when it is not the base repository's. */
  headOwner?: string;
  headRefName?: string;
  baseRefName?: string;
  bodyHTML?: string;
  comments?: { author: string; createdAt: string; bodyHTML: string }[];
  /** Reviews in submission order; a PENDING one is the viewer's unsubmitted review. */
  reviews?: { author: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING'; submittedAt: string | null; bodyHTML: string; codeComments: number }[];
  /** Issues, by number, the pull request closes when merged. */
  closes?: number[];
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  /** Whether its base branch merges through a merge queue. */
  mergeQueue?: boolean;
  /** GitHub's merge state status; CLEAN when not given. */
  mergeStateStatus?: 'BEHIND' | 'BLOCKED' | 'CLEAN' | 'DIRTY' | 'DRAFT' | 'HAS_HOOKS' | 'UNKNOWN' | 'UNSTABLE';
  /** Whether the viewer can enable auto-merge on it. */
  viewerCanEnableAutoMerge?: boolean;
  /** The head commit's check runs and commit statuses, in GitHub's order. */
  checkContexts?: GhCheckContext[];
}

export type GhCheckContext =
  | { kind: 'run'; name: string; status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED'; conclusion: string | null; required: boolean; url: string | null }
  | { kind: 'status'; name: string; state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED'; required: boolean; url: string | null };

export interface GhState {
  login?: string;
  /** Repositories the account may bind; any other repository is not found. */
  repositories?: string[];
  pageSize?: number;
  issues?: GhIssue[];
  /** Numbers are shared with issues, as on GitHub, so keep them apart. */
  pullRequests?: GhPullRequest[];
  /** At most this many sub-issues per page, whatever the query asks for. */
  subIssuePageSize?: number;
  /** At most this many comments per page, whatever the query asks for. */
  commentPageSize?: number;
  labels?: { name: string; color: string }[];
  /** The merge methods the repository allows; all of them when unset. */
  mergeMethods?: { merge: boolean; squash: boolean; rebase: boolean };
  failure?: { exit: number; stdout?: string; stderr?: string };
  /** The signed-in account's permission on every repository; WRITE when unset. */
  permission?: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
  /** Makes every mutation end as `failure` does, while reads still answer. */
  actionFailure?: { exit: number; stdout?: string; stderr?: string };
  /** Merges the double performed, with the method and the commit message the call gave, null where it left them to GitHub. */
  merges?: { number: number; method: string; headline: string | null; body: string | null }[];
}

/**
 * Puts a `gh` CLI double (tests/fixtures/gh-cli.cjs) first on PATH for this test process.
 * The Workbench finds commands through the user's login shell, so SHELL is replaced by a
 * double that reports this process's environment; PATH then holds only the double's
 * directory and the system directories, keeping any real `gh` out of reach.
 */
export async function ghDouble(context: TestContext, state: GhState) {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(resolve('work', 'gh-double-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const stateFile = join(directory, 'state.json');
  const { gh, shell } = await writeGhDoubleScripts(bin, stateFile);
  const saved = { PATH: process.env.PATH, SHELL: process.env.SHELL };
  process.env.PATH = `${bin}:/usr/bin:/bin`;
  process.env.SHELL = shell;
  context.after(async () => {
    process.env.PATH = saved.PATH; process.env.SHELL = saved.SHELL;
    await rm(directory, { recursive: true, force: true });
  });
  const write = (next: GhState) => writeFile(stateFile, JSON.stringify(next));
  await write(state);
  return {
    /** Replaces what the double answers from the next call on. */
    set: write,
    /** What the double holds now, mutations included. */
    state: async (): Promise<GhState> => JSON.parse(await readFile(stateFile, 'utf8')),
    /** Takes `gh` off PATH, as when it is not installed. */
    uninstall: () => rm(gh),
  };
}
