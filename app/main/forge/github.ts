import { z } from 'zod';
import type { ChecksConclusion, DirectAction, ForgeLabel, ListFilter, IssueSummary } from '../../shared/forge';
import type { Forge } from './forge';
import { gh, ghOutput, graphql } from './github-cli';
import { checksState, issueReference, issueReferenceFields, issueReferenceSchema, issueState, issueStateFields, labelSchema, loginSchema, pullRequestState, relatedLimit, repositoryLinks, canWrite, viewerPermission } from './github-fields';
import { pullRequestDetail } from './github-pull-request';


const pageSize = 25;
const repositorySchema = z.object({ nameWithOwner: z.string() });
const issueSchema = z.object({
  number: z.number(), title: z.string(), ...issueStateFields, createdAt: z.string(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  repository: repositorySchema,
  blockedBy: z.object({ nodes: z.array(z.object({ number: z.number(), title: z.string(), state: issueStateFields.state, repository: repositorySchema })) }),
  issueDependenciesSummary: z.object({ blockedBy: z.number() }),
});
/** A list page: the repository's labels, the open and closed counts, and one page of search results. */
const listPageSchema = <Node extends z.ZodType>(node: Node) => z.object({
  repository: z.object({ labels: z.object({ nodes: z.array(labelSchema) }) }),
  open: z.object({ issueCount: z.number() }),
  closed: z.object({ issueCount: z.number() }),
  search: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(node),
  }),
});
const issuePageSchema = listPageSchema(issueSchema.extend({
  parent: z.object({ number: z.number(), repository: repositorySchema }).nullable(),
  subIssuesSummary: z.object({ total: z.number(), completed: z.number() }),
  subIssues: z.object({ nodes: z.array(issueSchema) }),
}));
const pullRequestPageSchema = listPageSchema(z.object({
  number: z.number(), title: z.string(), state: z.enum(['OPEN', 'MERGED', 'CLOSED']), isDraft: z.boolean(), createdAt: z.string(),
  author: z.object({ login: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: checksState }).nullable() }) })) }),
}));
// Sub-issues and blockers come from their own fields (`parent`, `subIssues`, `blockedBy`), not search qualifiers.
// `blockedBy` lists open and closed blockers alike; `issueDependenciesSummary.blockedBy` counts the open ones, also those past the listed window.
const issueFields = `number title state stateReason createdAt labels(first: 20) { nodes { name color } } repository { nameWithOwner }
      blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } } issueDependenciesSummary { blockedBy }`;
/** A list page query whose search results carry `nodes`. GitHub's issue search also finds pull requests (is:pr). */
const listPageQuery = (nodes: string) => `query($owner: String!, $name: String!, $search: String!, $openSearch: String!, $closedSearch: String!, $after: String) {
  repository(owner: $owner, name: $name) { labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color } } }
  open: search(query: $openSearch, type: ISSUE, first: 0) { issueCount }
  closed: search(query: $closedSearch, type: ISSUE, first: 0) { issueCount }
  search(query: $search, type: ISSUE, first: ${pageSize}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ${nodes} }
  }
}`;
const issuePageQuery = listPageQuery(`... on Issue { ${issueFields}
      parent { number repository { nameWithOwner } }
      subIssuesSummary { total completed }
      subIssues(first: 50) { nodes { ${issueFields} } } }`);
// The checks conclusion is the status check rollup of the latest commit.
const pullRequestPageQuery = listPageQuery(`... on PullRequest { number title state isDraft createdAt author { login }
      labels(first: 20) { nodes { name color } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`);

