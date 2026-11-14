const { readFileSync, writeFileSync } = require('node:fs');

// A `gh` CLI double. The test writes the account's state to the JSON file named by VIBEBRIDGE_GH_DOUBLE:
// { account, repositories: ["owner/repo", …], labels?: [{ name, color }], issues?: [{ number, title, state, stateReason?, createdAt, labels,
//   author?, assignees?, bodyHTML?, comments?, parent?, blockedBy?, closedBy? }],
//   pullRequests?: [{ number, title, state: OPEN|MERGED|CLOSED, isDraft?, createdAt?, author?: login|null, labels?, checks?: rollup state }],
//   permission?, failure?: { code, stdout?, stderr? } } (tests/support/gh-double.ts describes each field).
// A failure answers every command the way `gh` fails, with that exit code and output. `gh api graphql` answers
// like GitHub: a repository the account does not list is NOT_FOUND, the search reads the qualifiers it is given,
// listing pull requests for is:pr and issues otherwise, and `repository.issue` answers one issue with its relations, or NOT_FOUND.
// `gh issue close|reopen` and `gh pr merge|close|reopen` change the state file and answer with GitHub's text.
const state = JSON.parse(readFileSync(process.env.VIBEBRIDGE_GH_DOUBLE, 'utf8'));
const args = process.argv.slice(2);
if (state.failure) {
  process.stdout.write(state.failure.stdout ?? '');
  process.stderr.write(state.failure.stderr ?? '');
  process.exit(state.failure.code);
}
if (args[0] === 'api' && args[1] === 'graphql') graphql(fields(args.slice(2)));
else if (args[0] === 'issue' || args[0] === 'pr') write(args[0], args[1], Number(args[2]), args.slice(3));
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
/** A write subcommand as gh runs it against GitHub: it changes the item, prints how it went, and fails with GitHub's text. */
function write(noun, verb, number, options) {
  const fail = message => { process.stderr.write(`${message}\n`); process.exit(1); };
  const repoAt = options.indexOf('--repo');
  if (repoAt < 0) unsupported();
  const path = options[repoAt + 1];
  if (!state.repositories.some(listed => listed.toLowerCase() === path.toLowerCase())) fail(`GraphQL: Could not resolve to a Repository with the name '${path}'. (repository)`);
  const items = noun === 'issue' ? state.issues ?? [] : state.pullRequests ?? [];
  const item = items.find(candidate => candidate.number === number);
  if (!item) fail(`GraphQL: Could not resolve to an issue or pull request with the number of ${number}. (repository.issueOrPullRequest)`);
  const mutation = { 'issue close': 'closeIssue', 'issue reopen': 'reopenIssue', 'pr merge': 'mergePullRequest', 'pr close': 'closePullRequest', 'pr reopen': 'reopenPullRequest' }[`${noun} ${verb}`];
  if (!mutation) unsupported();
  if (['READ', 'TRIAGE'].includes(state.permission)) fail(`GraphQL: ${state.account} does not have the correct permissions to execute \`${mutation[0].toUpperCase()}${mutation.slice(1)}\` (${mutation})`);
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
    if (item.state !== 'OPEN') fail(`X Pull request ${path}#${number} (${item.title}) can't be merged because it is ${item.state === 'MERGED' ? 'already merged' : 'closed'}`);
    if (item.mergeable === 'CONFLICTING') fail(`X Pull request ${path}#${number} is not mergeable: the merge commit cannot be cleanly created.`);
    if (state.mergeMethods?.[method] === false) fail(`GraphQL: ${{ merge: 'Merge commits', squash: 'Squash merges', rebase: 'Rebase merges' }[method]} are not allowed on this repository. (mergePullRequest)`);
    item.state = 'MERGED';
    done(`✓ ${{ merge: 'Merged', squash: 'Squashed and merged', rebase: 'Rebased and merged' }[method]} pull request ${name}`);
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

function unsupported() { process.stderr.write(`gh double: unsupported command ${args.join(' ')}\n`); process.exit(1); }

function graphql({ query, owner, name, search, openSearch, closedSearch, after, number }) {
  if (!query) unsupported();
  const path = `${owner}/${name}`;
  const blockerWindow = Number(/blockedBy\(first: (\d+)\)/.exec(query)?.[1]);
  if (!state.repositories.some(listed => listed.toLowerCase() === path.toLowerCase())) {
    const message = `Could not resolve to a Repository with the name '${path}'.`;
    process.stdout.write(JSON.stringify({ data: { repository: null }, errors: [{ type: 'NOT_FOUND', path: ['repository'], message }] }));
    process.stderr.write(`GraphQL: ${message} (repository)\n`);
    process.exit(1);
  }
  if (/issue\(number:/.test(query)) return issueDetail(path, Number(number));
  if (/pullRequest\(number:/.test(query)) return pullRequestDetail(path, Number(number));
  if (!/search\(/.test(query)) unsupported();
  const found = searchIssues(search);
  const offset = after ? Number(Buffer.from(after, 'base64').toString().replace('cursor:', '')) : 0;
  const page = found.slice(offset, offset + 25);
  const end = offset + page.length;
  process.stdout.write(JSON.stringify({ data: {
    repository: { labels: { nodes: state.labels ?? [] } },
    open: { issueCount: searchIssues(openSearch).length }, closed: { issueCount: searchIssues(closedSearch).length },
    search: { pageInfo: { hasNextPage: end < found.length, endCursor: page.length ? Buffer.from(`cursor:${end}`).toString('base64') : null },
      nodes: page.map(issue => {
        if (isPullRequestSearch(search)) return pullRequestNode(issue);
        const children = (state.issues ?? []).filter(child => child.parent === issue.number).sort((a, b) => a.number - b.number);
        return { ...node(issue, path, blockerWindow),
          parent: issue.parent === undefined ? null : { number: issue.parent, repository: { nameWithOwner: path } },
          subIssuesSummary: { total: children.length, completed: children.filter(child => child.state === 'CLOSED').length },
          subIssues: { nodes: children.map(child => node(child, path, blockerWindow)) } };
      }) },
  } }));
}

/** One issue with its comments and relations, as GitHub's `repository.issue` answers; NOT_FOUND for a number with no issue. */
function issueDetail(path, number) {
  const issues = state.issues ?? [], pulls = state.pullRequests ?? [];
  const url = `https://github.com/${path}`;
  const issue = issues.find(item => item.number === number);
  if (!issue) {
    const message = `Could not resolve to an Issue with the number of ${number}.`;
    process.stdout.write(JSON.stringify({ data: { repository: { url, issue: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'issue'], message }] }));
    process.stderr.write(`GraphQL: ${message} (repository.issue)\n`);
    process.exit(1);
  }
  const reference = item => ({ number: item.number, title: item.title, state: item.state, stateReason: item.stateReason ?? null, url: `${url}/issues/${item.number}` });
  const byNumber = numbers => (numbers ?? []).map(n => issues.find(item => item.number === n)).filter(Boolean);
  // A blocker in another repository is named in full; one in this repository by its number.
  const blocker = entry => typeof entry === 'number' ? reference(byNumber([entry])[0])
    : { number: entry.number, title: entry.title, state: entry.state, stateReason: null, url: `https://github.com/${entry.path}/issues/${entry.number}` };
  const pull = n => {
    const item = pulls.find(candidate => candidate.number === n);
    return { number: item.number, title: item.title, state: item.state, isDraft: !!item.isDraft, url: `${url}/pull/${item.number}`,
      commits: { nodes: [{ commit: { statusCheckRollup: item.checks ? { state: item.checks } : null } }] } };
  };
  const subIssuesSummary = n => { const children = issues.filter(item => item.parent === n);
    return { total: children.length, completed: children.filter(item => item.state === 'CLOSED').length }; };
  const comments = issue.comments ?? [];
  process.stdout.write(JSON.stringify({ data: { repository: { url, viewerPermission: state.permission ?? 'WRITE', issue: {
    number: issue.number, title: issue.title, state: issue.state, stateReason: issue.stateReason ?? null, createdAt: issue.createdAt,
    url: `${url}/issues/${issue.number}`, bodyHTML: issue.bodyHTML ?? '',
    author: issue.author === null ? null : { login: issue.author ?? state.account },
    assignees: { nodes: (issue.assignees ?? []).map(login => ({ login })) },
    labels: { nodes: issue.labels },
    comments: { totalCount: comments.length, nodes: comments.map(comment => ({ author: comment.author === null ? null : { login: comment.author }, createdAt: comment.createdAt, bodyHTML: comment.bodyHTML })) },
    parent: issue.parent ? { ...reference(byNumber([issue.parent])[0]), subIssuesSummary: subIssuesSummary(issue.parent) } : null,
    // GitHub lists sub-issues in the order they were added, not by number.
    subIssues: { nodes: issues.filter(item => item.parent === issue.number).reverse().map(reference) },
    blockedBy: { nodes: (issue.blockedBy ?? []).map(blocker) },
    blocking: { nodes: issues.filter(item => item.blockedBy?.includes(issue.number)).map(reference) },
    closedByPullRequestsReferences: { nodes: (issue.closedBy ?? []).map(pull) },
  } } } }));
}

/** One pull request with its timeline and merge requirements, as GitHub's `repository.pullRequest` answers; NOT_FOUND for a number with no pull request. */
function pullRequestDetail(path, number) {
  const url = `https://github.com/${path}`;
  const pull = (state.pullRequests ?? []).find(item => item.number === number);
  if (!pull) {
    const message = `Could not resolve to a PullRequest with the number of ${number}.`;
    process.stdout.write(JSON.stringify({ data: { repository: { url, pullRequest: null } }, errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'], message }] }));
    process.stderr.write(`GraphQL: ${message} (repository.pullRequest)\n`);
    process.exit(1);
  }
  const issue = n => {
    const item = (state.issues ?? []).find(candidate => candidate.number === n);
    return { number: item.number, title: item.title, state: item.state, stateReason: item.stateReason ?? null, url: `${url}/issues/${item.number}` };
  };
  const allowed = { merge: true, squash: true, rebase: true, ...state.mergeMethods };
  // A check run's log is its GitHub page; a commit status links where it ran, if anywhere.
  const contexts = (pull.checkRuns ?? []).map((check, index) => check.context === undefined
    ? { __typename: 'CheckRun', name: check.name, status: check.status, conclusion: check.conclusion, permalink: `${url}/runs/${index}`, isRequired: !!check.required }
    : { __typename: 'StatusContext', context: check.context, state: check.state, targetUrl: check.targetUrl, isRequired: !!check.required });
  process.stdout.write(JSON.stringify({ data: { repository: { url, viewerPermission: state.permission ?? 'WRITE',
    mergeCommitAllowed: allowed.merge, squashMergeAllowed: allowed.squash, rebaseMergeAllowed: allowed.rebase, pullRequest: {
    number: pull.number, title: pull.title, state: pull.state, isDraft: pull.isDraft ?? false, createdAt: pull.createdAt ?? '2026-01-01T00:00:00Z',
    url: `${url}/pull/${pull.number}`, bodyHTML: pull.bodyHTML ?? '', author: pull.author === null ? null : { login: pull.author ?? state.account },
    headRefName: pull.head ?? 'feature', baseRefName: pull.base ?? 'main',
    labels: { nodes: pull.labels ?? [] },
    closingIssuesReferences: { nodes: (pull.closes ?? []).map(issue) },
    comments: { totalCount: (pull.comments ?? []).length, nodes: (pull.comments ?? []).map(comment =>
      ({ author: comment.author === null ? null : { login: comment.author }, createdAt: comment.createdAt, bodyHTML: comment.bodyHTML })) },
    reviews: { nodes: (pull.reviews ?? []).map(review => ({ author: review.author === null ? null : { login: review.author }, state: review.state,
      submittedAt: review.submittedAt, bodyHTML: review.bodyHTML, comments: { totalCount: review.codeComments ?? 0 } })) },
    reviewDecision: pull.reviewDecision ?? null,
    baseRef: { refUpdateRule: pull.requiredApprovals ? { requiredApprovingReviewCount: pull.requiredApprovals } : null },
    mergeable: pull.mergeable ?? 'MERGEABLE', isMergeQueueEnabled: !!pull.mergeQueue,
    commits: { nodes: [{ commit: { statusCheckRollup: contexts.length ? { contexts: { nodes: contexts } } : null } }] },
  } } } }));
}

/** A pull request's fields as GitHub's GraphQL API names them. */
function pullRequestNode(pull) {
  return { number: pull.number, title: pull.title, state: pull.state, isDraft: pull.isDraft ?? false, createdAt: pull.createdAt,
    author: pull.author === null ? null : { login: pull.author ?? state.account }, labels: { nodes: pull.labels },
    commits: { nodes: [{ commit: { statusCheckRollup: pull.checks ? { state: pull.checks } : null } }] } };
}

function isPullRequestSearch(search) { return /(^|\s)is:pr(\s|$)/.test(search); }

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

/** The issues, or for is:pr the pull requests, a GitHub search finds, newest first. Qualifiers: repo:, is:issue|pr,
 * is:open|closed (closed includes merged), label:"…", sort:created-desc, in:title; other words are terms, and a number
 * term without in:title matches the number. */
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
  const items = isPullRequestSearch(search) ? (state.pullRequests ?? []).map(pull => ({ createdAt: '2026-01-01T00:00:00Z', labels: [], ...pull })) : state.issues ?? [];
  return items.filter(matches).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
