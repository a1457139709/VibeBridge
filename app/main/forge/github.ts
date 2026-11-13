import { execFile } from 'node:child_process';
import { z } from 'zod';
import { executable } from '../../terminal/environment';
import type { IssueListFilter, IssueSummary } from '../../shared/forge';
import { ForgeError, type Forge } from './forge';

/** Runs `gh`, found on PATH, with the account it has active. The Workbench never reads or stores a token. */
async function gh(args: string[]): Promise<string> {
  let program: string;
  try { program = await executable('gh', process.env as Record<string, string>); }
  catch { throw new ForgeError('notInstalled', ''); }
  return new Promise((resolve, reject) => {
    execFile(program, args, { env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const code = (error as { code?: unknown }).code;
        reject(code === 'ENOENT' ? new ForgeError('notInstalled', '') : classifyFailure(typeof code === 'number' ? code : null, stdout, stderr || error.message));
      });
  });
}

/** Exit code 4 is gh's "authentication required"; 401 and 404 come from the REST API, NOT_FOUND from GraphQL. */
function classifyFailure(code: number | null, stdout: string, stderr: string) {
  const detail = stderr.trim() || stdout.trim();
  if (code === 4 || /\bHTTP 401\b/.test(stderr)) return new ForgeError('loggedOut', detail);
  if (/\bHTTP 404\b/.test(stderr) || /"type"\s*:\s*"NOT_FOUND"/.test(stdout + stderr)) return new ForgeError('inaccessible', detail);
  return new ForgeError('transient', detail);
}

/** Runs a GraphQL query and reads its data with `schema`; output gh did not fail on but that does not fit is a transient failure.
 * A number variable is sent as a GraphQL Int (`-F`), a string as a String (`-f`). */
async function graphql<T>(query: string, variables: Record<string, string | number>, schema: z.ZodType<T>): Promise<T> {
  const output = await gh(['api', 'graphql', '-f', `query=${query}`,
    ...Object.entries(variables).flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`])]);
  let json: unknown;
  try { json = JSON.parse(output); } catch { throw new ForgeError('transient', output.trim()); }
  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ForgeError('transient', output.trim());
  return parsed.data.data;
}

const pageSize = 25;
const labelSchema = z.object({ name: z.string(), color: z.string() });
const closedAs = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate', REOPENED: null } as const;
const issueStateFields = { state: z.enum(['OPEN', 'CLOSED']), stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).nullable() };
/** An issue's state, and for a closed issue how it was closed when GitHub tells. */
const issueState = (issue: z.infer<z.ZodObject<typeof issueStateFields>>) => ({ state: issue.state === 'OPEN' ? 'open' as const : 'closed' as const,
  closedAs: issue.state === 'OPEN' || !issue.stateReason ? null : closedAs[issue.stateReason] });
const repositorySchema = z.object({ nameWithOwner: z.string() });
const issueSchema = z.object({
  number: z.number(), title: z.string(), ...issueStateFields, createdAt: z.string(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  repository: repositorySchema,
  blockedBy: z.object({ nodes: z.array(z.object({ number: z.number(), title: z.string(), state: issueStateFields.state, repository: repositorySchema })) }),
  issueDependenciesSummary: z.object({ blockedBy: z.number() }),
});
const issuePageSchema = z.object({
  repository: z.object({ labels: z.object({ nodes: z.array(labelSchema) }) }),
  open: z.object({ issueCount: z.number() }),
  closed: z.object({ issueCount: z.number() }),
  search: z.object({
    pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }),
    nodes: z.array(issueSchema.extend({
      parent: z.object({ number: z.number(), repository: repositorySchema }).nullable(),
      subIssuesSummary: z.object({ total: z.number(), completed: z.number() }),
      subIssues: z.object({ nodes: z.array(issueSchema) }),
    })),
  }),
});
// Sub-issues and blockers come from their own fields (`parent`, `subIssues`, `blockedBy`), not search qualifiers.
// `blockedBy` lists open and closed blockers alike; `issueDependenciesSummary.blockedBy` counts the open ones, also those past the listed window.
const issueFields = `number title state stateReason createdAt labels(first: 20) { nodes { name color } } repository { nameWithOwner }
      blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } } issueDependenciesSummary { blockedBy }`;
const issuePageQuery = `query($owner: String!, $name: String!, $search: String!, $openSearch: String!, $closedSearch: String!, $after: String) {
  repository(owner: $owner, name: $name) { labels(first: 100, orderBy: { field: NAME, direction: ASC }) { nodes { name color } } }
  open: search(query: $openSearch, type: ISSUE, first: 0) { issueCount }
  closed: search(query: $closedSearch, type: ISSUE, first: 0) { issueCount }
  search(query: $search, type: ISSUE, first: ${pageSize}, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on Issue { ${issueFields}
      parent { number repository { nameWithOwner } }
      subIssuesSummary { total completed }
      subIssues(first: 50) { nodes { ${issueFields} } } } }
  }
}`;

const relatedLimit = 50;
const issueReferenceSchema = z.object({ number: z.number(), title: z.string(), url: z.string(), ...issueStateFields });
const loginSchema = z.object({ login: z.string() }).nullable();
const issueDetailSchema = z.object({ repository: z.object({ url: z.string(), issue: z.object({
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
    commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({
      state: z.enum(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED']) }).nullable() }) })) }),
  })) }),
}) }) });
const issueReferenceFields = 'number title state stateReason url';
// The first 100 comments are listed; `totalCount` counts them all.
const issueDetailQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { url issue(number: $number) {
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
const checks = { SUCCESS: 'passed', FAILURE: 'failed', ERROR: 'failed', PENDING: 'pending', EXPECTED: 'pending' } as const;
const pullRequestStates = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' } as const;
const issueReference = (issue: z.infer<typeof issueReferenceSchema>) => ({ number: issue.number, title: issue.title, ...issueState(issue), url: issue.url });

/** GitHub repository paths are case-insensitive. */
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An issue's own fields, and the open issues blocking it; a blocker in another repository names it. */
function issueSummary(issue: z.infer<typeof issueSchema>, path: string): IssueSummary {
  const blockedBy = issue.blockedBy.nodes.filter(blocker => blocker.state === 'OPEN').map(blocker =>
    ({ path: samePath(blocker.repository.nameWithOwner, path) ? null : blocker.repository.nameWithOwner, number: blocker.number, title: blocker.title }));
  return { number: issue.number, title: issue.title, ...issueState(issue), createdAt: issue.createdAt, labels: issue.labels.nodes,
    blockedBy, unlistedBlockers: Math.max(0, issue.issueDependenciesSummary.blockedBy - blockedBy.length) };
}

/** GitHub search text for the filter. A number (with or without #) matches the issue number; other words match the title. */
function issueSearch(path: string, { search, state, labels }: IssueListFilter) {
  const quote = (text: string) => `"${text.replace(/"/g, '')}"`;
  const term = search.trim();
  const words = /^#?\d+$/.test(term) ? [term.replace('#', '')] : term ? [...term.split(/\s+/).map(quote), 'in:title'] : [];
  return [`repo:${path}`, 'is:issue', `is:${state}`, 'sort:created-desc', ...labels.map(label => `label:${quote(label)}`), ...words].join(' ');
}

