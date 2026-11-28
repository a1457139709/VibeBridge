function issueDetail(state, path, number, answering, query) {
  const window = connection => Number(new RegExp(`${connection}\\((?:first|last): (\\d+)`).exec(query)?.[1]);
  const issues = state.issues ?? [],
    pulls = state.pullRequests ?? [];
  const url = `https://github.com/${path}`;
  const issue = issues.find(item => item.number === number);
  if (!issue) {
    const message = `Could not resolve to an Issue with the number of ${number}.`;
    process.stdout.write(
      JSON.stringify({
        data: { repository: { ...answering, url, issue: null } },
        errors: [{ type: 'NOT_FOUND', path: ['repository', 'issue'], message }],
      }),
    );
    process.stderr.write(`GraphQL: ${message} (repository.issue)\n`);
    process.exit(1);
  }
  const reference = item => ({
    number: item.number,
    title: item.title,
    state: item.state,
    stateReason: item.stateReason ?? null,
    url: `${url}/issues/${item.number}`,
  });
  const byNumber = numbers => (numbers ?? []).map(n => issues.find(item => item.number === n)).filter(Boolean);
  const blocker = entry =>
    typeof entry === 'number'
      ? reference(byNumber([entry])[0])
      : {
          number: entry.number,
          title: entry.title,
          state: entry.state,
          stateReason: null,
          url: `https://github.com/${entry.path}/issues/${entry.number}`,
        };
  const relatedBlocker = entry =>
    typeof entry === 'number'
      ? { ...owned(byNumber([entry])[0]), repository: { nameWithOwner: path } }
      : { ...owned(entry), repository: { nameWithOwner: entry.path } };
  const owned = item => ({ number: item.number, title: item.title, state: item.state });
  const subIssue = item => {
    const blockers = (item.blockedBy ?? []).map(relatedBlocker);
    return {
      ...reference(item),
      repository: { nameWithOwner: path },
      blockedBy: { nodes: blockers.slice(0, window('blockedBy')) },
      issueDependenciesSummary: { totalBlockedBy: blockers.length },
    };
  };
  const pull = n => {
    const item = pulls.find(candidate => candidate.number === n);
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      isDraft: !!item.isDraft,
      url: `${url}/pull/${item.number}`,
      commits: { nodes: [{ commit: { statusCheckRollup: item.checks ? { state: item.checks } : null } }] },
    };
  };
  const subIssuesOf = n => ({
    nodes: issues
      .filter(item => item.parent === n)
      .reverse()
      .slice(0, window('subIssues'))
      .map(subIssue),
  });
  const subIssuesSummary = n => {
    const children = issues.filter(item => item.parent === n);
    return { total: children.length, completed: children.filter(item => item.state === 'CLOSED').length };
  };
  const comments = issue.comments ?? [];
  process.stdout.write(
    JSON.stringify({
      data: {
        repository: {
          ...answering,
          url,
          viewerPermission: state.permission ?? 'WRITE',
          issue: {
            number: issue.number,
            title: issue.title,
            state: issue.state,
            stateReason: issue.stateReason ?? null,
            createdAt: issue.createdAt,
            url: `${url}/issues/${issue.number}`,
            bodyHTML: issue.bodyHTML ?? '',
            author: issue.author === null ? null : { login: issue.author ?? state.account },
            assignees: { nodes: (issue.assignees ?? []).map(login => ({ login })) },
            labels: { nodes: issue.labels },
            comments: {
              totalCount: comments.length,
              nodes: comments.slice(-window('comments')).map(comment => ({
                author: comment.author === null ? null : { login: comment.author },
                createdAt: comment.createdAt,
                bodyHTML: comment.bodyHTML,
              })),
            },
            parent: issue.parent
              ? {
                  ...reference(byNumber([issue.parent])[0]),
                  subIssuesSummary: subIssuesSummary(issue.parent),
                  subIssues: subIssuesOf(issue.parent),
                }
              : null,
            subIssuesSummary: subIssuesSummary(issue.number),
            subIssues: subIssuesOf(issue.number),
            blockedBy: { nodes: (issue.blockedBy ?? []).map(blocker) },
            blocking: { nodes: issues.filter(item => item.blockedBy?.includes(issue.number)).map(reference) },
            closedByPullRequestsReferences: { nodes: (issue.closedBy ?? []).map(pull) },
          },
        },
      },
    }),
  );
}

