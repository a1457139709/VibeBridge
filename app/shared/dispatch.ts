import { z } from 'zod';
import { itemNumberSchema } from './forge';
import type { AgentType } from './model';
import type { ProcessingState } from './processing-status';

/** Where a dispatch goes: a panel of the project that has a run. */
export const dispatchTargetSchema = z.object({ kind: z.literal('panel'), panelId: z.string() });
export type DispatchTarget = z.infer<typeof dispatchTargetSchema>;

/** One dispatch: an issue of the bound repository, a command of an enabled workflow, and the target. `invert` swaps the
 * command's delivery (submit or fill) for this dispatch only. */
export const dispatchRequestSchema = z.object({
  issue: z.object({ number: itemNumberSchema, title: z.string() }),
  workflowId: z.string(),
  commandId: z.string(),
  target: dispatchTargetSchema,
  invert: z.boolean(),
});
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>;

/** The panel on a dispatch record's session now, with its processing state and session title when it has them. */
export interface DispatchLocation { projectId: string; panelId: string; status?: ProcessingState; title?: string }

/** A Dispatch Record as the sidebar shows it: the issue, when, the Agent type, the full text sent, and the panel on its
 * session now, or null when no open panel is on it (docs/adr/0003-dispatch-records-point-to-sessions.md). */
export interface DispatchRecordView { issue: number; dispatchedAt: string; agent: AgentType; text: string; location: DispatchLocation | null }

/** The latest of an issue's records that a panel is on now, if any. Records are oldest first. */
export const latestLocatable = (records: DispatchRecordView[]) => records.findLast(record => record.location);
