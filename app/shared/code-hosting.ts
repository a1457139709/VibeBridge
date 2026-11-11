import { z } from 'zod';

/** The Code Hosting Platforms the Workbench has an adapter for, in a closed table (app/main/code-hosting/platforms.ts). */
export const codeHostingPlatformIds = ['github'] as const;
export type CodeHostingPlatformId = typeof codeHostingPlatformIds[number];
export const codeHostingPlatformIdSchema = z.enum(codeHostingPlatformIds);

/** A repository on a Code Hosting Platform. The path is the platform's own repository path and may have more
 * than two segments (nested groups), so it is never split into owner and name outside the adapter. */
export interface RepositoryReference { platform: CodeHostingPlatformId; path: string }
export const sameRepository = (a: RepositoryReference | null, b: RepositoryReference | null) =>
  a === b || (!!a && !!b && a.platform === b.platform && a.path === b.path);

/** What the UI shows for a platform; each adapter provides its own. */
export interface CodeHostingPresentation {
  /** Display name, e.g. GitHub. */
  name: string;
  /** The platform CLI whose active account is the Workbench's identity, e.g. gh. */
  cli: string;
  installUrl: string;
  loginCommand: string;
}

/** Every platform failure falls into one of these kinds. `detail` is the platform's own text, unchanged. */
export type CodeHostingFailureKind = 'notInstalled' | 'loggedOut' | 'inaccessible' | 'transient';
export interface CodeHostingFailure { kind: CodeHostingFailureKind; detail: string; platform: CodeHostingPresentation }

/** The repositories a project can bind: those of the platform CLI's active account, and the one the project
 * directory's `origin` points at when it is among them. Offering it does not bind it. */
export type RepositoryChoices =
  | { ok: true; platform: CodeHostingPresentation; account: string; repositories: RepositoryReference[]; origin: RepositoryReference | null }
  | { ok: false; failure: CodeHostingFailure };
