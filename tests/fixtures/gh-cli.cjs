const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { issueDetail, pullRequestDetail } = require('./gh-cli-details.cjs');

// A `gh` CLI double. The test writes the account's state to the JSON file named by VIBEBRIDGE_GH_DOUBLE:
// { account, repositories: ["owner/repo" | { id, path }, …], redirects?: { "former/path": "owner/repo" }, labels?: [{ name, color }],
//   issues?: [{ number, title, state, stateReason?, createdAt, labels,
//   author?, assignees?, bodyHTML?, comments?, parent?, blockedBy?, closedBy? }],
//   pullRequests?: [{ number, title, state: OPEN|MERGED|CLOSED, isDraft?, createdAt?, author?: login|null, labels?, checks?: rollup state }],
//   permission?, failure?: { code, stdout?, stderr? } } (tests/support/gh-double.ts describes each field).
// A failure answers every command the way `gh` fails, with that exit code and output. `gh api graphql` answers
// like GitHub: a repository the account does not list is NOT_FOUND unless a redirect leads from its path to one it lists, the search reads the qualifiers it is given,
// listing pull requests for is:pr and issues otherwise, and `repository.issue` answers one issue with its relations, or NOT_FOUND.
// A query asking for `repository { databaseId nameWithOwner }` is told the ID and current path of the repository answering at the asked path.
// `gh issue close|reopen` and `gh pr merge|close|reopen` change the state file and answer with GitHub's text.
const state = JSON.parse(readFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, 'utf8'));
const args = process.argv.slice(2);
// Every command is logged, one JSON array of its arguments per line, for the test to count what was asked.
appendFileSync(`${process.env.VIBEBRIDGE_GH_DOUBLE}.calls`, `${JSON.stringify(args)}\n`);
/** The listed repositories with their IDs: one named by its path alone has an ID that follows from the path. */
const repositories = state.repositories.map(entry =>
  typeof entry === 'string'
    ? {
        id: [...entry.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1_000_000_007, 7),
        path: entry,
      }
    : entry,
);
/** The listed repository at `path`, or the one a redirect leads to from it, or undefined. */
function repositoryAt(path) {
  const same = other => other.toLowerCase() === path.toLowerCase();
  const target = Object.entries(state.redirects ?? {}).find(([from]) => same(from))?.[1];
  return (
    repositories.find(item => same(item.path)) ??
    (target && repositories.find(item => item.path.toLowerCase() === target.toLowerCase()))
  );
}
if (state.failure) {
  process.stdout.write(state.failure.stdout ?? '');
  process.stderr.write(state.failure.stderr ?? '');
  process.exit(state.failure.code);
}
if (args[0] === 'api' && args[1] === 'graphql') graphql(fields(args.slice(2)));
else if (args[0] === 'issue' || args[0] === 'pr') write(args[0], args[1], Number(args[2]), args.slice(3));
else if (args[0] === 'api' && args.includes('user')) process.stdout.write(`${state.account}\n`);
else if (args[0] === 'api' && args.some(arg => arg.startsWith('user/repos')))
  process.stdout.write(repositories.map(({ id, path }) => `${id} ${path}\n`).join(''));
