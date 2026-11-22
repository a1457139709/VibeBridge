import { z } from 'zod';
import type {
  ChecksConclusion,
  DirectAction,
  ForgeLabel,
  ListFilter,
  IssueSummary,
  ListedIssue,
  PullRequestSummary,
  RepositoryReference,
} from '../../shared/forge/forge';
import { ForgeError, type Forge } from './forge';
import { gh, ghOutput, graphql, graphqlAllowingMissing } from './github-cli';
import {
  checksState,
  latestChecks,
  issueReference,
  issueReferenceFields,
  issueReferenceSchema,
  issueState,
  issueStateFields,
  labelSchema,
  loginSchema,
  pullRequestState,
  relatedLimit,
  repositoryLinks,
  canWrite,
  viewerPermission,
  answeredBy,
  answeringFields,
  answeringSchema,
} from './github-fields';
import { issueDetail } from './github-issue';
import { fetchPullRequestDetail } from './github-pull-request';

const pageSize = 25;
const repositorySchema = z.object({ nameWithOwner: z.string() });
const issueSchema = z.object({
  number: z.number(),
  title: z.string(),
  ...issueStateFields,
  createdAt: z.string(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  repository: repositorySchema,
  blockedBy: z.object({
    nodes: z.array(
      z.object({ number: z.number(), title: z.string(), state: issueStateFields.state, repository: repositorySchema }),
    ),
  }),
  issueDependenciesSummary: z.object({ blockedBy: z.number() }),
});
/** A list page: the repository's labels, the open and closed counts, and one page of search results. */
const listPageSchema = <Node extends z.ZodType>(node: Node) =>
  z.object({
    repository: z.object({ ...answeringSchema, labels: z.object({ nodes: z.array(labelSchema) }) }),
    open: z.object({ issueCount: z.number() }),
    closed: z.object({ issueCount: z.number() }),
    search: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(node),
    }),
  });
/** An issue as a list holds it, with its place in the issue tree. */
const listedIssueSchema = issueSchema.extend({
  parent: z.object({ number: z.number(), repository: repositorySchema }).nullable(),
  subIssuesSummary: z.object({ total: z.number(), completed: z.number() }),
  subIssues: z.object({ nodes: z.array(issueSchema) }),
});
const listedPullRequestSchema = z.object({
  number: z.number(),
  title: z.string(),
  state: z.enum(['OPEN', 'MERGED', 'CLOSED']),
  isDraft: z.boolean(),
  createdAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  commits: z.object({
    nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: checksState }).nullable() }) })),
  }),
});
const issuePageSchema = listPageSchema(listedIssueSchema);
const pullRequestPageSchema = listPageSchema(listedPullRequestSchema);
// Sub-issues and blockers come from their own fields (`parent`, `subIssues`, `blockedBy`), not search qualifiers.
// `blockedBy` lists open and closed blockers alike; `issueDependenciesSummary.blockedBy` counts the open ones, also those past the listed window.
const issueFields = `number title state stateReason createdAt labels(first: 20) { nodes { name color } } repository { nameWithOwner }
      blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } } issueDependenciesSummary { blockedBy }`;
/** A list page query whose search results carry `nodes`. GitHub's issue search also finds pull requests (is:pr). */
const listPageQuery = (
  nodes: string,
) => `query($owner: String!, $name: String!, $search: String!, $openSearch: String!, $closedSearch: String!, $after: String) {
  repository(owner: $owner, name: $name) { ${answeringFields} labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color } } }
  open: search(query: $openSearch, type: ISSUE, first: 0) { issueCount }
  closed: search(query: $closedSearch, type: ISSUE, first: 0) { issueCount }
  search(query: $search, type: ISSUE, first: ${pageSize}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ${nodes} }
  }
}`;
const listedIssueFields = `${issueFields}
      parent { number repository { nameWithOwner } }
      subIssuesSummary { total completed }
      subIssues(first: 50) { nodes { ${issueFields} } }`;
// The checks conclusion is the status check rollup of the latest commit.
const listedPullRequestFields = `number title state isDraft createdAt author { login }
      labels(first: 20) { nodes { name color } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;
const issuePageQuery = listPageQuery(`... on Issue { ${listedIssueFields} }`);
const pullRequestPageQuery = listPageQuery(`... on PullRequest { ${listedPullRequestFields} }`);

/** A query for the repository's issues or pull requests with these numbers, each under its own field, with no search. */
const byNumberQuery = (item: 'issue' | 'pullRequest', fields: string, numbers: number[]) =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${answeringFields}
    ${numbers.map(number => `n${number}: ${item}(number: ${number}) { ${fields} }`).join('\n    ')} } }`;
/** The answer to a query by number: the repository, and each number's item, or null when it has none. */
const byNumberSchema = <Node extends z.ZodType>(node: Node) =>
  z.object({ repository: z.object(answeringSchema).catchall(node.nullable()) });