const issueDetailSchema = z.object({ repository: z.object({ url: z.string(), viewerPermission, issue: z.object({
  number: z.number(), title: z.string(), ...issueStateFields, createdAt: z.string(), url: z.string(), bodyHTML: z.string(), author: loginSchema,
  assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
  labels: z.object({ nodes: z.array(labelSchema) }),
  comments: z.object({ totalCount: z.number(), nodes: z.array(z.object({ author: loginSchema, createdAt: z.string(), bodyHTML: z.string() })) }),
  parent: issueReferenceSchema.extend({ subIssuesSummary: z.object({ total: z.number(), completed: z.number() }) }).nullable(),
  subIssues: z.object({ nodes: z.array(issueReferenceSchema) }),
  blockedBy: z.object({ nodes: z.array(issueReferenceSchema) }),
  blocking: z.object({ nodes: z.array(issueReferenceSchema) }),
  closedByPullRequestsReferences: z.object({ nodes: z.array(z.object({
    number: z.number(), title: z.string(), url: z.string(), state: z.enum(['OPEN', 'CLOSED', 'MERGED']), isDraft: z.boolean(),
    commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ state: checksState }).nullable() }) })) }),
  })) }),
}) }) });
// The first 100 comments are listed; `totalCount` counts them all.
const issueDetailQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { url viewerPermission issue(number: $number) {
    number title state stateReason createdAt url bodyHTML author { login }
    assignees(first: 20) { nodes { login } }
    labels(first: 20) { nodes { name color } }
    comments(first: 100) { totalCount nodes { author { login } createdAt bodyHTML } }
    parent { ${issueReferenceFields} subIssuesSummary { total completed } }
    subIssues(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    blockedBy(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    blocking(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    closedByPullRequestsReferences(first: ${relatedLimit}, includeClosedPrs: true) {
      nodes { number title url state isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  } }
}`;

/** GitHub repository paths are case-insensitive. */
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An issue's own fields, and the open issues blocking it; a blocker in another repository names it. */
function issueSummary(issue: z.infer<typeof issueSchema>, path: string): IssueSummary {
  const blockedBy = issue.blockedBy.nodes.filter(blocker => blocker.state === 'OPEN').map(blocker =>
    ({ path: samePath(blocker.repository.nameWithOwner, path) ? null : blocker.repository.nameWithOwner, number: blocker.number, title: blocker.title }));
  return { number: issue.number, title: issue.title, ...issueState(issue), createdAt: issue.createdAt, labels: issue.labels.nodes,
    blockedBy, unlistedBlockers: Math.max(0, issue.issueDependenciesSummary.blockedBy - blockedBy.length) };
}

/** GitHub search text for the filter, of issues or pull requests. A number (with or without #) matches the number;
 * other words match the title. A pull request is:closed when it is closed or merged. */
function listSearch(path: string, kind: 'issue' | 'pr', { search, state, labels }: ListFilter) {
  const quote = (text: string) => `"${text.replace(/"/g, '')}"`;
  const term = search.trim();
  const words = /^#?\d+$/.test(term) ? [term.replace('#', '')] : term ? [...term.split(/\s+/).map(quote), 'in:title'] : [];
  return [`repo:${path}`, `is:${kind}`, `is:${state}`, 'sort:created-desc', ...labels.map(label => `label:${quote(label)}`), ...words].join(' ');
}

/** Runs a list page query for the filter's page and its open and closed counts. */
function listPage<T>(query: string, schema: z.ZodType<T>, path: string, kind: 'issue' | 'pr', { filter, cursor }: { filter: ListFilter; cursor: string | null }) {
  const [owner, name] = path.split('/');
  return graphql(query, { owner, name, search: listSearch(path, kind, filter), openSearch: listSearch(path, kind, { ...filter, state: 'open' }),
    closedSearch: listSearch(path, kind, { ...filter, state: 'closed' }), ...cursor === null ? {} : { after: cursor } }, schema);
}
/** The page's cursor, labels and counts; the caller maps the items. */
const pageFrame = (data: { repository: { labels: { nodes: ForgeLabel[] } }; open: { issueCount: number }; closed: { issueCount: number };
  search: { pageInfo: { hasNextPage: boolean; endCursor: string | null } } }) => ({
  cursor: data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null,
  labels: data.repository.labels.nodes,
  counts: { open: data.open.issueCount, closed: data.closed.issueCount },
});

const checksConclusion: Record<z.infer<typeof checksState>, ChecksConclusion> = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'pending', EXPECTED: 'pending' };
/** The checks conclusion of a pull request's latest commit, from its status check rollup. */
const latestChecks = (commits: { nodes: { commit: { statusCheckRollup: { state: z.infer<typeof checksState> } | null } }[] }): ChecksConclusion => {
  const rollup = commits.nodes[0]?.commit.statusCheckRollup;
  return rollup ? checksConclusion[rollup.state] : 'none';
};


/** The `gh` subcommand for each direct action; writes go through `gh issue` and `gh pr`, not the API. With a method flag and
 * no message, `gh pr merge` merges at once with GitHub's default commit message and keeps the branch. */