else if (args[0] === 'api' && /^repositories\/\d+$/.test(args[1])) byId(Number(args[1].split('/')[1]));
else {
  process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`);
  process.exit(1);
}

function fields(list) {
  const values = {};
  for (let index = 0; index < list.length; index += 2) {
    if (list[index] !== '-f' && list[index] !== '-F') unsupported();
    const [key, ...value] = list[index + 1].split('=');
    values[key] = value.join('=');
  }
  return values;
}
/** A write subcommand as gh runs it against GitHub: it changes the item, prints how it went, and fails with GitHub's text. */
function write(noun, verb, number, options) {
  const fail = message => {
    process.stderr.write(`${message}\n`);
    process.exit(1);
  };
  const repoAt = options.indexOf('--repo');
  if (repoAt < 0) unsupported();
  const path = options[repoAt + 1];
  if (!repositoryAt(path)) fail(`GraphQL: Could not resolve to a Repository with the name '${path}'. (repository)`);
  const items = noun === 'issue' ? (state.issues ?? []) : (state.pullRequests ?? []);
  const item = items.find(candidate => candidate.number === number);
  if (!item)
    fail(
      `GraphQL: Could not resolve to an issue or pull request with the number of ${number}. (repository.issueOrPullRequest)`,
    );
  const mutation = {
    'issue close': 'closeIssue',
    'issue reopen': 'reopenIssue',
    'pr merge': 'mergePullRequest',
    'pr close': 'closePullRequest',
    'pr reopen': 'reopenPullRequest',
  }[`${noun} ${verb}`];
  if (!mutation) unsupported();
  if (['READ', 'TRIAGE'].includes(state.permission)) {
    fail(
      `GraphQL: ${state.account} does not have the correct permissions to execute \`${mutation[0].toUpperCase()}${mutation.slice(1)}\` (${mutation})`,
    );
  }
  const name = `${path}#${number} (${item.title})`;
  if (noun === 'issue' && verb === 'close') {
    const reason = options[options.indexOf('--reason') + 1];
    Object.assign(item, { state: 'CLOSED', stateReason: reason === 'not planned' ? 'NOT_PLANNED' : 'COMPLETED' });
    done(`✓ Closed issue ${name}`);
  } else if (noun === 'issue') {
    Object.assign(item, { state: 'OPEN', stateReason: 'REOPENED' });
    done(`✓ Reopened issue ${name}`);
  } else if (verb === 'merge') {
    const method = ['merge', 'squash', 'rebase'].find(flag => options.includes(`--${flag}`));
    if (!method) unsupported();
    if (item.state !== 'OPEN')
      fail(
        `X Pull request ${path}#${number} (${item.title}) can't be merged because it is ${item.state === 'MERGED' ? 'already merged' : 'closed'}`,
      );
    if (item.mergeable === 'CONFLICTING')
      fail(`X Pull request ${path}#${number} is not mergeable: the merge commit cannot be cleanly created.`);
    const methodName = { merge: 'Merge commits', squash: 'Squash merges', rebase: 'Rebase merges' }[method];
    if (state.mergeMethods?.[method] === false)
      fail(`GraphQL: ${methodName} are not allowed on this repository. (mergePullRequest)`);
    item.state = 'MERGED';
    done(
      `✓ ${{ merge: 'Merged', squash: 'Squashed and merged', rebase: 'Rebased and merged' }[method]} pull request ${name}`,
    );
  } else if (verb === 'close') {
    item.state = 'CLOSED';
    done(`✓ Closed pull request ${name}`);
  } else {
    if (item.state === 'MERGED') fail(`X Pull request ${name} can't be reopened because it was already merged`);
    item.state = 'OPEN';
    done(`✓ Reopened pull request ${name}`);
  }
}
/** Saves the changed state and reports success the way gh does, on standard error. */
function done(message) {
  writeFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, JSON.stringify(state));
  process.stderr.write(`${message}\n`);
}

/** `gh api repositories/{id} --jq .full_name`: the path of the listed repository with that ID, or GitHub's 404. */
function byId(id) {
  const found = repositories.find(item => item.id === id);
  if (found) return process.stdout.write(`${found.path}\n`);
  process.stderr.write(`gh: Not Found (HTTP 404)\nHTTP 404: Not Found (https://api.github.com/repositories/${id})\n`);
  process.exit(1);
}

