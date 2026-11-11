import type { CodeHostingFailureKind, CodeHostingPlatformId, CodeHostingPresentation } from '../../shared/code-hosting';

/** Features that differ between platforms. The UI shows a feature only when the bound platform declares it;
 * entries join this shape with the features that need them. */
export interface CodeHostingCapabilities {}

/** A failure of a platform call, in one of the platform-neutral kinds, with the platform's own text. */
export class CodeHostingError extends Error {
  constructor(readonly kind: CodeHostingFailureKind, readonly detail: string) { super(detail || kind); }
}

/** One Code Hosting Platform behind the Workbench. The adapter is the only code that talks to the platform or its
 * CLI. It returns domain shapes with platform-neutral names and throws CodeHostingError on every platform failure.
 * Its identity is the platform CLI's active account (docs/adr/0004-identity-comes-from-the-platform-cli.md). */
export interface CodeHostingPlatform {
  id: CodeHostingPlatformId;
  presentation: CodeHostingPresentation;
  capabilities: CodeHostingCapabilities;
  /** The active account's name. */
  account(): Promise<string>;
  /** Paths of every repository the active account can bind. */
  repositories(): Promise<string[]>;
  /** The path among `repositories` that this `origin` URL points at, or null when it points elsewhere. */
  recognize(originUrl: string, repositories: string[]): string | null;
}
