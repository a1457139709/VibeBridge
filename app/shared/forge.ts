import { z } from 'zod';

/** The Forges the Workbench has an adapter for, in a closed table (app/main/forge/forges.ts). */
export const forgeIds = ['github'] as const;
export type ForgeId = typeof forgeIds[number];
export const forgeIdSchema = z.enum(forgeIds);

/** A repository on a Forge. The path is the forge's own repository path and may have more
 * than two segments (nested groups), so it is never split into owner and name outside the adapter. */
export interface RepositoryReference { forge: ForgeId; path: string }
export const sameRepository = (a: RepositoryReference | null, b: RepositoryReference | null) =>
  a === b || (!!a && !!b && a.forge === b.forge && a.path === b.path);

/** What the UI shows for a forge; each adapter provides its own. */
export interface ForgePresentation {
  /** Display name, e.g. GitHub. */
  name: string;
  /** The forge CLI whose active account is the Workbench's identity, e.g. gh. */
  cli: string;
  installUrl: string;
  loginCommand: string;
}

/** Every forge failure falls into one of these kinds. `detail` is the forge's own text, unchanged. */
export type ForgeFailureKind = 'notInstalled' | 'loggedOut' | 'inaccessible' | 'transient';
export interface ForgeFailure { kind: ForgeFailureKind; detail: string; forge: ForgePresentation }

/** The repositories a project can bind: those of the forge CLI's active account, and the one the project
 * directory's `origin` points at when it is among them. Offering it does not bind it. */
export type RepositoryChoices =
  | { ok: true; forge: ForgePresentation; account: string; repositories: RepositoryReference[]; origin: RepositoryReference | null }
  | { ok: false; failure: ForgeFailure };