function unsupported() {
  process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`);
  process.exit(1);
}

function graphql({ query, owner, name, search, openSearch, closedSearch, after, number }) {
  if (!query) unsupported();
  const asked = `${owner}/${name}`;
  const blockerWindow = Number(/blockedBy\(first: (\d+)\)/.exec(query)?.[1]);
  const repository = repositoryAt(asked);
  if (!repository) {
    const message = `Could not resolve to a Repository with the name '${asked}'.`;
    process.stdout.write(
      JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message }] }),
    );
    process.stderr.write(`GraphQL: ${message} (repository)\n`);
    process.exit(1);
  }
  const path = repository.path;
  // Every read names the repository answering at the asked path, by its ID and current path, when it asks for them.
  const answering = /databaseId nameWithOwner/.test(query) ? { databaseId: repository.id, nameWithOwner: path } : {};
  if (/issue\(number:/.test(query)) return issueDetail(state, path, Number(number), answering);
  if (/pullRequest\(number:/.test(query)) return pullRequestDetail(state, path, Number(number), answering);
  if (!/search\(/.test(query)) return process.stdout.write(JSON.stringify({ data: { repository: answering } }));
  const found = searchIssues(search);
  const offset = after ? Number(Buffer.from(after, 'base64').toString().replace('cursor:', '')) : 0;
  const page = found.slice(offset, offset + 25);
  const end = offset + page.length;
  process.stdout.write(
    JSON.stringify({
      data: {
        repository: { ...answering, labels: { nodes: state.labels ?? [] } },
        open: { issueCount: searchIssues(openSearch).length },
        closed: { issueCount: searchIssues(closedSearch).length },
        search: {
          pageInfo: {
            hasNextPage: end < found.length,
            endCursor: page.length ? Buffer.from(`cursor:${end}`).toString('base64') : null,
          },
          nodes: page.map(issue => {
            if (isPullRequestSearch(search)) return pullRequestNode(issue);
            const children = (state.issues ?? [])
              .filter(child => child.parent === issue.number)
              .sort((a, b) => a.number - b.number);
            return {
              ...node(issue, path, blockerWindow),
              parent: issue.parent === undefined ? null : { number: issue.parent, repository: { nameWithOwner: path } },
              subIssuesSummary: {
                total: children.length,
                completed: children.filter(child => child.state === 'CLOSED').length,
              },
              subIssues: { nodes: children.map(child => node(child, path, blockerWindow)) },
            };
          }),
        },
      },
    }),
  );
}

/** A pull request's fields as GitHub's GraphQL API names them. */
function pullRequestNode(pull) {
  return {
    number: pull.number,
    title: pull.title,
    state: pull.state,
    isDraft: pull.isDraft ?? false,
    createdAt: pull.createdAt,
    author: pull.author === null ? null : { login: pull.author ?? state.account },
    labels: { nodes: pull.labels },
    commits: { nodes: [{ commit: { statusCheckRollup: pull.checks ? { state: pull.checks } : null } }] },
  };
}

function isPullRequestSearch(search) {
  return /(^|\s)is:pr(\s|$)/.test(search);
}

/** An issue's own fields and its blockers, as GitHub's GraphQL API names them. */
function node(issue, path, blockerWindow) {
  const own = other => ({ number: other.number, title: other.title, state: other.state });
  const blocker = entry =>
    typeof entry === 'number'
      ? { ...own((state.issues ?? []).find(other => other.number === entry)), repository: { nameWithOwner: path } }
      : { ...own(entry), repository: { nameWithOwner: entry.path } };
  const blockers = (issue.blockedBy ?? []).map(blocker);
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    stateReason: issue.stateReason ?? null,
    createdAt: issue.createdAt,
    labels: { nodes: issue.labels },
    repository: { nameWithOwner: path },
    // Like GitHub, the listed blockers stop at the query's window, open and closed alike; the summary counts every open one.
    blockedBy: { nodes: blockers.slice(0, blockerWindow) },
    issueDependenciesSummary: { blockedBy: blockers.filter(other => other.state === 'OPEN').length },
  };
}

/** The issues, or for is:pr the pull requests, a GitHub search finds, newest first. Qualifiers: repo:, is:issue|pr,
 * is:open|closed (closed includes merged), label:"…", sort:created-desc, in:title; other words are terms, and a number
 * term without in:title matches the number. */
function searchIssues(search) {
  const tokens = search.match(/(?:[\w-]+:)?"[^"]*"|\S+/g) ?? [];
  const unquote = text => text.replace(/^"|"$/g, '');
  let open = null,
    inTitle = false;
  const labels = [],
    terms = [];
  for (const token of tokens) {
    const qualifier = token.match(/^([\w-]+):(.*)$/);
    if (qualifier?.[1] === 'is' && qualifier[2] === 'open') open = true;
    else if (qualifier?.[1] === 'is' && qualifier[2] === 'closed') open = false;
    else if (qualifier?.[1] === 'label') labels.push(unquote(qualifier[2]));
    else if (qualifier?.[1] === 'in' && qualifier[2] === 'title') inTitle = true;
    else if (!qualifier || token.startsWith('"')) terms.push(unquote(token).toLowerCase());
  }
  const matches = issue =>
    (open === null || (issue.state === 'OPEN') === open) &&
    labels.every(label => issue.labels.some(item => item.name === label)) &&
    terms.every(term =>
      /^#?\d+$/.test(term) && !inTitle
        ? issue.number === Number(term.replace('#', ''))
        : issue.title.toLowerCase().includes(term),
    );
  const items = isPullRequestSearch(search)
    ? (state.pullRequests ?? []).map(pull => ({ createdAt: '2026-01-01T00:00:00Z', labels: [], ...pull }))
    : (state.issues ?? []);
  return items.filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
