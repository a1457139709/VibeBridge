import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { TestContext } from 'node:test';
import { testDirectory } from './directory';

export interface GhIssue {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED';
  stateReason?: 'COMPLETED' | 'NOT_PLANNED' | 'DUPLICATE' | 'REOPENED';
  createdAt: string;
  labels: { name: string; color: string }[];
  author?: string | null;
  assignees?: string[];
  bodyHTML?: string;
  comments?: { author: string | null; createdAt: string; bodyHTML: string }[];
  parent?: number;
  blockedBy?: (number | { path: string; number: number; title: string; state: 'OPEN' | 'CLOSED' })[];
  closedBy?: number[];
}

export interface GhPullRequest {
  number: number;
  title: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft?: boolean;
  createdAt?: string;
  author?: string | null;
  labels?: { name: string; color: string }[];
  checks?: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED' | null;
  head?: string;
  base?: string;
  bodyHTML?: string;
  closes?: number[];
  comments?: { author: string | null; createdAt: string; bodyHTML: string }[];
  reviews?: {
    author: string | null;
    state: 'PENDING' | 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED';
    submittedAt: string | null;
    bodyHTML: string;
    codeComments?: number;
  }[];
  reviewDecision?: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  requiredApprovals?: number | null;
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  mergeQueue?: boolean;
  checkRuns?: (
    | { name: string; status: string; conclusion: string | null; required?: boolean }
    | {
        context: string;
        state: 'SUCCESS' | 'FAILURE' | 'ERROR' | 'PENDING' | 'EXPECTED';
        targetUrl: string | null;
        required?: boolean;
      }
  )[];
}

export interface GhState {
  account: string;
  repositories: (string | { id: number; path: string })[];
  redirects?: Record<string, string>;
  issues?: GhIssue[];
  pullRequests?: GhPullRequest[];
  labels?: { name: string; color: string }[];
  mergeMethods?: { merge?: boolean; squash?: boolean; rebase?: boolean };
  defaultMergeMethod?: 'MERGE' | 'SQUASH' | 'REBASE';
  permission?: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ';
  answerOnceAsked?: number;
  failure?: { code: number; stdout?: string; stderr?: string };
}

export async function ghDouble(context: TestContext, state: GhState) {
  const directory = await testDirectory(context, 'gh-double');
  const bin = join(directory, 'bin'),
    empty = join(directory, 'empty');
  await mkdir(bin);
  await mkdir(empty);
  const file = join(directory, 'state.json');
  const program = join(bin, 'gh');
  await writeFile(
    program,
    `#!/bin/sh\nexec '${process.env.VIBEBRIDGE_TEST_NODE}' '${resolve('tests/fixtures/gh-cli.cjs')}' "$@"\n`,
  );
  await chmod(program, 0o755);
  const path = process.env.PATH,
    stateFile = process.env.VIBEBRIDGE_GH_DOUBLE;
  context.after(() => {
    process.env.PATH = path;
    if (stateFile === undefined) delete process.env.VIBEBRIDGE_GH_DOUBLE;
    else process.env.VIBEBRIDGE_GH_DOUBLE = stateFile;
  });
  process.env.PATH = `${bin}:${path}`;
  process.env.VIBEBRIDGE_GH_DOUBLE = file;
  const set = (next: GhState) => writeFile(file, JSON.stringify(next));
  await set(state);
  const log = `${file}.calls`;
  return {
    set,
    async calls(): Promise<string[][]> {
      const lines = await readFile(log, 'utf8').catch(() => '');
      await writeFile(log, '');
      return lines
        .split('\n')
        .filter(Boolean)
        .map((line): string[] => JSON.parse(line));
    },
    uninstall() {
      process.env.PATH = empty;
    },
  };
}
