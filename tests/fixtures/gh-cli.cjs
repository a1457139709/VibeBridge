const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const { issueDetail, pullRequestDetail } = require('./gh-cli-details.cjs');

const state = JSON.parse(readFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, 'utf8'));
const args = process.argv.slice(2);
const log = `${process.env.VIBEBRIDGE_GH_DOUBLE}.calls`;
appendFileSync(log, `${JSON.stringify(args)}\n`);
if (state.answerOnceAsked) awaitAsked(state.answerOnceAsked);
const repositories = state.repositories.map(entry =>
  typeof entry === 'string'
    ? {
        id: [...entry.toLowerCase()].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1_000_000_007, 7),
        path: entry,
      }
    : entry,
);
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
    if (item.mergeStateStatus === 'DIRTY')
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
function done(message) {
  writeFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, JSON.stringify(state));
  process.stderr.write(`${message}\n`);
}

function byId(id) {
  const found = repositories.find(item => item.id === id);
  if (found) return process.stdout.write(`${found.path}\n`);
  process.stderr.write(`gh: Not Found (HTTP 404)\nHTTP 404: Not Found (https://api.github.com/repositories/${id})\n`);
  process.exit(1);
}

function awaitAsked(count) {
  const asked = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).length;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let polls = 0; asked() < count; polls++) {
    if (polls === 500) {
      process.stderr.write(`gh double: only ${asked()} of ${count} commands were asked at once\n`);
      process.exit(1);
    }
    Atomics.wait(pause, 0, 0, 10);
  }
}

function unsupported() {
  process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`);
  process.exit(1);
}

function graphql({ query, owner, name, search, openSearch, closedSearch, after, number }) {
  if (!query) unsupported();
  const asked = `${owner}/${name}`;
  const blockerWindow = Number(/blockedBy\(first: (\d+)\)/.exec(query)?.[1]);
  const subIssueWindow = Number(/subIssues\(first: (\d+)\)/.exec(query)?.[1]);
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
  const answering = /databaseId nameWithOwner/.test(query) ? { databaseId: repository.id, nameWithOwner: path } : {};
  const byNumber = [...query.matchAll(/(n\d+): (issue|pullRequest)\(number: (\d+)\)/g)];
  if (byNumber.length) return itemsByNumber(byNumber, path, answering, blockerWindow, subIssueWindow);
  if (/issue\(number:/.test(query)) return issueDetail(state, path, Number(number), answering, query);
  if (/pullRequest\(number:/.test(query)) return pullRequestDetail(state, path, Number(number), answering, query);
  if (!/search\(/.test(query) && /labels\(first:/.test(query)) return labelPage(query, after, answering);
  if (!/search\(/.test(query)) return process.stdout.write(JSON.stringify({ data: { repository: answering } }));
  const found = searchIssues(search);
  const offset = after ? Number(Buffer.from(after, 'base64').toString().replace('cursor:', '')) : 0;
  const page = found.slice(offset, offset + 25);
  const end = offset + page.length;
  process.stdout.write(
    JSON.stringify({
      data: {
        repository: { ...answering, labels: labels(query, undefined) },
        open: { issueCount: searchIssues(openSearch).length },
        closed: { issueCount: searchIssues(closedSearch).length },
        search: {
          pageInfo: {
            hasNextPage: end < found.length,
            endCursor: page.length ? Buffer.from(`cursor:${end}`).toString('base64') : null,
          },
          nodes: page.map(issue =>
            isPullRequestSearch(search)
              ? pullRequestNode(issue)
              : listedIssueNode(issue, path, blockerWindow, subIssueWindow),
          ),
        },
      },
    }),
  );
}

function labels(query, after) {
  const all = state.labels ?? [];
  const window = Number(/labels\(first: (\d+)/.exec(query)?.[1]);
  const offset = after ? Number(Buffer.from(after, 'base64').toString().replace('label:', '')) : 0;
  const end = Math.min(all.length, offset + window);
  return {
    pageInfo: { hasNextPage: end < all.length, endCursor: Buffer.from(`label:${end}`).toString('base64') },
    nodes: all.slice(offset, end),
  };
}

function labelPage(query, after, answering) {
  const failure = state.labelPageFailure;
  if (failure) {
    process.stderr.write(failure.stderr ?? '');
    process.exit(failure.code);
  }
  process.stdout.write(JSON.stringify({ data: { repository: { ...answering, labels: labels(query, after) } } }));
}

function itemsByNumber(fields, path, answering, blockerWindow, subIssueWindow) {
  const repository = { ...answering };
  const errors = [];
  for (const [, field, kind, number] of fields) {
    const items = kind === 'issue' ? (state.issues ?? []) : (state.pullRequests ?? []);
    const item = items.find(candidate => candidate.number === Number(number));
    repository[field] = item
      ? kind === 'issue'
        ? listedIssueNode(item, path, blockerWindow, subIssueWindow)
        : pullRequestNode({ createdAt: '2026-01-01T00:00:00Z', labels: [], ...item })
      : null;
    if (!item)
      errors.push({
        type: 'NOT_FOUND',
        path: ['repository', field],
        message: `Could not resolve to ${kind === 'issue' ? 'an Issue' : 'a PullRequest'} with the number of ${number}.`,
      });
  }
  process.stdout.write(JSON.stringify(errors.length ? { data: { repository }, errors } : { data: { repository } }));
  if (errors.length) {
    process.stderr.write(errors.map(error => `GraphQL: ${error.message} (repository.${error.path[1]})\n`).join(''));
    process.exit(1);
  }
}

function listedIssueNode(issue, path, blockerWindow, subIssueWindow) {
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
    url: `https://github.com/${path}/issues/${issue.number}`,
    subIssues: { nodes: children.slice(0, subIssueWindow).map(child => node(child, path, blockerWindow)) },
  };
}

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
    blockedBy: { nodes: blockers.slice(0, blockerWindow) },
    issueDependenciesSummary: { blockedBy: blockers.filter(other => other.state === 'OPEN').length },
  };
}

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
