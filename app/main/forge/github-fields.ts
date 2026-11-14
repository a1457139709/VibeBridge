import { z } from 'zod';
import type { PullRequestState } from '../../shared/forge';

// GitHub's GraphQL fields that the adapter's issue and pull request reads share, and how they map to domain shapes.

export const labelSchema = z.object({ name: z.string(), color: z.string() });
const closedAs = { COMPLETED: 'completed', NOT_PLANNED: 'notPlanned', DUPLICATE: 'duplicate', REOPENED: null } as const;
export const issueStateFields = { state: z.enum(['OPEN', 'CLOSED']), stateReason: z.enum(['COMPLETED', 'NOT_PLANNED', 'DUPLICATE', 'REOPENED']).nullable() };
/** An issue's state, and for a closed issue how it was closed when GitHub tells. */
export const issueState = (issue: z.infer<z.ZodObject<typeof issueStateFields>>) => ({ state: issue.state === 'OPEN' ? 'open' as const : 'closed' as const,
  closedAs: issue.state === 'OPEN' || !issue.stateReason ? null : closedAs[issue.stateReason] });
export const checksState = z.enum(['SUCCESS', 'FAILURE', 'ERROR', 'PENDING', 'EXPECTED']);
export const relatedLimit = 50;
export const issueReferenceSchema = z.object({ number: z.number(), title: z.string(), url: z.string(), ...issueStateFields });
export const loginSchema = z.object({ login: z.string() }).nullable();
export const issueReferenceFields = 'number title state stateReason url';
export const issueReference = (issue: z.infer<typeof issueReferenceSchema>) => ({ number: issue.number, title: issue.title, ...issueState(issue), url: issue.url });
export const pullRequestState = (state: 'OPEN' | 'MERGED' | 'CLOSED', draft: boolean): PullRequestState =>
  state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : draft ? 'draft' : 'open';
export const repositoryLinks = (url: string) => ({ issues: `${url}/issues/`, pullRequests: `${url}/pull/` });
