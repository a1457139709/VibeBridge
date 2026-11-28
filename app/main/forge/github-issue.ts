import { z } from 'zod';
import type { IssueDetail, RepositoryReference, SubIssue } from '../../shared/forge/forge';
import { graphql } from './github-cli';
import {
  answeredBy,
  answeringFields,
  answeringSchema,
  canWrite,
  checksState,
  issueReference,
  issueReferenceFields,
  issueReferenceSchema,
  issueState,
  issueStateFields,
  labelSchema,
  latestChecks,
  loginSchema,
  pullRequestState,
  relatedLimit,
  repositoryLinks,
  samePath,
  viewerPermission,
} from './github-fields';
import type { Answered } from './forge';

const repositorySchema = z.object({ nameWithOwner: z.string() });
const subIssueSchema = issueReferenceSchema.extend({
  repository: repositorySchema,
  blockedBy: z.object({
    nodes: z.array(
      z.object({ number: z.number(), title: z.string(), state: issueStateFields.state, repository: repositorySchema }),
    ),
  }),
  issueDependenciesSummary: z.object({ totalBlockedBy: z.number() }),
});
const subIssueFields = `${issueReferenceFields} repository { nameWithOwner }
      blockedBy(first: ${relatedLimit}) { nodes { number title state repository { nameWithOwner } } }
      issueDependenciesSummary { totalBlockedBy }`;
const issueDetailSchema = z.object({
  repository: z.object({
    ...answeringSchema,
    url: z.string(),
    viewerPermission,
    issue: z.object({
      number: z.number(),
      title: z.string(),
      ...issueStateFields,
      createdAt: z.string(),
      url: z.string(),
      bodyHTML: z.string(),
      author: loginSchema,
      assignees: z.object({ nodes: z.array(z.object({ login: z.string() })) }),
      labels: z.object({ nodes: z.array(labelSchema) }),
      comments: z.object({
        totalCount: z.number(),
        nodes: z.array(z.object({ author: loginSchema, createdAt: z.string(), bodyHTML: z.string() })),
      }),
      parent: issueReferenceSchema
        .extend({
          subIssuesSummary: z.object({ total: z.number(), completed: z.number() }),
          subIssues: z.object({ nodes: z.array(subIssueSchema) }),
        })
        .nullable(),
      subIssuesSummary: z.object({ total: z.number(), completed: z.number() }),
      subIssues: z.object({ nodes: z.array(subIssueSchema) }),
      blockedBy: z.object({ nodes: z.array(issueReferenceSchema) }),
      blocking: z.object({ nodes: z.array(issueReferenceSchema) }),
      closedByPullRequestsReferences: z.object({
        nodes: z.array(
          z.object({
            number: z.number(),
            title: z.string(),
            url: z.string(),
            state: z.enum(['OPEN', 'CLOSED', 'MERGED']),
            isDraft: z.boolean(),
            commits: z.object({
              nodes: z.array(
                z.object({ commit: z.object({ statusCheckRollup: z.object({ state: checksState }).nullable() }) }),
              ),
            }),
          }),
        ),
      }),
    }),
  }),
});
const issueDetailQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { ${answeringFields} url viewerPermission issue(number: $number) {
    number title state stateReason createdAt url bodyHTML author { login }
    assignees(first: 20) { nodes { login } }
    labels(first: 20) { nodes { name color } }
    comments(last: 100) { totalCount nodes { author { login } createdAt bodyHTML } }
    parent {
      ${issueReferenceFields} subIssuesSummary { total completed }
      subIssues(first: ${relatedLimit}) { nodes { ${subIssueFields} } }
    }
    subIssuesSummary { total completed }
    subIssues(first: ${relatedLimit}) { nodes { ${subIssueFields} } }
    blockedBy(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    blocking(first: ${relatedLimit}) { nodes { ${issueReferenceFields} } }
    closedByPullRequestsReferences(first: ${relatedLimit}, includeClosedPrs: true) {
      nodes { number title url state isDraft commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }
    }
  } }
}`;

const pathFrom = (repository: z.infer<typeof repositorySchema>, path: string) =>
  samePath(repository.nameWithOwner, path) ? null : repository.nameWithOwner;

function subIssue(sub: z.infer<typeof subIssueSchema>, path: string): SubIssue {
  const blockedBy = sub.blockedBy.nodes.map(blocker => ({
    path: pathFrom(blocker.repository, path),
    number: blocker.number,
    title: blocker.title,
    state: issueState({ state: blocker.state, stateReason: null }).state,
  }));
  return {
    ...issueReference(sub),
    path: pathFrom(sub.repository, path),
    blockedBy,
    unlistedBlockers: Math.max(0, sub.issueDependenciesSummary.totalBlockedBy - blockedBy.length),
  };
}

export async function issueDetail({ host, path }: RepositoryReference, number: number): Promise<Answered<IssueDetail>> {
  const [owner, name] = path.split('/');
  const { repository } = await graphql(host, issueDetailQuery, { owner, name, number }, issueDetailSchema);
  const { issue } = repository;
  return {
    answeredBy: answeredBy(repository),
    data: {
      number: issue.number,
      title: issue.title,
      ...issueState(issue),
      createdAt: issue.createdAt,
      labels: issue.labels.nodes,
      url: issue.url,
      author: issue.author?.login ?? null,
      assignees: issue.assignees.nodes.map(assignee => assignee.login),
      body: issue.bodyHTML,
      comments: issue.comments.nodes.map(comment => ({
        author: comment.author?.login ?? null,
        createdAt: comment.createdAt,
        html: comment.bodyHTML,
      })),
      commentCount: issue.comments.totalCount,
      parent: issue.parent && {
        ...issueReference(issue.parent),
        progress: { closed: issue.parent.subIssuesSummary.completed, total: issue.parent.subIssuesSummary.total },
        subIssues: issue.parent.subIssues.nodes.map(sub => subIssue(sub, path)),
      },
      subIssues: issue.subIssues.nodes.map(sub => subIssue(sub, path)),
      subIssueProgress: { closed: issue.subIssuesSummary.completed, total: issue.subIssuesSummary.total },
      blockedBy: issue.blockedBy.nodes.map(issueReference),
      blocking: issue.blocking.nodes.map(issueReference),
      closingPullRequests: issue.closedByPullRequestsReferences.nodes.map(pull => ({
        number: pull.number,
        title: pull.title,
        url: pull.url,
        state: pullRequestState(pull.state, pull.isDraft),
        checks: latestChecks(pull.commits),
      })),
      links: repositoryLinks(repository.url),
      canWrite: canWrite(repository.viewerPermission),
    },
  };
}
