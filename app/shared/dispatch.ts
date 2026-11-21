import { z } from 'zod';
import { itemNumberSchema } from './forge/forge';
import { agentTypes, type AgentType } from './model';

/** Where a dispatch goes: a panel of the project that has a run, or a new ephemeral panel of an Agent type. */
export const dispatchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('panel'), panelId: z.string() }),
  z.object({ kind: z.literal('new'), agent: z.enum(agentTypes) }),
]);
export type DispatchTarget = z.infer<typeof dispatchTargetSchema>;

/** One dispatch: an issue of the bound repository, a command of an enabled workflow, and the target. `invertDelivery` swaps the
 * command's delivery (submit or fill) for this dispatch only. */
export const dispatchRequestSchema = z.object({
  issue: z.object({ number: itemNumberSchema, title: z.string() }),
  workflowId: z.string(),
  commandId: z.string(),
  target: dispatchTargetSchema,
  invertDelivery: z.boolean(),
});
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>;

/** The open panel on a dispatch record's session now. */
export interface DispatchLocation {
  projectId: string;
  panelId: string;
}

/** A Dispatch Record as the sidebar shows it: the issue, when, the Agent type, the skill dispatched, the session that
 * took it, and the panel on that session now, or null when no open panel is on it
 * (docs/adr/0003-dispatch-records-point-to-sessions.md). A dispatch still waiting for its new panel's first session has
 * no session ID yet and shows that panel. */
export interface DispatchRecordView {
  issueNumber: number;
  dispatchedAt: string;
  agent: AgentType;
  /** The skill's name, without any Agent type's invocation syntax, e.g. `grill-me`. */
  skill: string;
  sessionId?: string;
  location: DispatchLocation | null;
}

/** The latest of an issue's records that a panel is on now, if any. Records are oldest first. */
export const latestLocatableRecord = (records: DispatchRecordView[]) => records.findLast(record => record.location);
