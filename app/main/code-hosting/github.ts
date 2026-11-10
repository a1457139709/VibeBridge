import { execFile } from 'node:child_process';
import { executable } from '../../terminal/environment';
import { platformDescriptions, type PlatformFailureKind } from '../../shared/code-hosting';
import { PlatformError, type CodeHostingPlatform, type CommandEnvironment } from './platform';

const description = platformDescriptions.github;

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

async function graphql<T>(environment: CommandEnvironment, query: string, variables: Record<string, string> = {}): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`])];
  const output = await gh(environment, args);
  try { return JSON.parse(output).data as T; }
  catch { throw new PlatformError('transient', description, output); }
}

const repositoriesQuery = `query($cursor: String) { viewer { login
  repositories(first: 100, after: $cursor, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: NAME, direction: ASC }) {
    nodes { nameWithOwner } pageInfo { hasNextPage endCursor } } } }`;

interface RepositoriesPage { viewer: { login: string; repositories: { nodes: { nameWithOwner: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }

/** A GitHub remote's `owner/repo`; other hosts and malformed paths give null. */
function remotePath(url: string): string | null {
  let path: string | undefined;
  const scp = /^[^/@:]+@github\.com:(.+)$/i.exec(url);
  if (scp) path = scp[1];
  else {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.toLowerCase() === 'github.com') path = parsed.pathname;
    } catch { return null; }
  }
  const match = path && /^\/?([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(path);
  return match ? match[1] : null;
}

export const github: CodeHostingPlatform = {
  description,
  async bindable(environment) {
    const paths: string[] = [];
    let account = '';
    let cursor: string | null = null;
    do {
      const page: RepositoriesPage = await graphql<RepositoriesPage>(environment, repositoriesQuery, cursor ? { cursor } : {});
      account = page.viewer.login;
      paths.push(...page.viewer.repositories.nodes.map(node => node.nameWithOwner));
      cursor = page.viewer.repositories.pageInfo.hasNextPage ? page.viewer.repositories.pageInfo.endCursor : null;
    } while (cursor);
    return { account, paths };
  },
  remotePath,
};
