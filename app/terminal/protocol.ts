import { z } from 'zod';
import type { CommandCheck, Run, TerminalEvent } from '../shared/model';
import type { ProcessIdentity } from './processes';

export const runSchema: z.ZodType<Run> = z.object({
  id: z.string(),
  projectId: z.string(),
  panelId: z.string(),
  state: z.enum(['running', 'starting', 'failed', 'stopped']),
  pid: z.number().optional(),
  title: z.string().optional(),
});
export const commandCheckSchema: z.ZodType<CommandCheck> = z.discriminatedUnion('available', [
  z.object({ available: z.literal(true), path: z.string() }),
  z.object({ available: z.literal(false), message: z.string() }),
]);
export const completionSchema = z.void();

const terminalEventSchema: z.ZodType<TerminalEvent> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('title'), runId: z.string(), title: z.string() }),
  z.object({ kind: z.literal('output'), runId: z.string(), data: z.string() }),
  z.object({ kind: z.literal('started'), run: runSchema }),
  z.object({ kind: z.literal('stopping'), runId: z.string() }),
  z.object({ kind: z.literal('exit'), runId: z.string() }),
]);
const processIdentitySchema: z.ZodType<ProcessIdentity> = z.object({
  pid: z.number(),
  parent: z.number(),
  started: z.string(),
  owner: z.string().optional(),
});

const runStartSchema = z.object({
  id: z.string(),
  panelId: z.string(),
  projectId: z.string(),
  directory: z.string(),
  command: z.object({ command: z.string(), args: z.array(z.string()) }),
  extraEnvironment: z.record(z.string(), z.string()),
});
export type RunStart = z.infer<typeof runStartSchema>;

const requestIdSchema = z.number();
const operationSchema = z.discriminatedUnion('operation', [
  z.object({ id: requestIdSchema, operation: z.literal('start'), value: runStartSchema }),
  z.object({ id: requestIdSchema, operation: z.literal('check-command'), value: z.string() }),
  z.object({
    id: requestIdSchema,
    operation: z.literal('input'),
    value: z.object({ runId: z.string(), data: z.string() }),
  }),
  z.object({
    id: requestIdSchema,
    operation: z.literal('resize'),
    value: z.object({ runId: z.string(), cols: z.number(), rows: z.number() }),
  }),
  z.object({ id: requestIdSchema, operation: z.literal('stop'), value: z.object({ runId: z.string() }) }),
  z.object({ id: requestIdSchema, operation: z.literal('shutdown') }),
]);
export type HostOperation = z.infer<typeof operationSchema>;
export const hostRequestSchema = z.union([
  operationSchema,
  z.object({ operation: z.literal('output-consumed'), value: z.object({ runId: z.string(), characters: z.number() }) }),
]);
export type HostRequest = z.infer<typeof hostRequestSchema>;
export const requestIdOf = (value: unknown) => z.object({ id: requestIdSchema }).safeParse(value).data?.id;

export const hostReportSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('event'), event: terminalEventSchema }),
  z.object({ kind: z.literal('processes'), processes: z.array(processIdentitySchema) }),
  z.object({ kind: z.literal('failure'), message: z.string() }),
  z.object({ kind: z.literal('reply'), id: requestIdSchema, result: z.unknown().optional() }),
  z.object({ kind: z.literal('error'), id: requestIdSchema, message: z.string() }),
]);
export type HostReport = z.infer<typeof hostReportSchema>;