/** GitHub repository paths are case-insensitive. */
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An issue's own fields, and the open issues blocking it; a blocker in another repository names it. */
function issueSummary(issue: z.infer<typeof issueSchema>, path: string): IssueSummary {
  const blockedBy = issue.blockedBy.nodes
    .filter(blocker => blocker.state === 'OPEN')
    .map(blocker => ({
      path: samePath(blocker.repository.nameWithOwner, path) ? null : blocker.repository.nameWithOwner,
      number: blocker.number,
      title: blocker.title,
    }));
  return {
    number: issue.number,
    title: issue.title,
    ...issueState(issue),
    createdAt: issue.createdAt,
    labels: issue.labels.nodes,
    blockedBy,
    unlistedBlockers: Math.max(0, issue.issueDependenciesSummary.blockedBy - blockedBy.length),
  };
}

/** An issue as a list holds it: its own fields, and its parent and sub-issues in the same repository. */
function listedIssue(issue: z.infer<typeof listedIssueSchema>, path: string): ListedIssue {
  return {
    ...issueSummary(issue, path),
    parent: issue.parent && samePath(issue.parent.repository.nameWithOwner, path) ? issue.parent.number : null,
    subIssues: {
      closed: issue.subIssuesSummary.completed,
      total: issue.subIssuesSummary.total,
      issues: issue.subIssues.nodes
        .filter(child => samePath(child.repository.nameWithOwner, path))
        .map(child => issueSummary(child, path)),
    },
  };
}

/** A pull request as a list holds it. */
const listedPullRequest = (pull: z.infer<typeof listedPullRequestSchema>): PullRequestSummary => ({
  number: pull.number,
  title: pull.title,
  state: pullRequestState(pull.state, pull.isDraft),
  createdAt: pull.createdAt,
  author: pull.author?.login ?? null,
  checks: latestChecks(pull.commits),
  labels: pull.labels.nodes,
});

/** Reads the repository's items with these numbers in one request, as `schema` reads each; a number with no item of
 * the kind asked is left out. */
async function byNumber<Node extends z.ZodType>(
  { host, path }: RepositoryReference,
  item: 'issue' | 'pullRequest',
  fields: string,
  node: Node,
  numbers: number[],
) {
  const [owner, name] = path.split('/');
  const { repository } = await graphqlAllowingMissing(
    host,
    byNumberQuery(item, fields, numbers),
    { owner, name },
    byNumberSchema(node),
  );
  const found: (z.infer<Node> | null | undefined)[] = numbers.map(number => repository[`n${number}`]);
  return { repository, items: found.filter((item): item is z.infer<Node> => item !== null && item !== undefined) };
}

/** GitHub search text for the filter, of issues or pull requests. A number (with or without #) matches the number;
 * other words match the title. A pull request is:closed when it is closed or merged. */
function listSearch(path: string, kind: 'issue' | 'pr', { search, state, labels }: ListFilter) {
  const quote = (text: string) => `"${text.replace(/"/g, '')}"`;
  const term = search.trim();
  const words = /^#?\d+$/.test(term)
    ? [term.replace('#', '')]
    : term
      ? [...term.split(/\s+/).map(quote), 'in:title']
      : [];
  return [
    `repo:${path}`,
    `is:${kind}`,
    `is:${state}`,
    'sort:created-desc',
    ...labels.map(label => `label:${quote(label)}`),
    ...words,
  ].join(' ');
}

/** Runs a list page query for the filter's page and its open and closed counts. */
function listPage<T>(
  query: string,
  schema: z.ZodType<T>,
  { host, path }: RepositoryReference,
  kind: 'issue' | 'pr',
  { filter, cursor }: { filter: ListFilter; cursor: string | null },
) {
  const [owner, name] = path.split('/');
  return graphql(
    host,
    query,
    {
      owner,
      name,
      search: listSearch(path, kind, filter),
      openSearch: listSearch(path, kind, { ...filter, state: 'open' }),
      closedSearch: listSearch(path, kind, { ...filter, state: 'closed' }),
      ...(cursor === null ? {} : { after: cursor }),
    },
    schema,
  );
}
/** The next page's cursor, the labels and counts; the caller maps the items. */
const pageFrame = (data: {
  repository: { labels: { nodes: ForgeLabel[] } };
  open: { issueCount: number };
  closed: { issueCount: number };
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null } };
}) => ({
  nextCursor: data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null,
  labels: data.repository.labels.nodes,
  counts: { open: data.open.issueCount, closed: data.closed.issueCount },
});

/** The `gh` subcommand for each direct action; writes go through `gh issue` and `gh pr`, not the API. With a method flag and
 * no message, `gh pr merge` merges at once with GitHub's default commit message and keeps the branch. */
