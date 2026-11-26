import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { z } from 'zod';
import base from './vite.config';
import type { RepositoryReference } from './app/shared/forge/forge';
import { issueDetail } from './app/main/forge/github-issue';
import { fetchPullRequestDetail } from './app/main/forge/github-pull-request';
import { graphql } from './app/main/forge/github-cli';
import { issueReference, issueReferenceFields, issueReferenceSchema } from './app/main/forge/github-fields';

const path = process.env.PROTOTYPE_REPO ?? 'a1457139709/VibeBridge';
const repository: RepositoryReference = { forge: 'github', host: 'github.com', id: path, path };

const extrasQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    closedAt
    subIssues(first: 50) { nodes { number blockedBy(first: 20) { nodes { ${issueReferenceFields} } } } }
    closedByPullRequestsReferences(first: 50, includeClosedPrs: true) {
      nodes { number createdAt mergedAt closedAt author { login } }
    }
  } }
}`;
const extrasSchema = z.object({
  repository: z.object({
    issue: z.object({
      closedAt: z.string().nullable(),
      subIssues: z.object({
        nodes: z.array(z.object({ number: z.number(), blockedBy: z.object({ nodes: z.array(issueReferenceSchema) }) })),
      }),
      closedByPullRequestsReferences: z.object({
        nodes: z.array(
          z.object({
            number: z.number(),
            createdAt: z.string(),
            mergedAt: z.string().nullable(),
            closedAt: z.string().nullable(),
            author: z.object({ login: z.string() }).nullable(),
          }),
        ),
      }),
    }),
  }),
});

async function prototypeIssue(number: number) {
  const [owner, name] = repository.path.split('/');
  const [{ data }, extras] = await Promise.all([
    issueDetail(repository, number),
    graphql(repository.host, extrasQuery, { owner, name, number }, extrasSchema),
  ]);
  const { issue } = extras.repository;
  const blockers = new Map(
    issue.subIssues.nodes.map(sub => [sub.number, sub.blockedBy.nodes.map(issueReference)] as const),
  );
  const times = new Map(issue.closedByPullRequestsReferences.nodes.map(pull => [pull.number, pull] as const));
  return {
    ...data,
    closedAt: issue.closedAt,
    subIssues: data.subIssues.map(sub => ({ ...sub, blockedBy: blockers.get(sub.number) ?? [] })),
    closingPullRequests: data.closingPullRequests.map(pull => {
      const time = times.get(pull.number);
      return {
        ...pull,
        createdAt: time?.createdAt ?? '',
        mergedAt: time?.mergedAt ?? null,
        closedAt: time?.closedAt ?? null,
        author: time?.author?.login ?? null,
      };
    }),
  };
}

const liveForge: Plugin = {
  name: 'prototype-live-forge',
  configureServer(server) {
    server.middlewares.use('/proto-api/', (request, response) => {
      const match = /^\/?(issue|pullRequest)\/(\d+)$/.exec(request.url ?? '');
      if (!match) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const number = Number(match[2]);
      const read =
        match[1] === 'issue'
          ? prototypeIssue(number).then(issue => ({ kind: 'issue', repo: repository.path, issue }))
          : fetchPullRequestDetail(repository, number).then(answer => ({
              kind: 'pullRequest',
              repo: repository.path,
              pullRequest: answer.data,
            }));
      read.then(
        data => {
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify(data));
        },
        (error: unknown) => {
          response.statusCode = 502;
          response.end(error instanceof Error ? error.message : String(error));
        },
      );
    });
  },
};

export default mergeConfig(base, defineConfig({ plugins: [liveForge] }));
