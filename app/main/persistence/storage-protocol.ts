import { z } from 'zod';
import {
  agentTypeSchema,
  layoutSchema,
  sidebarPreferencesSchema,
  sidebarSchema,
  type Sidebar,
  type SidebarPreferences,
  type Project,
} from '../../shared/model';
import { repositoryReferenceSchema } from '../../shared/forge/forge';
import type { DispatchRecord } from '../dispatch';

// The messages the Project Store and its storage worker send each other. Both sides read what they receive with
// these schemas, so neither trusts the other's shapes unchecked.

const projectSchema: z.ZodType<Project> = z.object({
  id: z.string(),
  name: z.string(),
  directory: z.string(),
  panels: z.array(z.object({ id: z.string(), agent: agentTypeSchema })),
  layout: layoutSchema.nullable(),
});
const dispatchRecordSchema: z.ZodType<DispatchRecord> = z.object({
  projectId: z.string(),
  repository: repositoryReferenceSchema,
  issue: z.number(),
  dispatchedAt: z.string(),
  agent: agentTypeSchema,
  skill: z.string(),
  text: z.string(),
  sessionId: z.string(),
});

/** A request the Project Store sends its storage worker, named by its operation. */
const storageRequestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('load') }),
  z.object({ operation: z.literal('save'), project: projectSchema }),
  z.object({ operation: z.literal('bind'), projectId: z.string(), repository: repositoryReferenceSchema }),
  z.object({ operation: z.literal('unbind'), projectId: z.string() }),
  z.object({ operation: z.literal('dispatch'), record: dispatchRecordSchema }),
  z.object({ operation: z.literal('sidebar'), sidebar: sidebarSchema, preferences: sidebarPreferencesSchema }),
  z.object({ operation: z.literal('delete'), projectId: z.string(), nextActiveProjectId: z.string().nullable() }),
  z.object({ operation: z.literal('active'), projectId: z.string() }),
  z.object({ operation: z.literal('close') }),
]);
export type StorageRequest = z.infer<typeof storageRequestSchema>;

/** A request as it travels to the worker, under the `id` its reply answers. */
export const storageMessageSchema = z.object({ id: z.number(), request: storageRequestSchema });
export type StorageMessage = z.infer<typeof storageMessageSchema>;
/** The `id` of a message whose request could not be read, so the worker can still answer it with an error. */
export const storageMessageIdSchema = z.object({ id: z.number() });

/** What the worker is started with: the store's file. */
export const storageWorkerDataSchema = z.object({ file: z.string() });

/** What a load reads from the store: the projects, each one's Repository Binding, the Dispatch Records, the
 * active project, and each sidebar's preferences. */
export const storedContentSchema = z.object({
  projects: z.array(projectSchema),
  bindings: z.record(z.string(), repositoryReferenceSchema),
  dispatches: z.array(dispatchRecordSchema),
  activeProjectId: z.string().nullable(),
  navigation: sidebarPreferencesSchema,
  forgeSidebar: sidebarPreferencesSchema,
}) satisfies z.ZodType<Record<Sidebar, SidebarPreferences>>;
export type StoredContent = z.infer<typeof storedContentSchema>;
/** The result of a request that writes: its completion. */
export const completionSchema = z.void();

/** The storage worker's reply to the request under `id`: its result, or the message of the error it failed with. */
export const storageReplySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('result'), id: z.number(), result: z.unknown().optional() }),
  z.object({ kind: z.literal('error'), id: z.number(), message: z.string() }),
]);
export type StorageReply = z.infer<typeof storageReplySchema>;
