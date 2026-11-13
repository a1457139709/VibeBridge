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

/** Runs a GraphQL query and reads its data with `schema`; output gh did not fail on but that does not fit is a transient failure. */
async function graphql<T>(query: string, variables: Record<string, string>, schema: z.ZodType<T>): Promise<T> {
  const output = await gh(['api', 'graphql', '-f', `query=${query}`, ...Object.entries(variables).flatMap(([key, value]) => ['-f', `${key}=${value}`])]);
  let json: unknown;
  try { json = JSON.parse(output); } catch { throw new ForgeError('transient', output.trim()); }
  const parsed = z.object({ data: schema }).safeParse(json);
  if (!parsed.success) throw new ForgeError('transient', output.trim());
  return parsed.data.data;
}

const pageSize = 25;
const labelSchema = z.object({ name: z.string(), color: z.string() });
const issueState = z.enum(['OPEN', 'CLOSED']);
const repositorySchema = z.object({ nameWithOwner: z.string() });
const issueSchema = z.object({
  number: z.number(), title: z.string(), state: issueState,
  stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).nullable(), createdAt: z.string(),
  labels: z.object({ nodes: z.array(labelSchema) }),
  repository: repositorySchema,
  blockedBy: z.object({ nodes: z.array(z.object({ number: z.number(), title: z.string(), state: issueState, repository: repositorySchema })) }),
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
const issueFields = `number title state stateReason createdAt labels(first: 20) { nodes { name color } } repository { nameWithOwner }
      blockedBy(first: 20) { nodes { number title state repository { nameWithOwner } } }`;
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
const closedAs = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate', REOPENED: null } as const;

/** GitHub repository paths are case-insensitive. */
const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An issue's own fields, and the open issues blocking it; a blocker in another repository names it. */
function issueSummary(issue: z.infer<typeof issueSchema>, path: string): IssueSummary {
  return { number: issue.number, title: issue.title, state: issue.state === 'OPEN' ? 'open' : 'closed',
    closedAs: issue.state === 'OPEN' || !issue.stateReason ? null : closedAs[issue.stateReason], createdAt: issue.createdAt, labels: issue.labels.nodes,
    blockedBy: issue.blockedBy.nodes.filter(blocker => blocker.state === 'OPEN').map(blocker =>
      ({ path: samePath(blocker.repository.nameWithOwner, path) ? null : blocker.repository.nameWithOwner, number: blocker.number, title: blocker.title })) };
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
  presentation: { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login',
    capabilities: { subIssues: true, blocking: true } },
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
};