const actionArgs = (action: DirectAction): string[] => {
  const number = String(action.number);
  switch (action.kind) {
    case 'closeIssue': return ['issue', 'close', number, '--reason', action.reason === 'completed' ? 'completed' : 'not planned'];
    case 'reopenIssue': return ['issue', 'reopen', number];
    case 'merge': return ['pr', 'merge', number, `--${action.method}`];
    case 'closePullRequest': return ['pr', 'close', number];
    case 'reopenPullRequest': return ['pr', 'reopen', number];
  }
};

const outputLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

export const github: Forge = {
  id: 'github',
  presentation: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' },
  capabilities: { subIssues: true, blocking: true, requiredChecks: true, mergeQueue: true, mergeMethods: ['merge', 'squash', 'rebase'] },
  async account() { return (await gh(['api', 'user', '--jq', '.login'])).trim(); },
  async repositories() {
    return outputLines(await gh(['api', '--paginate', 'user/repos?affiliation=owner,collaborator,organization_member&per_page=100', '--jq', '.[].full_name']));
  },
  remotePath(url) {
    // owner/repo from a github.com remote URL in HTTPS, SSH or scp-like form.
    const match = url.trim().match(/^(?:(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/|[^@/\s]+@github\.com:)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i);
    return match?.[1] ?? null;
  },
  find(path, repositories) {
    return repositories.find(repository => samePath(repository, path)) ?? null;
  },
  async issues(path, query) {
    const data = await listPage(issuePageQuery, issuePageSchema, path, 'issue', query);
    return {
      items: data.search.nodes.map(issue => ({ ...issueSummary(issue, path),
        parent: issue.parent && samePath(issue.parent.repository.nameWithOwner, path) ? issue.parent.number : null,
        subIssues: { closed: issue.subIssuesSummary.completed, total: issue.subIssuesSummary.total,
          issues: issue.subIssues.nodes.filter(child => samePath(child.repository.nameWithOwner, path)).map(child => issueSummary(child, path)) } })),
      ...pageFrame(data),
    };
  },
  async pullRequests(path, query) {
    const data = await listPage(pullRequestPageQuery, pullRequestPageSchema, path, 'pr', query);
    return {
      items: data.search.nodes.map(pull => ({ number: pull.number, title: pull.title, state: pullRequestState(pull.state, pull.isDraft),
        createdAt: pull.createdAt, author: pull.author?.login ?? null, checks: latestChecks(pull.commits), labels: pull.labels.nodes })),
      ...pageFrame(data),
    };
  },
  async issue(path, number) {
    const [owner, name] = path.split('/');
    const { repository } = await graphql(issueDetailQuery, { owner, name, number }, issueDetailSchema);
    const { issue } = repository;
    return {
      number: issue.number, title: issue.title, ...issueState(issue), createdAt: issue.createdAt, labels: issue.labels.nodes,
      url: issue.url, author: issue.author?.login ?? null, assignees: issue.assignees.nodes.map(assignee => assignee.login),
      body: issue.bodyHTML,
      comments: issue.comments.nodes.map(comment => ({ author: comment.author?.login ?? null, createdAt: comment.createdAt, html: comment.bodyHTML })),
      commentCount: issue.comments.totalCount,
      parent: issue.parent && { ...issueReference(issue.parent),
        progress: { closed: issue.parent.subIssuesSummary.completed, total: issue.parent.subIssuesSummary.total } },
      subIssues: issue.subIssues.nodes.map(issueReference).sort((a, b) => a.number - b.number),
      blockedBy: issue.blockedBy.nodes.map(issueReference),
      blocking: issue.blocking.nodes.map(issueReference),
      closingPullRequests: issue.closedByPullRequestsReferences.nodes.map(pull =>
        ({ number: pull.number, title: pull.title, url: pull.url, state: pullRequestState(pull.state, pull.isDraft), checks: latestChecks(pull.commits) })),
      links: repositoryLinks(repository.url),
      canWrite: canWrite(repository.viewerPermission),
    };
  },
  pullRequest: pullRequestDetail,
  async act(path, action) {
    const { stdout, stderr } = await ghOutput([...actionArgs(action), '--repo', path]);
    return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
  },
};
