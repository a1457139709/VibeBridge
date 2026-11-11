import type { DirectAction, MergeMethod } from '../../shared/code-hosting';
import { PlatformError, type CommandEnvironment } from './platform';
import { description, graphql, ownerAndName } from './github-graphql';

// Direct actions: the GitHub adapter's one-click changes, made by GraphQL mutations on the item's node.

const nodeQuery = (field: 'issue' | 'pullRequest') => `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { ${field}(number: $number) { id } } }`;

const mergeMethods: Record<MergeMethod, string> = { merge: 'MERGE', squash: 'SQUASH', rebase: 'REBASE' };
const reasons = { completed: 'COMPLETED', notPlanned: 'NOT_PLANNED' } as const;

/** The mutation for each action and the variables it takes beside the node id. Leaving out a commit headline and body lets GitHub write them. */
function mutation(action: DirectAction): { field: 'issue' | 'pullRequest'; query: string; variables: Record<string, string> } {
  switch (action.kind) {
    case 'closeIssue': return { field: 'issue', variables: { reason: reasons[action.reason] },
      query: 'mutation($id: ID!, $reason: IssueClosedStateReason!) { closeIssue(input: { issueId: $id, stateReason: $reason }) { clientMutationId } }' };
    case 'reopenIssue': return { field: 'issue', variables: {}, query: 'mutation($id: ID!) { reopenIssue(input: { issueId: $id }) { clientMutationId } }' };
    case 'mergeMergeRequest': return { field: 'pullRequest', variables: { method: mergeMethods[action.method] },
      query: 'mutation($id: ID!, $method: PullRequestMergeMethod!) { mergePullRequest(input: { pullRequestId: $id, mergeMethod: $method }) { clientMutationId } }' };
    case 'closeMergeRequest': return { field: 'pullRequest', variables: {},
      query: 'mutation($id: ID!) { closePullRequest(input: { pullRequestId: $id }) { clientMutationId } }' };
    case 'reopenMergeRequest': return { field: 'pullRequest', variables: {},
      query: 'mutation($id: ID!) { reopenPullRequest(input: { pullRequestId: $id }) { clientMutationId } }' };
  }
}

/** Finds the item's node, then changes it. A number of the other kind of item reads as missing. */
export async function act(environment: CommandEnvironment, path: string, action: DirectAction): Promise<void> {
  const { owner, name } = ownerAndName(path);
  const { field, query, variables } = mutation(action);
  const { repository } = await graphql<{ repository: Record<string, { id: string } | null> }>(environment, nodeQuery(field), { owner, name, number: action.number });
  const node = repository[field];
  if (!node) throw new PlatformError('unreachable', description, `#${action.number}`);
  await graphql(environment, query, { id: node.id, ...variables });
}
