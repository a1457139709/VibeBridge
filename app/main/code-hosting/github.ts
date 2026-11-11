import { execFile } from 'node:child_process';
import { executable } from '../../terminal/environment';
import { listPageSize, platformDescriptions, type CheckConclusion, type IssueClosure, type IssueFilter, type IssueLabel, type IssueSummary, type MergeRequestSummary, type PlatformFailureKind } from '../../shared/code-hosting';
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

const labelFields = `labels(first: 20) { nodes { name color } }`;
const listLabels = (labels: { nodes: IssueLabel[] }) => labels.nodes.map(({ name, color }) => ({ name, color }));

interface IssueNode {
  number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; createdAt: string; url: string; labels: { nodes: IssueLabel[] };
  parent: { number: number } | null;
  blockedBy: { nodes: { number: number; title: string; state: 'OPEN' | 'CLOSED' }[] };
  /** Read only for listed issues, not for their sub-issues. */
  subIssuesSummary?: { total: number; completed: number };
  subIssues?: { nodes: IssueNode[] };
}
interface PullRequestNode {
  number: number; title: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; isDraft: boolean; createdAt: string; url: string;
  author: { login: string } | null; labels: { nodes: IssueLabel[] };
  commits: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] };
}

/** What a list reads: its search qualifier, the GraphQL fragment of its type and the domain shape it makes. */
interface ListKind<Node, Summary> {
  qualifier: 'issue' | 'pr';
  fragment: string;
  summary(node: Node): Summary;
  /** The filter state the item belongs to. */
  filterState(summary: Summary): IssueFilter['state'];
}

// Sub-issues and blockers come from their own fields, never from search qualifiers or body text.
const relationFields = `parent { number } blockedBy(first: 20) { nodes { number title state } }`;
const ownIssueFields = `number title state stateReason createdAt url ${labelFields} ${relationFields}`;
const closures: Record<string, IssueClosure> = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate' };
function issueSummary(node: IssueNode): IssueSummary {
  const state = node.state === 'OPEN' ? 'open' : 'closed';
  return { number: node.number, title: node.title, state, closedAs: state === 'closed' ? closures[node.stateReason ?? ''] ?? null : null,
    createdAt: node.createdAt, labels: listLabels(node.labels), url: node.url,
    parent: node.parent?.number ?? null,
    subIssues: node.subIssuesSummary?.total && node.subIssues
      ? { total: node.subIssuesSummary.total, completed: node.subIssuesSummary.completed, issues: node.subIssues.nodes.map(issueSummary) }
      : null,
    blockedBy: node.blockedBy.nodes.filter(blocker => blocker.state === 'OPEN').map(({ number, title }) => ({ number, title })) };
}
const issueKind: ListKind<IssueNode, IssueSummary> = {
  qualifier: 'issue',
  fragment: `... on Issue { ${ownIssueFields} subIssuesSummary { total completed } subIssues(first: 50) { nodes { ${ownIssueFields} } } }`,
  summary: issueSummary,
  filterState: issue => issue.state,
};

// The head commit's check rollup; EXPECTED is a required check that has not reported yet.
const conclusions: Record<string, CheckConclusion> = { SUCCESS: 'passing', FAILURE: 'failing', ERROR: 'failing', PENDING: 'pending', EXPECTED: 'pending' };
const pullRequestStates = { OPEN: 'open', CLOSED: 'closed', MERGED: 'merged' } as const;
const pullRequestKind: ListKind<PullRequestNode, MergeRequestSummary> = {
  qualifier: 'pr',
  fragment: `... on PullRequest { number title state isDraft createdAt url author { login } ${labelFields}
    commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`,
  summary(node) {
    const rollup = node.commits.nodes[0]?.commit.statusCheckRollup;
    return { number: node.number, title: node.title, state: pullRequestStates[node.state], draft: node.isDraft, author: node.author?.login ?? null,
      createdAt: node.createdAt, checks: rollup ? conclusions[rollup.state] ?? null : null, labels: listLabels(node.labels), url: node.url };
  },
  filterState: request => request.state === 'open' ? 'open' : 'closed',
};

