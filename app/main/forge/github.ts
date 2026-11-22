import { z } from 'zod';
import type {
  ChecksConclusion,
  DirectAction,
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
const labelPageSchema = z.object({
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
  nodes: z.array(labelSchema),
});
const listPageSchema = <Node extends z.ZodType>(node: Node) =>
  z.object({
    repository: z.object({ ...answeringSchema, labels: labelPageSchema }),
    open: z.object({ issueCount: z.number() }),
    closed: z.object({ issueCount: z.number() }),
    search: z.object({
      pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
      nodes: z.array(node),
    }),
  });
const listedIssueSchema = issueSchema.extend({
  url: z.string(),
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
const issueFields = `number title state stateReason createdAt labels(first: 20) { nodes { name color } } repository { nameWithOwner }
      blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } } issueDependenciesSummary { blockedBy }`;
const labelPageArguments = 'first: 100, orderBy: { field: NAME, direction: ASC }';
const labelPageFields = 'pageInfo { hasNextPage endCursor } nodes { name color }';
const labelPageQuery = `query($owner: String!, $name: String!, $after: String!) {
  repository(owner: $owner, name: $name) { labels(${labelPageArguments}, after: $after) { ${labelPageFields} } }
}`;
const laterLabelPageSchema = z.object({ repository: z.object({ labels: labelPageSchema }) });
const listPageQuery = (
  nodes: string,
) => `query($owner: String!, $name: String!, $search: String!, $openSearch: String!, $closedSearch: String!, $after: String) {
  repository(owner: $owner, name: $name) { ${answeringFields} labels(${labelPageArguments}) { ${labelPageFields} } }
  open: search(query: $openSearch, type: ISSUE, first: 0) { issueCount }
  closed: search(query: $closedSearch, type: ISSUE, first: 0) { issueCount }
  search(query: $search, type: ISSUE, first: ${pageSize}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ${nodes} }
  }
}`;
const listedIssueFields = `${issueFields} url
      parent { number repository { nameWithOwner } }
      subIssuesSummary { total completed }
      subIssues(first: ${relatedLimit}) { nodes { ${issueFields} } }`;
const listedPullRequestFields = `number title state isDraft createdAt author { login }
      labels(first: 20) { nodes { name color } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`;
const issuePageQuery = listPageQuery(`... on Issue { ${listedIssueFields} }`);
const pullRequestPageQuery = listPageQuery(`... on PullRequest { ${listedPullRequestFields} }`);

const byNumberQuery = (item: 'issue' | 'pullRequest', fields: string, numbers: number[]) =>
  `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${answeringFields}
    ${numbers.map(number => `n${number}: ${item}(number: ${number}) { ${fields} }`).join('\n    ')} } }`;
const byNumberSchema = <Node extends z.ZodType>(node: Node) =>
  z.object({ repository: z.object(answeringSchema).catchall(node.nullable()) });

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

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

function listedIssue(issue: z.infer<typeof listedIssueSchema>, path: string): ListedIssue {
  return {
    ...issueSummary(issue, path),
    url: issue.url,
    parent: issue.parent && samePath(issue.parent.repository.nameWithOwner, path) ? issue.parent.number : null,
    subIssues: {
      closed: issue.subIssuesSummary.completed,
      total: issue.subIssuesSummary.total,
      issues: issue.subIssues.nodes
        .filter(child => samePath(child.repository.nameWithOwner, path))
        .map(child => issueSummary(child, path)),
      unlisted: Math.max(0, issue.subIssuesSummary.total - issue.subIssues.nodes.length),
    },
  };
}

const listedPullRequest = (pull: z.infer<typeof listedPullRequestSchema>): PullRequestSummary => ({
  number: pull.number,
  title: pull.title,
  state: pullRequestState(pull.state, pull.isDraft),
  createdAt: pull.createdAt,
  author: pull.author?.login ?? null,
  checks: latestChecks(pull.commits),
  labels: pull.labels.nodes,
});

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

async function withLaterLabelPages(
  host: string,
  owner: string,
  name: string,
  firstPage: z.infer<typeof labelPageSchema>,
) {
  const labels = [...firstPage.nodes];
  for (let page = firstPage.pageInfo; page.hasNextPage && page.endCursor !== null;) {
    const later = await graphql(host, labelPageQuery, { owner, name, after: page.endCursor }, laterLabelPageSchema);
    labels.push(...later.repository.labels.nodes);
    page = later.repository.labels.pageInfo;
  }
  return labels;
}

async function listPage<T extends z.infer<ReturnType<typeof listPageSchema>>>(
  query: string,
  schema: z.ZodType<T>,
  { host, path }: RepositoryReference,
  kind: 'issue' | 'pr',
  { filter, cursor }: { filter: ListFilter; cursor: string | null },
) {
  const [owner, name] = path.split('/');
  const data = await graphql(
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
  const labels =
    cursor === null
      ? await withLaterLabelPages(host, owner, name, data.repository.labels)
      : data.repository.labels.nodes;
  return {
    data,
    frame: {
      nextCursor: data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null,
      labels,
      counts: { open: data.open.issueCount, closed: data.closed.issueCount },
    },
  };
}

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
    const [owner, name] = path.split('/');
    let notAtPath: ForgeError | undefined;
    try {
      const { repository } = await graphql(host, locateQuery, { owner, name }, locatedSchema);
      if (String(repository.databaseId) === id) return repository.nameWithOwner;
    } catch (error) {
      if (!(error instanceof ForgeError) || error.kind !== 'inaccessible') throw error;
      notAtPath = error;
    }
    try {
      return (await gh(host, ['api', `repositories/${id}`, '--jq', '.full_name'])).trim();
    } catch (error) {
      throw error instanceof ForgeError && error.kind === 'inaccessible' ? (notAtPath ?? error) : error;
    }
  },
  async issues(repository, query) {
    const { data, frame } = await listPage(issuePageQuery, issuePageSchema, repository, 'issue', query);
    return answered(data.repository, {
      items: data.search.nodes.map(issue => listedIssue(issue, repository.path)),
      ...frame,
    });
  },
  async pullRequests(repository, query) {
    const { data, frame } = await listPage(pullRequestPageQuery, pullRequestPageSchema, repository, 'pr', query);
    return answered(data.repository, { items: data.search.nodes.map(listedPullRequest), ...frame });
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
