import { z } from 'zod';

/** Code Hosting Platforms the Workbench has an adapter for. */
export const platformIds = ['github'] as const;
export type PlatformId = typeof platformIds[number];
export const platformIdSchema = z.enum(platformIds);

/** A repository on a Code Hosting Platform. The path is the platform's own repository path,
 * which may have more than two segments (nested groups). */
export interface RepositoryReference { platform: PlatformId; path: string }
export const repositoryReferenceSchema = z.strictObject({ platform: platformIdSchema, path: z.string().min(1) });
export const sameRepository = (a: RepositoryReference | null | undefined, b: RepositoryReference | null | undefined) =>
  a?.platform === b?.platform && a?.path === b?.path;

/** Features that differ between platforms. The UI shows a feature only when the platform declares it. */
export type PlatformCapability = 'subIssues' | 'nativeBlocking' | 'mergeMethods' | 'mergeQueue' | 'requiredChecks';

/** What the UI needs to name a platform and help the user when its CLI cannot be used. */
export interface PlatformDescription {
  id: PlatformId;
  name: string;
  /** Where to get the platform's CLI. */
  installUrl: string;
  /** The command that signs the platform's CLI in. */
  signInCommand: string;
  capabilities: PlatformCapability[];
}

/** Why a platform call failed: its CLI is not installed, not signed in, cannot reach the
 * repository (missing and forbidden look the same), or anything else, which may pass. */
export type PlatformFailureKind = 'notInstalled' | 'signedOut' | 'unreachable' | 'transient';
/** `output` is what the platform's CLI reported, unchanged. */
export interface PlatformFailure { kind: PlatformFailureKind; platform: PlatformDescription; output: string }

/** The repositories a project may bind. `suggested` is the listed repository the project
 * directory's `origin` points to; it is not bound until the user saves it. */
export type RepositoryChoices = { ok: true; platform: PlatformDescription; account: string; repositories: RepositoryReference[]; suggested: RepositoryReference | null }
  | { ok: false; failure: PlatformFailure };
