// PROTOTYPE — throwaway. Pulls a read-only snapshot of the bound repo's issues, PRs and labels with `gh`
// into prototype-github-sidebar.snapshot.json (git-ignored) so the sidebar variants show real data.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [owner, name] = (process.argv[2] ?? 'a1457139709/VibeBridge').split('/');
const gql = (query) => JSON.parse(execFileSync('gh', ['api', 'graphql', '--paginate', '--slurp', '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${query}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const pages = (result, key) => result.flatMap(page => page.data.repository[key].nodes);

const issues = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){issues(first:50,after:$endCursor,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{
  number title state stateReason createdAt updatedAt author{login} assignees(first:5){nodes{login}} labels(first:10){nodes{name}} 
  parent{number} blockedBy(first:20){nodes{number}} closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number}} body comments(last:30){nodes{author{login} body createdAt}}}}}}`), 'issues');
const pulls = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){pullRequests(first:50,after:$endCursor,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{
  number title state isDraft createdAt updatedAt author{login} headRefName baseRefName additions deletions reviewDecision mergeable labels(first:10){nodes{name}} reviewRequests(first:10){nodes{requestedReviewer{... on User{login} ... on Team{name}}}}
  body changedFiles comments(last:30){nodes{author{login} body createdAt}} reviews(last:10){nodes{author{login} state body submittedAt}}
  closingIssuesReferences(first:10){nodes{number}} commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:30){nodes{__typename ... on CheckRun{name status conclusion detailsUrl} ... on StatusContext{context state targetUrl}}}}}}}}}}}`), 'pullRequests');
const viewer = execFileSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).trim();
const labels = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){labels(first:100,after:$endCursor){pageInfo{hasNextPage endCursor}nodes{name color}}}}`), 'labels');

const comment = c => ({ author: c.author?.login, body: c.body, at: c.createdAt });

const snapshot = {
  repo: `${owner}/${name}`, viewer, fetchedAt: new Date().toISOString(), labels,
  issues: issues.map(i => ({
    number: i.number, title: i.title, state: i.state.toLowerCase(), reason: (i.stateReason ?? '').toLowerCase(), createdAt: i.createdAt, updatedAt: i.updatedAt,
    author: i.author?.login, assignees: i.assignees.nodes.map(a => a.login), labels: i.labels.nodes.map(l => l.name),
    parent: i.parent?.number ?? null, blockedBy: i.blockedBy.nodes.map(b => b.number), prs: i.closedByPullRequestsReferences.nodes.map(p => p.number), body: i.body ?? '', comments: i.comments.nodes.map(comment),
  })),
  pulls: pulls.map(p => ({
    number: p.number, title: p.title, state: p.isDraft && p.state === 'OPEN' ? 'draft' : p.state.toLowerCase(), createdAt: p.createdAt, updatedAt: p.updatedAt,
    author: p.author?.login, branch: p.headRefName, base: p.baseRefName, labels: p.labels.nodes.map(l => l.name),
    requested: p.reviewRequests.nodes.map(r => r.requestedReviewer?.login ?? r.requestedReviewer?.name).filter(Boolean), mergeable: p.mergeable.toLowerCase(), additions: p.additions, deletions: p.deletions, review: (p.reviewDecision ?? '').toLowerCase(),
    checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? 'none').toLowerCase(), closes: p.closingIssuesReferences.nodes.map(c => c.number), body: p.body ?? '', changedFiles: p.changedFiles, comments: p.comments.nodes.map(comment),
    reviews: p.reviews.nodes.map(r => ({ author: r.author?.login, state: r.state.toLowerCase(), body: r.body, at: r.submittedAt })),
    checkRuns: (p.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []).map(c => c.__typename === 'CheckRun'
      ? { name: c.name, state: (c.conclusion ?? c.status).toLowerCase(), url: c.detailsUrl } : { name: c.context, state: c.state.toLowerCase(), url: c.targetUrl }),
  })),
};
writeFileSync(fileURLToPath(new URL('./prototype-github-sidebar.snapshot.json', import.meta.url)), JSON.stringify(snapshot));
console.log(`snapshot: ${snapshot.issues.length} issues, ${snapshot.pulls.length} PRs, ${labels.length} labels from ${snapshot.repo}`);
