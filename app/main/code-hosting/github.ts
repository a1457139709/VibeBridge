import { execFile } from 'node:child_process';
import { executable } from '../../terminal/environment';
import { listPageSize, platformDescriptions, type IssueClosure, type IssueFilter, type IssueLabel, type IssueSummary, type PlatformFailureKind } from '../../shared/code-hosting';
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

// Strings pass verbatim (`-f`); numbers pass typed (`-F`).
async function graphql<T>(environment: CommandEnvironment, query: string, variables: Record<string, string | number> = {}): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])];
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

const issueFields = `number title state stateReason createdAt url labels(first: 20) { nodes { name color } }`;
const issuesQuery = `query($owner: String!, $name: String!, $q: String!, $first: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color } } }
  search(query: $q, type: ISSUE, first: $first, after: $cursor) { nodes { ... on Issue { ${issueFields} } } pageInfo { hasNextPage endCursor } } }`;
const issueByNumberQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ... on Issue { ${issueFields} } } } }`;

interface IssueNode { number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; createdAt: string; url: string; labels: { nodes: IssueLabel[] } }
/** A search or number lookup also meets pull requests, which the Issue fragment leaves empty. */
type SearchNode = IssueNode | Record<string, never>;
const isIssue = (node: SearchNode): node is IssueNode => 'number' in node;
interface IssuesPage {
  repository: { labels: { nodes: IssueLabel[] } };
  search: { nodes: SearchNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}

const closures: Record<string, IssueClosure> = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate' };
function issueSummary(node: IssueNode): IssueSummary {
  const state = node.state === 'OPEN' ? 'open' : 'closed';
  return { number: node.number, title: node.title, state, closedAs: state === 'closed' ? closures[node.stateReason ?? ''] ?? null : null,
    createdAt: node.createdAt, labels: node.labels.nodes.map(({ name, color }) => ({ name, color })), url: node.url };
}

// A search term only becomes a value: quotes inside it are dropped.
const quoted = (value: string) => `"${value.replaceAll('"', '')}"`;

/** The issue whose number the search names, when it matches the rest of the filter. */
async function issueByNumber(environment: CommandEnvironment, owner: string, name: string, number: number, filter: IssueFilter): Promise<IssueSummary | null> {
  let node: SearchNode | null;
  try {
    ({ repository: { issueOrPullRequest: node } } = await graphql<{ repository: { issueOrPullRequest: SearchNode | null } }>(
      environment, issueByNumberQuery, { owner, name, number }));
  } catch (error) {
    // The repository was just found, so not found here means no issue has that number.
    if (error instanceof PlatformError && error.failure.kind === 'unreachable') return null;
    throw error;
  }
  if (!node || !isIssue(node)) return null;
  const issue = issueSummary(node);
  const names = new Set(issue.labels.map(label => label.name));
  return issue.state === filter.state && filter.labels.every(label => names.has(label)) ? issue : null;
}

export const github: CodeHostingPlatform = {
  description,
  async account(environment) {
    return (await graphql<{ viewer: { login: string } }>(environment, 'query { viewer { login } }')).viewer.login;
  },
  async issues(environment, path, filter, cursor) {
    const [owner, name] = [path.slice(0, path.indexOf('/')), path.slice(path.indexOf('/') + 1)];
    const search = filter.search.trim();
    const number = /^#?(\d+)$/.exec(search);
    const words = number ? number[1] : search;
    const q = [`repo:${path}`, 'is:issue', `is:${filter.state}`, 'sort:created-desc', ...filter.labels.map(label => `label:${quoted(label)}`),
      ...(words ? [words, 'in:title'] : [])].join(' ');
    const page = await graphql<IssuesPage>(environment, issuesQuery, { owner, name, q, first: listPageSize, ...(cursor ? { cursor } : {}) });
    let issues = page.search.nodes.filter(isIssue).map(issueSummary);
    // GitHub's search matches words, not numbers: the numbered issue leads the first page.
    if (number && !cursor) {
      const numbered = await issueByNumber(environment, owner, name, Number(number[1]), filter);
      if (numbered) issues = [numbered, ...issues.filter(issue => issue.number !== numbered.number)];
    }
    const { hasNextPage, endCursor } = page.search.pageInfo;
    return { issues, next: hasNextPage ? endCursor : null, labels: page.repository.labels.nodes.map(({ name, color }) => ({ name, color })) };
  },
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
  issueUrl: (path, number) => `https://github.com/${path}/issues/${number}`,
  remotePath,
};