const listQuery = (fragment: string) => `query($owner: String!, $name: String!, $q: String!, $first: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) { labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color } } }
  search(query: $q, type: ISSUE, first: $first, after: $cursor) { nodes { ${fragment} } pageInfo { hasNextPage endCursor } } }`;
const byNumberQuery = (fragment: string) => `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issueOrPullRequest(number: $number) { ${fragment} } } }`;

/** A search or number lookup can meet the other type, which the fragment leaves empty. */
type SearchNode<Node> = Node | Record<string, never>;
const isKind = <Node,>(node: SearchNode<Node>): node is Node => 'number' in (node as object);
interface SearchPage<Node> {
  repository: { labels: { nodes: IssueLabel[] } };
  search: { nodes: SearchNode<Node>[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}

// A search term only becomes a value: quotes inside it are dropped.
const quoted = (value: string) => `"${value.replaceAll('"', '')}"`;

/** The item whose number the search names, when it is of the list's type and matches the rest of the filter. */
async function byNumber<Node, Summary extends { labels: IssueLabel[] }>(environment: CommandEnvironment, owner: string, name: string,
  number: number, filter: IssueFilter, kind: ListKind<Node, Summary>): Promise<Summary | null> {
  let node: SearchNode<Node> | null;
  try {
    ({ repository: { issueOrPullRequest: node } } = await graphql<{ repository: { issueOrPullRequest: SearchNode<Node> | null } }>(
      environment, byNumberQuery(kind.fragment), { owner, name, number }));
  } catch (error) {
    // The repository was just found, so not found here means nothing has that number.
    if (error instanceof PlatformError && error.failure.kind === 'unreachable') return null;
    throw error;
  }
  if (!node || !isKind(node)) return null;
  const item = kind.summary(node);
  const names = new Set(item.labels.map(label => label.name));
  return kind.filterState(item) === filter.state && filter.labels.every(label => names.has(label)) ? item : null;
}

/** One page of a list, newest first, filtered by GitHub's search. */
async function list<Node, Summary extends { number: number; labels: IssueLabel[] }>(environment: CommandEnvironment, path: string,
  filter: IssueFilter, cursor: string | null, kind: ListKind<Node, Summary>) {
  const [owner, name] = [path.slice(0, path.indexOf('/')), path.slice(path.indexOf('/') + 1)];
  const search = filter.search.trim();
  const number = /^#?(\d+)$/.exec(search);
  const words = number ? number[1] : search;
  const q = [`repo:${path}`, `is:${kind.qualifier}`, `is:${filter.state}`, 'sort:created-desc', ...filter.labels.map(label => `label:${quoted(label)}`),
    ...(words ? [words, 'in:title'] : [])].join(' ');
  const page = await graphql<SearchPage<Node>>(environment, listQuery(kind.fragment), { owner, name, q, first: listPageSize, ...(cursor ? { cursor } : {}) });
  let items = page.search.nodes.filter(isKind).map(node => kind.summary(node));
  // GitHub's search matches words, not numbers: the numbered item leads the first page.
  if (number && !cursor) {
    const numbered = await byNumber(environment, owner, name, Number(number[1]), filter, kind);
    if (numbered) items = [numbered, ...items.filter(item => item.number !== numbered.number)];
  }
  const { hasNextPage, endCursor } = page.search.pageInfo;
  return { items, next: hasNextPage ? endCursor : null, labels: listLabels(page.repository.labels) };
}

export const github: CodeHostingPlatform = {
  description,
  async account(environment) {
    return (await graphql<{ viewer: { login: string } }>(environment, 'query { viewer { login } }')).viewer.login;
  },
  async issues(environment, path, filter, cursor) {
    const { items, next, labels } = await list(environment, path, filter, cursor, issueKind);
    return { issues: items, next, labels };
  },
  async mergeRequests(environment, path, filter, cursor) {
    const { items, next, labels } = await list(environment, path, filter, cursor, pullRequestKind);
    return { mergeRequests: items, next, labels };
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
  remotePath,
};
