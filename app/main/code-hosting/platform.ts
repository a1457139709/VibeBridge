import type { PlatformDescription, PlatformFailure, PlatformFailureKind } from '../../shared/code-hosting';

/** The environment platform CLIs run in: the user's login-shell environment, the one Agent Runs get. */
export type CommandEnvironment = Record<string, string>;

/** One per Code Hosting Platform, held in the closed table in ./platforms. The adapter is the only
 * code that calls its platform's CLI; it returns domain shapes and throws PlatformError. */
export interface CodeHostingPlatform {
  readonly description: PlatformDescription;
  /** The CLI's signed-in account and the path of every repository that account may bind, in the platform's order. */
  bindable(environment: CommandEnvironment): Promise<{ account: string; paths: string[] }>;
  /** The repository path a git remote URL points to on this platform, or null for anything else. */
  remotePath(url: string): string | null;
}

export class PlatformError extends Error {
  readonly failure: PlatformFailure;
  constructor(kind: PlatformFailureKind, platform: PlatformDescription, output: string) {
    super(output || kind);
    this.failure = { kind, platform, output };
  }
}
