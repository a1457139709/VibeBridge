import { listPageSize, type ListFilter, type IssueLabel, type IssueDetail, type IssueSummary, type MergeRequestReference, type MergeRequestSummary } from '../../shared/code-hosting';
import { PlatformError, type CodeHostingPlatform, type CommandEnvironment } from './platform';
import { closure, commentFields, conclusions, description, graphql, issueComment, labelFields, listLabels, ownerAndName, pullRequestStates,
  relatedIssue, relatedIssueFields, writable, type CommentNode, type RelatedIssueNode } from './github-graphql';
import { mergeRequest } from './github-merge-request';
import { act } from './github-direct-actions';

const repositoriesQuery = `query($cursor: String) { viewer { login
  repositories(first: 100, after: $cursor, affiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], ownerAffiliations: [OWNER, COLLABORATOR, ORGANIZATION_MEMBER], orderBy: { field: NAME, direction: ASC }) {
    nodes { nameWithOwner } pageInfo { hasNextPage endCursor } } } }`;

interface RepositoriesPage { viewer: { login: string; repositories: { nodes: { nameWithOwner: string }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }

/** A GitHub remote's `owner/repo`; other hosts and malformed paths give null. */
function remotePath(url: string): string | null {
  const scp = /^[^/@:]+@([^/:]+):(.+)$/.exec(url);
  const parsed = scp ? null : URL.parse(url);
  const [host, path] = scp ? [scp[1], scp[2]] : [parsed?.hostname, parsed?.pathname];
  if (host?.toLowerCase() !== description.host) return null;
  const match = path && /^\/?([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(path);
  return match ? match[1] : null;
}

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
  filterState(summary: Summary): ListFilter['state'];
}

// Sub-issues and blockers come from their own fields, never from search qualifiers or body text.
const relationFields = `parent { number } blockedBy(first: 20) { nodes { number title state } }`;
const ownIssueFields = `number title state stateReason createdAt url ${labelFields} ${relationFields}`;
function issueSummary(node: IssueNode): IssueSummary {
  const state = node.state === 'OPEN' ? 'open' : 'closed';
  return { number: node.number, title: node.title, state, closedAs: closure(node.state, node.stateReason),
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
  number: number, filter: ListFilter, kind: ListKind<Node, Summary>): Promise<Summary | null> {
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
  filter: ListFilter, cursor: string | null, kind: ListKind<Node, Summary>) {
  const { owner, name } = ownerAndName(path);
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

// GitHub leaves closed pull requests out of the closing references unless asked; the detail shows them too.
const issueDetailQuery = `query($owner: String!, $name: String!, $number: Int!, $comments: String) {
  repository(owner: $owner, name: $name) { viewerPermission issue(number: $number) { number title state stateReason createdAt url ${labelFields}
    author { login } bodyHTML assignees(first: 50) { nodes { login } }
    comments(first: 100, after: $comments) { totalCount nodes { ${commentFields} } pageInfo { hasNextPage endCursor } }
    parent { ${relatedIssueFields} }
    subIssues(first: 100) { nodes { ${relatedIssueFields} } }
    blockedBy(first: 100) { nodes { ${relatedIssueFields} } }
    blocking(first: 100) { nodes { ${relatedIssueFields} } }
    closedByPullRequestsReferences(first: 50, includeClosedPrs: true) { nodes { number title state isDraft url
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } } } } }`;

type ClosingPullRequestNode = Pick<PullRequestNode, 'number' | 'title' | 'state' | 'isDraft' | 'url' | 'commits'>;
interface IssueDetailNode {
  number: number; title: string; state: 'OPEN' | 'CLOSED'; stateReason: string | null; createdAt: string; url: string; labels: { nodes: IssueLabel[] };
  author: { login: string } | null; bodyHTML: string; assignees: { nodes: { login: string }[] };
  comments: { totalCount: number; nodes: CommentNode[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  parent: RelatedIssueNode | null; subIssues: { nodes: RelatedIssueNode[] }; blockedBy: { nodes: RelatedIssueNode[] }; blocking: { nodes: RelatedIssueNode[] };
  closedByPullRequestsReferences: { nodes: ClosingPullRequestNode[] };
}

function closingMergeRequest(node: ClosingPullRequestNode): MergeRequestReference {
  const rollup = node.commits.nodes[0]?.commit.statusCheckRollup;
  return { number: node.number, title: node.title, state: pullRequestStates[node.state], draft: node.isDraft,
    checks: rollup ? conclusions[rollup.state] ?? null : null, url: node.url };
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
  async issue(environment, path, number) {
    const { owner, name } = ownerAndName(path);
    const read = async (cursor: string | null) => {
      const { repository } = await graphql<{ repository: { viewerPermission: string | null; issue: IssueDetailNode | null } }>(environment, issueDetailQuery,
        { owner, name, number, ...(cursor ? { comments: cursor } : {}) });
      if (!repository.issue) throw new PlatformError('unreachable', description, `#${number}`);
      return Object.assign(repository.issue, { permission: repository.viewerPermission });
    };
    const node = await read(null);
    const comments = node.comments.nodes.map(issueComment);
    for (let page = node.comments.pageInfo; page.hasNextPage && page.endCursor;) {
      const next = await read(page.endCursor);
      comments.push(...next.comments.nodes.map(issueComment));
      page = next.comments.pageInfo;
    }
    const detail: IssueDetail = { number: node.number, title: node.title, state: node.state === 'OPEN' ? 'open' : 'closed', closedAs: closure(node.state, node.stateReason),
      createdAt: node.createdAt, labels: listLabels(node.labels), url: node.url,
      author: node.author?.login ?? null, assignees: node.assignees.nodes.map(({ login }) => login),
      body: node.bodyHTML, commentCount: node.comments.totalCount, comments,
      parent: node.parent && relatedIssue(node.parent), subIssues: node.subIssues.nodes.map(relatedIssue),
      blockedBy: node.blockedBy.nodes.map(relatedIssue), blocking: node.blocking.nodes.map(relatedIssue),
      closingMergeRequests: node.closedByPullRequestsReferences.nodes.map(closingMergeRequest), writable: writable(node.permission) };
    return detail;
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
  mergeRequest,
  act,
  remotePath,
};
