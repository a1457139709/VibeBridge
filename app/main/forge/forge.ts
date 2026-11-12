import type { ForgeFailureKind, ForgeId, ForgePresentation } from '../../shared/forge';

/** Features that differ between forges. The UI shows a feature only when the bound forge declares it;
 * entries join this shape with the features that need them. */
export interface ForgeCapabilities {}

/** A failure of a forge call, in one of the forge-neutral kinds, with the forge's own text. */
export class ForgeError extends Error {
  constructor(readonly kind: ForgeFailureKind, readonly detail: string) { super(detail || kind); }
}

/** One Forge behind the Workbench. The adapter is the only code that talks to the forge or its
 * CLI. It returns domain shapes with forge-neutral names and throws ForgeError on every forge failure.
 * Its identity is the forge CLI's active account (docs/adr/0004-identity-comes-from-the-forge-cli.md). */
export interface Forge {
  id: ForgeId;
  presentation: ForgePresentation;
  capabilities: ForgeCapabilities;
  /** The active account's name. */
  account(): Promise<string>;
  /** Paths of every repository the active account can bind. */
  repositories(): Promise<string[]>;
  /** The repository path this `origin` URL points at, or null when it is not on this forge. */
  remotePath(originUrl: string): string | null;
  /** The entry of `repositories` that names the same repository as `path`, in its listed spelling, or null. */
  find(path: string, repositories: string[]): string | null;
}
