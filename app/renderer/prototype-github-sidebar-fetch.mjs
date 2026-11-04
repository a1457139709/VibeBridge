// PROTOTYPE — throwaway. Pulls a read-only snapshot of the bound repo's issues, PRs and labels with `gh`
// into prototype-github-sidebar.snapshot.json (git-ignored) so the sidebar variants show real data.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [owner, name] = (process.argv[2] ?? 'a1457139709/VibeBridge').split('/');
const gql = (query) => JSON.parse(execFileSync('gh', ['api', 'graphql', '--paginate', '--slurp', '-F', `owner=${owner}`, '-F', `name=${name}`, '-f', `query=${query}`], { encoding: 'utf8', maxBuffer: 64 << 20 }));
const pages = (result, key) => result.flatMap(page => page.data.repository[key].nodes);

const issues = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){issues(first:50,after:$endCursor,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{
  number title state stateReason createdAt updatedAt author{login} assignees(first:5){nodes{login}} labels(first:10){nodes{name}} comments{totalCount}
  parent{number} blockedBy(first:20){nodes{number}} closedByPullRequestsReferences(first:10,includeClosedPrs:true){nodes{number}} body}}}}`), 'issues');
const pulls = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){pullRequests(first:50,after:$endCursor,orderBy:{field:UPDATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}nodes{
  number title state isDraft createdAt updatedAt author{login} headRefName additions deletions reviewDecision
  closingIssuesReferences(first:10){nodes{number}} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}}`), 'pullRequests');
const labels = pages(gql(`query($owner:String!,$name:String!,$endCursor:String){repository(owner:$owner,name:$name){labels(first:100,after:$endCursor){pageInfo{hasNextPage endCursor}nodes{name color}}}}`), 'labels');

const snapshot = {
  repo: `${owner}/${name}`, fetchedAt: new Date().toISOString(), labels,
  issues: issues.map(i => ({
    number: i.number, title: i.title, state: i.state.toLowerCase(), reason: (i.stateReason ?? '').toLowerCase(), createdAt: i.createdAt, updatedAt: i.updatedAt,
    author: i.author?.login, assignees: i.assignees.nodes.map(a => a.login), labels: i.labels.nodes.map(l => l.name), comments: i.comments.totalCount,
    parent: i.parent?.number ?? null, blockedBy: i.blockedBy.nodes.map(b => b.number), prs: i.closedByPullRequestsReferences.nodes.map(p => p.number), body: (i.body ?? '').slice(0, 1200),
  })),
  pulls: pulls.map(p => ({
    number: p.number, title: p.title, state: p.isDraft && p.state === 'OPEN' ? 'draft' : p.state.toLowerCase(), createdAt: p.createdAt, updatedAt: p.updatedAt,
    author: p.author?.login, branch: p.headRefName, additions: p.additions, deletions: p.deletions, review: (p.reviewDecision ?? '').toLowerCase(),
    checks: (p.commits.nodes[0]?.commit.statusCheckRollup?.state ?? 'none').toLowerCase(), closes: p.closingIssuesReferences.nodes.map(c => c.number),
  })),
};
writeFileSync(fileURLToPath(new URL('./prototype-github-sidebar.snapshot.json', import.meta.url)), JSON.stringify(snapshot));
console.log(`snapshot: ${snapshot.issues.length} issues, ${snapshot.pulls.length} PRs, ${labels.length} labels from ${snapshot.repo}`);
