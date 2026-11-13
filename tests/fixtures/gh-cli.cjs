const { readFileSync } = require('node:fs');

// A `gh` CLI double. The test writes the account's state to the JSON file named by VIBEBRIDGE_GH_DOUBLE:
// { account, repositories: ["owner/repo", …], labels?: [{ name, color }],
//   issues?: [{ number, title, state, stateReason?, createdAt, labels, parent?: number, blockedBy?: [number | { path, number, title, state }] }],
//   failure?: { code, stdout?, stderr? } }.
// A failure answers every command the way `gh` fails, with that exit code and output. `gh api graphql` answers
// like GitHub: a repository the account does not list is NOT_FOUND, and the issue search reads the qualifiers it is given.
const state = JSON.parse(readFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, 'utf8'));
const args = process.argv.slice(2);
if (state.failure) {
  process.stdout.write(state.failure.stdout ?? '');
  process.stderr.write(state.failure.stderr ?? '');
  process.exit(state.failure.code);
}
if (args[0] === 'api' && args[1] === 'graphql') graphql(fields(args.slice(2)));
else if (args[0] === 'api' && args.includes('user')) process.stdout.write(`${state.account}\n`);
else if (args[0] === 'api' && args.some(arg => arg.startsWith('user/repos'))) process.stdout.write(state.repositories.map(path => `${path}\n`).join(''));
else { process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`); process.exit(1); }

function fields(list) {
  const values = {};
  for (let index = 0; index < list.length; index += 2) {
    if (list[index] !== '-f' && list[index] !== '-F') unsupported();
    const [key, ...value] = list[index + 1].split('=');
    values[key] = value.join('=');
  }
  return values;
}
function unsupported() { process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`); process.exit(1); }

function graphql({ query, owner, name, search, openSearch, closedSearch, after }) {
  if (!query || !/search\(/.test(query)) unsupported();
  const path = `${owner}/${name}`;
  const blockerWindow = Number(/blockedBy\(first: (\d+)\)/.exec(query)?.[1]);
  if (!state.repositories.some(listed => listed.toLowerCase() === path.toLowerCase())) {
    const message = `Could not resolve to a Repository with the name '${path}'.`;
    process.stdout.write(JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message }] }));
    process.stderr.write(`GraphQL: ${message} (repository)\n`);
    process.exit(1);
  }
  const found = searchIssues(search);
  const offset = after ? Number(Buffer.from(after, 'base64').toString().replace('cursor:', '')) : 0;
  const page = found.slice(offset, offset + 25);
  const end = offset + page.length;
  process.stdout.write(JSON.stringify({ data: {
    repository: { labels: { nodes: state.labels ?? [] } },
    open: { issueCount: searchIssues(openSearch).length }, closed: { issueCount: searchIssues(closedSearch).length },
    search: { pageInfo: { hasNextPage: end < found.length, endCursor: page.length ? Buffer.from(`cursor:${end}`).toString('base64') : null },
      nodes: page.map(issue => {
        const children = (state.issues ?? []).filter(child => child.parent === issue.number).sort((a, b) => a.number - b.number);
        return { ...node(issue, path, blockerWindow),
          parent: issue.parent === undefined ? null : { number: issue.parent, repository: { nameWithOwner: path } },
          subIssuesSummary: { total: children.length, completed: children.filter(child => child.state === 'CLOSED').length },
          subIssues: { nodes: children.map(child => node(child, path, blockerWindow)) } };
      }) },
  } }));
}

/** An issue's own fields and its blockers, as GitHub's GraphQL API names them. */
function node(issue, path, blockerWindow) {
  const own = other => ({ number: other.number, title: other.title, state: other.state });
  const blocker = entry => typeof entry === 'number'
    ? { ...own((state.issues ?? []).find(other => other.number === entry)), repository: { nameWithOwner: path } }
    : { ...own(entry), repository: { nameWithOwner: entry.path } };
  const blockers = (issue.blockedBy ?? []).map(blocker);
  return { number: issue.number, title: issue.title, state: issue.state, stateReason: issue.stateReason ?? null, createdAt: issue.createdAt,
    labels: { nodes: issue.labels }, repository: { nameWithOwner: path },
    // Like GitHub, the listed blockers stop at the query's window, open and closed alike; the summary counts every open one.
    blockedBy: { nodes: blockers.slice(0, blockerWindow) }, issueDependenciesSummary: { blockedBy: blockers.filter(other => other.state === 'OPEN').length } };
}

/** The issues a GitHub search finds, newest first. Qualifiers: repo:, is:issue, is:open|closed, label:"…",
 * sort:created-desc, in:title; other words are terms, and a number term without in:title matches the issue number. */
function searchIssues(search) {
  const tokens = search.match(/(?:[\w-]+:)?"[^"]*"|\S+/g) ?? [];
  const unquote = text => text.replace(/^"|"$/g, '');
  let open = null, inTitle = false;
  const labels = [], terms = [];
  for (const token of tokens) {
    const qualifier = token.match(/^([\w-]+):(.*)$/);
    if (qualifier?.[1] === 'is' && qualifier[2] === 'open') open = true;
    else if (qualifier?.[1] === 'is' && qualifier[2] === 'closed') open = false;
    else if (qualifier?.[1] === 'label') labels.push(unquote(qualifier[2]));
    else if (qualifier?.[1] === 'in' && qualifier[2] === 'title') inTitle = true;
    else if (!qualifier || token.startsWith('"')) terms.push(unquote(token).toLowerCase());
  }
  const matches = issue => (open === null || (issue.state === 'OPEN') === open)
    && labels.every(label => issue.labels.some(item => item.name === label))
    && terms.every(term => /^#?\d+$/.test(term) && !inTitle ? issue.number === Number(term.replace('#', '')) : issue.title.toLowerCase().includes(term));
  return (state.issues ?? []).filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
