// The `gh api graphql` answers for one issue or pull request, read from the gh double's state (see gh-cli.cjs).

/** One issue with its comments and relations, as GitHub's `repository.issue` answers; NOT_FOUND for a number with no issue. */
function issueDetail(state, path, number) {
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
    comments: { totalCount: comments.length, nodes: comments.map(comment => ({
      author: comment.author === null ? null : { login: comment.author }, createdAt: comment.createdAt, bodyHTML: comment.bodyHTML })) },
    parent: issue.parent ? { ...reference(byNumber([issue.parent])[0]), subIssuesSummary: subIssuesSummary(issue.parent) } : null,
    // GitHub lists sub-issues in the order they were added, not by number.
    subIssues: { nodes: issues.filter(item => item.parent === issue.number).reverse().map(reference) },
    blockedBy: { nodes: (issue.blockedBy ?? []).map(blocker) },
    blocking: { nodes: issues.filter(item => item.blockedBy?.includes(issue.number)).map(reference) },
    closedByPullRequestsReferences: { nodes: (issue.closedBy ?? []).map(pull) },
  } } } }));
}

/** One pull request with its timeline and merge requirements, as GitHub's `repository.pullRequest` answers; NOT_FOUND for a number with no pull request. */
function pullRequestDetail(state, path, number) {
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

module.exports = { issueDetail, pullRequestDetail };