const outputLines = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean);

export const github: Forge = {
  id: 'github',
  presentation: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' },
  capabilities: { subIssues: true, blocking: true },
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
  async issues(path, { filter, cursor }) {
    const [owner, name] = path.split('/');
    const data = await graphql(issuePageQuery, { owner, name, search: issueSearch(path, filter),
      openSearch: issueSearch(path, { ...filter, state: 'open' }), closedSearch: issueSearch(path, { ...filter, state: 'closed' }), ...cursor === null ? {} : { after: cursor } }, issuePageSchema);
    return {
      issues: data.search.nodes.map(issue => ({ ...issueSummary(issue, path),
        parent: issue.parent && samePath(issue.parent.repository.nameWithOwner, path) ? issue.parent.number : null,
        subIssues: { closed: issue.subIssuesSummary.completed, total: issue.subIssuesSummary.total,
          issues: issue.subIssues.nodes.filter(child => samePath(child.repository.nameWithOwner, path)).map(child => issueSummary(child, path)) } })),
      cursor: data.search.pageInfo.hasNextPage ? data.search.pageInfo.endCursor : null,
      labels: data.repository.labels.nodes,
      counts: { open: data.open.issueCount, closed: data.closed.issueCount },
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
      closingPullRequests: issue.closedByPullRequestsReferences.nodes.map(pull => {
        const rollup = pull.commits.nodes[0]?.commit.statusCheckRollup;
        return { number: pull.number, title: pull.title, url: pull.url,
          state: pull.state === 'OPEN' && pull.isDraft ? 'draft' as const : pullRequestStates[pull.state],
          checks: rollup ? checks[rollup.state] : 'none' as const };
      }),
      issueLinks: `${repository.url}/issues/`,
    };
  },
};
