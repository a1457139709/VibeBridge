const { readFileSync } = require('node:fs');

// External CLI double for GitHub's `gh`: answers `gh api graphql` from a state file the test
// writes, for the viewer, the viewer's repositories, issue and pull request search, and an
// issue or pull request by number, which fills only the fragment of its own type.
// A state `failure` makes every call end with the given exit code, stdout and stderr, as
// `gh` does when the API refuses. Repository pages hold at most `pageSize` repositories,
// whatever the query asks for, so a caller that reads only the first page sees an incomplete
// list. A repository outside `repositories` is not found, as for an account that cannot see it.
module.exports = function gh(stateFile, args) {
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  if (state.failure) {
    process.stdout.write(state.failure.stdout ?? '');
    process.stderr.write(state.failure.stderr ?? '');
    process.exit(state.failure.exit);
  }
  const fields = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '-f' || args[index] === '-F') {
      const [key, ...value] = args[++index].split('=');
      fields[key] = value.join('=');
    }
  }
  const query = fields.query ?? '';
  if (args[0] !== 'api' || args[1] !== 'graphql' || !query) unsupported(args);
  if (query.includes('search(')) return answer(search(state, fields));
  if (query.includes('issueOrPullRequest(')) return answer(issueByNumber(state, fields));
  if (!query.includes('viewer')) unsupported(args);
  const viewer = { login: state.login };
  if (query.includes('repositories')) {
    const size = state.pageSize ?? 2;
    const start = fields.cursor ? Number(fields.cursor) : 0;
    const page = state.repositories.slice(start, start + size);
    const end = start + page.length;
    viewer.repositories = {
      nodes: page.map(path => ({ nameWithOwner: path, url: `https://github.com/${path}` })),
      pageInfo: { hasNextPage: end < state.repositories.length, endCursor: String(end) },
    };
  }
  answer({ viewer });
};

function unsupported(args) {
  process.stderr.write(`gh double: unsupported call ${JSON.stringify(args)}\n`);
  process.exit(1);
}

function answer(data) { process.stdout.write(JSON.stringify({ data })); }

function notFound(type, message, data) {
  process.stdout.write(JSON.stringify({ data, errors: [{ type: 'NOT_FOUND', path: [type], message }] }));
  process.stderr.write(`gh: ${message}\n`);
  process.exit(1);
}

function repository(state, owner, name) {
  const path = `${owner}/${name}`;
  if (!(state.repositories ?? []).includes(path)) notFound('repository', `Could not resolve to a Repository with the name '${path}'.`, { repository: null });
  return path;
}

function labelNodes(state, names) {
  const color = name => (state.labels ?? []).find(label => label.name === name)?.color ?? 'ededed';
  return { nodes: names.map(name => ({ name, color: color(name) })) };
}

// Relations come from each issue's `parent` and `blockedBy` numbers. Sub-issues are listed one
// level deep, in the order the state holds them, as the Workbench's query asks.
function issueNode(state, path, issue, depth = 0) {
  const all = state.issues ?? [];
  const byNumber = number => all.find(item => item.number === number);
  const children = all.filter(item => item.parent === issue.number);
  const node = { number: issue.number, title: issue.title, state: issue.state, stateReason: issue.stateReason, createdAt: issue.createdAt,
    url: `https://github.com/${path}/issues/${issue.number}`, labels: labelNodes(state, issue.labels),
    parent: issue.parent ? { number: issue.parent } : null,
    blockedBy: { nodes: (issue.blockedBy ?? []).map(byNumber).map(item => ({ number: item.number, title: item.title, state: item.state })) } };
  if (depth > 0) return node;
  return { ...node, subIssuesSummary: { total: children.length, completed: children.filter(item => item.state === 'CLOSED').length },
    subIssues: { nodes: children.map(child => issueNode(state, path, child, depth + 1)) } };
}

function pullRequestNode(state, path, request) {
  return { number: request.number, title: request.title, state: request.state, isDraft: request.isDraft, createdAt: request.createdAt,
    url: `https://github.com/${path}/pull/${request.number}`, author: request.author === null ? null : { login: request.author },
    labels: labelNodes(state, request.labels),
    commits: { nodes: [{ commit: { statusCheckRollup: request.checks === null ? null : { state: request.checks } } }] } };
}

// GitHub search syntax, as far as the Workbench uses it: qualifiers, quoted values, and title words.
function terms(text) {
  const qualifiers = [];
  const words = [];
  for (const match of text.matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|(\S+)/g)) {
    if (match[1]) qualifiers.push([match[1], match[2]]);
    else if (match[3]) qualifiers.push([match[3], match[4]]);
    else words.push(match[5].toLowerCase());
  }
  return { qualifiers, words };
}

function search(state, fields) {
  const path = repository(state, fields.owner, fields.name);
  const { qualifiers, words } = terms(fields.q);
  const values = key => qualifiers.filter(([name]) => name === key).map(([, value]) => value);
  const type = values('is').find(value => value === 'issue' || value === 'pr');
  if (!values('repo').includes(path) || !type || !values('sort').includes('created-desc')) {
    process.stderr.write(`gh double: unsupported search ${fields.q}\n`);
    process.exit(1);
  }
  // As on GitHub, a merged pull request is closed.
  const wanted = values('is').find(value => value === 'open' || value === 'closed');
  const open = item => item.state === 'OPEN';
  const items = type === 'issue' ? state.issues ?? [] : state.pullRequests ?? [];
  const node = type === 'issue' ? issueNode : pullRequestNode;
  const matches = items
    .filter(item => !wanted || open(item) === (wanted === 'open'))
    .filter(item => values('label').every(label => item.labels.includes(label)))
    .filter(item => words.every(word => item.title.toLowerCase().includes(word)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const size = Number(fields.first);
  const start = fields.cursor ? Number(fields.cursor) : 0;
  const page = matches.slice(start, start + size);
  const end = start + page.length;
  return {
    repository: { labels: { nodes: state.labels ?? [] } },
    search: { nodes: page.map(item => node(state, path, item)), pageInfo: { hasNextPage: end < matches.length, endCursor: String(end) } },
  };
}

function issueByNumber(state, fields) {
  const path = repository(state, fields.owner, fields.name);
  const number = Number(fields.number);
  const issue = (state.issues ?? []).find(item => item.number === number);
  const request = (state.pullRequests ?? []).find(item => item.number === number);
  if (!issue && !request) notFound('repository', `Could not resolve to an issue or pull request with the number of ${fields.number}.`, { repository: { issueOrPullRequest: null } });
  const node = issue ? (fields.query.includes('... on Issue') ? issueNode(state, path, issue) : {})
    : fields.query.includes('... on PullRequest') ? pullRequestNode(state, path, request) : {};
  return { repository: { issueOrPullRequest: node } };
}