const actionArgs = (action: DirectAction): string[] => {
  const number = String(action.number);
  switch (action.kind) {
    case 'closeIssue':
      return ['issue', 'close', number, '--reason', action.reason === 'completed' ? 'completed' : 'not planned'];
    case 'reopenIssue':
      return ['issue', 'reopen', number];
    case 'merge':
      return ['pr', 'merge', number, `--${action.method}`];
    case 'closePullRequest':
      return ['pr', 'close', number];
    case 'reopenPullRequest':
      return ['pr', 'reopen', number];
  }
};

const outputLines = (text: string) =>
  text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The data of a read, and the repository that answered it at the path the read named. */
const answered = <T>(repository: { databaseId: number; nameWithOwner: string }, data: T) => ({
  answeredBy: answeredBy(repository),
  data,
});
const locateQuery = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${answeringFields} } }`;
const locatedSchema = z.object({ repository: z.object(answeringSchema) });

export const github: Forge = {
  id: 'github',
  defaultHost: 'github.com',
  presentation: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' },
  capabilities: {
    subIssues: true,
    blocking: true,
    requiredChecks: true,
    mergeQueue: true,
    mergeMethods: ['merge', 'squash', 'rebase'],
  },
  async account(host) {
    return (await gh(host, ['api', 'user', '--jq', '.login'])).trim();
  },
  async repositories(host) {
    // The REST `id` is the GraphQL `databaseId`: a number GitHub keeps through renames and transfers.
    return outputLines(
      await gh(host, [
        'api',
        '--paginate',
        'user/repos?affiliation=owner,collaborator,organization_member&per_page=100',
        '--jq',
        '.[] | "\\(.id) \\(.full_name)"',
      ]),
    ).map(line => {
      const [id, path] = line.split(' ');
      return { id, path };
    });
  },
  remotePath(host, url) {
    // owner/repo from a remote URL on the host in HTTPS, SSH or scp-like form.
    const at = escapeRegExp(host);
    const match = url
      .trim()
      .match(
        new RegExp(
          `^(?:(?:https?|ssh|git)://(?:[^@/]+@)?${at}(?::\\d+)?/|[^@/\\s]+@${at}:)([^/\\s]+/[^/\\s]+?)(?:\\.git)?/?$`,
          'i',
        ),
      );
    return match?.[1] ?? null;
  },
  issueUrl({ host, path }, number) {
    return `https://${host}/${path}/issues/${number}`;
  },
  matchListedPath(path, paths) {
    return paths.find(listed => samePath(listed, path)) ?? null;
  },
  async locate({ host, id, path }) {
    if (!/^\d+$/.test(id)) throw new ForgeError('inaccessible', '');
    // GitHub answers a renamed or transferred repository at its former path while a redirect stays there; the ID tells
    // whether the one answering is still this repository.
    const [owner, name] = path.split('/');
    let notAtPath: ForgeError | undefined;
    try {
      const { repository } = await graphql(host, locateQuery, { owner, name }, locatedSchema);
      if (String(repository.databaseId) === id) return repository.nameWithOwner;
    } catch (error) {
      if (!(error instanceof ForgeError) || error.kind !== 'inaccessible') throw error;
      notAtPath = error;
    }
    // With no redirect left, or another repository at the path, only the ID finds it. `repositories/{id}` is not in
    // GitHub's documented REST API, so it is asked only then. When it cannot find the repository either, GitHub's
    // answer for the path says more than its 404 for the ID.
    try {
      return (await gh(host, ['api', `repositories/${id}`, '--jq', '.full_name'])).trim();
    } catch (error) {
      throw error instanceof ForgeError && error.kind === 'inaccessible' ? (notAtPath ?? error) : error;
    }
  },
  async issues(repository, query) {
    const data = await listPage(issuePageQuery, issuePageSchema, repository, 'issue', query);
    return answered(data.repository, {
      items: data.search.nodes.map(issue => listedIssue(issue, repository.path)),
      ...pageFrame(data),
    });
  },
  async pullRequests(repository, query) {
    const data = await listPage(pullRequestPageQuery, pullRequestPageSchema, repository, 'pr', query);
    return answered(data.repository, { items: data.search.nodes.map(listedPullRequest), ...pageFrame(data) });
  },
  async issuesByNumber(repository, numbers) {
    const read = await byNumber(repository, 'issue', listedIssueFields, listedIssueSchema, numbers);
    return answered(
      read.repository,
      read.items.map(issue => listedIssue(issue, repository.path)),
    );
  },
  async pullRequestsByNumber(repository, numbers) {
    const read = await byNumber(repository, 'pullRequest', listedPullRequestFields, listedPullRequestSchema, numbers);
    return answered(read.repository, read.items.map(listedPullRequest));
  },
  issue: issueDetail,
  pullRequest: fetchPullRequestDetail,
  async act({ host, path }, action) {
    const { stdout, stderr } = await ghOutput(host, [...actionArgs(action), '--repo', path]);
    return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  },
};
