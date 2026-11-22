import { z } from 'zod';
import { itemNumberSchema } from './forge/forge';
import { agentTypes, type AgentType } from './model';

export const dispatchTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('panel'), panelId: z.string() }),
  z.object({ kind: z.literal('new'), agent: z.enum(agentTypes) }),
]);
export type DispatchTarget = z.infer<typeof dispatchTargetSchema>;

export const dispatchRequestSchema = z.object({
  issue: z.object({ number: itemNumberSchema, title: z.string() }),
  workflowId: z.string(),
  commandId: z.string(),
  target: dispatchTargetSchema,
  invertDelivery: z.boolean(),
});
export type DispatchRequest = z.infer<typeof dispatchRequestSchema>;

export interface DispatchLocation {
  projectId: string;
  panelId: string;
}

export interface DispatchRecordView {
  issueNumber: number;
  dispatchedAt: string;
  agent: AgentType;
  skill: string;
  sessionId?: string;
  location: DispatchLocation | null;
}

export const latestLocatableRecord = (records: DispatchRecordView[]) => records.findLast(record => record.location);