function pullRequestDetail(state, path, number, answering, query) {
  const url = `https://github.com/${path}`;
  const pull = (state.pullRequests ?? []).find(item => item.number === number);
  if (!pull) {
    const message = `Could not resolve to a PullRequest with the number of ${number}.`;
    process.stdout.write(
      JSON.stringify({
        data: { repository: { ...answering, url, pullRequest: null } },
        errors: [{ type: 'NOT_FOUND', path: ['repository', 'pullRequest'], message }],
      }),
    );
    process.stderr.write(`GraphQL: ${message} (repository.pullRequest)\n`);
    process.exit(1);
  }
  const issue = n => {
    const item = (state.issues ?? []).find(candidate => candidate.number === n);
    return {
      number: item.number,
      title: item.title,
      state: item.state,
      stateReason: item.stateReason ?? null,
      url: `${url}/issues/${item.number}`,
    };
  };
  const allowed = { merge: true, squash: true, rebase: true, ...state.mergeMethods };
  const latest = (items, connection) =>
    items.slice(-Number(new RegExp(`${connection}\\(last: (\\d+)\\)`).exec(query)?.[1]));
  const checkWindow = Number(/contexts\(first: (\d+)\)/.exec(query)?.[1]);
  const checks = pull.checkRuns ?? [];
  const contexts = checks.map((check, index) =>
    check.context === undefined
      ? {
          __typename: 'CheckRun',
          name: check.name,
          status: check.status,
          conclusion: check.conclusion,
          title: check.title ?? null,
          startedAt: check.startedAt ?? null,
          completedAt: check.completedAt ?? null,
          permalink: `${url}/runs/${index}`,
          isRequired: !!check.required,
          checkSuite: { workflowRun: check.workflow ? { workflow: { name: check.workflow } } : null },
        }
      : {
          __typename: 'StatusContext',
          context: check.context,
          state: check.state,
          description: check.description ?? null,
          targetUrl: check.targetUrl,
          isRequired: !!check.required,
        },
  );
  const countsBy = (items, stateOf) =>
    [...items.reduce((counts, item) => counts.set(stateOf(item), (counts.get(stateOf(item)) ?? 0) + 1), new Map())].map(
      ([state, count]) => ({ state, count }),
    );
  const runs = contexts.filter(context => context.__typename === 'CheckRun');
  const statuses = contexts.filter(context => context.__typename === 'StatusContext');
  const rollup =
    contexts.length || pull.checks
      ? {
          state: pull.checks ?? 'SUCCESS',
          contexts: {
            totalCount: contexts.length,
            checkRunCountsByState: countsBy(runs, run => (run.status === 'COMPLETED' ? run.conclusion : run.status)),
            statusContextCountsByState: countsBy(statuses, status => status.state),
            nodes: contexts.slice(0, checkWindow),
          },
        }
      : null;
  process.stdout.write(
    JSON.stringify({
      data: {
        repository: {
          ...answering,
          url,
          viewerPermission: state.permission ?? 'WRITE',
          mergeCommitAllowed: allowed.merge,
          squashMergeAllowed: allowed.squash,
          rebaseMergeAllowed: allowed.rebase,
          viewerDefaultMergeMethod: state.defaultMergeMethod ?? 'MERGE',
          pullRequest: {
            number: pull.number,
            title: pull.title,
            state: pull.state,
            isDraft: pull.isDraft ?? false,
            createdAt: pull.createdAt ?? '2026-01-01T00:00:00Z',
            url: `${url}/pull/${pull.number}`,
            bodyHTML: pull.bodyHTML ?? '',
            author: pull.author === null ? null : { login: pull.author ?? state.account },
            headRefName: pull.head ?? 'feature',
            baseRefName: pull.base ?? 'main',
            labels: { nodes: pull.labels ?? [] },
            closingIssuesReferences: { nodes: (pull.closes ?? []).map(issue) },
            comments: {
              totalCount: (pull.comments ?? []).length,
              nodes: latest(pull.comments ?? [], 'comments').map(comment => ({
                author: comment.author === null ? null : { login: comment.author },
                createdAt: comment.createdAt,
                bodyHTML: comment.bodyHTML,
              })),
            },
            reviews: {
              totalCount: (pull.reviews ?? []).length,
              nodes: latest(pull.reviews ?? [], 'reviews').map(review => ({
                author: review.author === null ? null : { login: review.author },
                state: review.state,
                createdAt: review.createdAt ?? review.submittedAt,
                submittedAt: review.submittedAt,
                bodyHTML: review.bodyHTML,
              })),
            },
            reviewDecision: pull.reviewDecision ?? null,
            mergeStateStatus: pull.mergeStateStatus ?? 'CLEAN',
            isMergeQueueEnabled: !!pull.mergeQueue,
            checksUrl: `${url}/pull/${pull.number}/checks`,
            commits: { nodes: [{ commit: { statusCheckRollup: rollup } }] },
          },
        },
      },
    }),
  );
}

module.exports = { issueDetail, pullRequestDetail };
