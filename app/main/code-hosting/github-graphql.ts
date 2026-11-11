import { execFile } from 'node:child_process';
import { executable } from '../../terminal/environment';
import { platformDescriptions, type CheckConclusion, type IssueClosure, type IssueComment, type IssueLabel, type PlatformFailureKind, type RelatedIssue } from '../../shared/code-hosting';
import { PlatformError, type CommandEnvironment } from './platform';

// How the GitHub adapter talks to GitHub, and the GraphQL fields and shapes its reads share.

export const description = platformDescriptions.github;

// `gh` exits with 4 when it has no usable sign-in; the API answers 401 for a revoked token.
// A missing repository and a forbidden one both read as NOT_FOUND or 404.
function classify(code: unknown, output: string): PlatformFailureKind {
  if (code === 4 || /\bHTTP 401\b/.test(output)) return 'signedOut';
  if (/\bNOT_FOUND\b|\bHTTP 404\b/.test(output)) return 'unreachable';
  return 'transient';
}

/** Runs `gh` from the environment's PATH. `gh` keeps the credentials; the Workbench never reads them. */
async function gh(environment: CommandEnvironment, args: string[]): Promise<string> {
  let command: string;
  try { command = await executable('gh', environment); }
  catch { throw new PlatformError('notInstalled', description, ''); }
  return new Promise((resolve, reject) => {
    execFile(command, args, { env: environment, maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (error, stdout, stderr) => {
      if (!error) return resolve(stdout);
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return reject(new PlatformError('notInstalled', description, ''));
      const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n') || error.message;
      reject(new PlatformError(classify(error.code, `${stderr}\n${stdout}`), description, output));
    });
  });
}

// Strings pass verbatim (`-f`); numbers pass typed (`-F`).
export async function graphql<T>(environment: CommandEnvironment, query: string, variables: Record<string, string | number> = {}): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])];
  const output = await gh(environment, args);
  try { return JSON.parse(output).data as T; }
  catch { throw new PlatformError('transient', description, output); }
}

/** A repository path's owner and name, as GitHub's queries take them. */
export const ownerAndName = (path: string) => ({ owner: path.slice(0, path.indexOf('/')), name: path.slice(path.indexOf('/') + 1) });

export const labelFields = `labels(first: 20) { nodes { name color } }`;
export const listLabels = (labels: { nodes: IssueLabel[] }) => labels.nodes.map(({ name, color }) => ({ name, color }));

const closures: Record<string, IssueClosure> = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate' };
export const closure = (state: 'OPEN' | 'CLOSED', reason: string | null) => state === 'CLOSED' ? closures[reason ?? ''] ?? null : null;

// The head commit's check rollup; EXPECTED is a required check that has not reported yet.
export const conclusions: Record<string, CheckConclusion> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' };
export const pullRequestStates = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const;

export const relatedIssueFields = `number title state stateReason url repository { nameWithOwner }`;
export interface RelatedIssueNode { number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; url: string; repository: { nameWithOwner: string } }
export const relatedIssue = (node: RelatedIssueNode): RelatedIssue => ({ number: node.number, title: node.title, state: node.state === 'OPEN' ? 'open' : 'closed',
  closedAs: closure(node.state, node.stateReason), repository: node.repository.nameWithOwner, url: node.url });

export const commentFields = `author { login } createdAt bodyHTML`;
export interface CommentNode { author: { login: string } | null; createdAt: string; bodyHTML: string }
export const issueComment = (node: CommentNode): IssueComment => ({ author: node.author?.login ?? null, createdAt: node.createdAt, body: node.bodyHTML });

// Write access is what closing, reopening and merging take; triage may close issues on GitHub but is not offered direct actions.
export const writable = (permission: string | null) => ['ADMIN', 'MAINTAIN', 'WRITE'].includes(permission ?? '');

export interface PageInfo { hasNextPage: boolean; endCursor: string | null }
