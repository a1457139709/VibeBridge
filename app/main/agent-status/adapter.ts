import { join } from 'node:path';
import type { AgentCommand } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';

export type Payload = Record<string, unknown>;
export type Transition = ProcessingState | 'keep';
/** Discard: an identifiable stale, duplicate or child fact; it cannot change state. */
export type Outcome = Transition | 'discard';
export interface Launch { command: AgentCommand; directory: string; resourceDirectory: string }
export interface PreparedLaunch { command: AgentCommand; cleanup?: () => Promise<void> }

/** One per Agent Type, held in ProcessingStatus's closed table.
 * See docs/processing-status.md for the rules every adapter shares.
 */
export interface StatusAdapter {
  /** Add this Agent Type's Status Reporter to one launch. Throw rather than rewrite
   * a user's configuration that cannot be safely understood; never change user files.
   */
  prepare(launch: Launch): Promise<PreparedLaunch>;
  /** A fresh interpreter for one Agent Run. */
  observe(): StatusInterpreter;
}

export interface StatusInterpreter {
  /** An authenticated main-run CLI fact, never an observation report. Identity checks and classification share this state. */
  accept(payload: Payload): Outcome;
  /** Called after every Error: discard outcome evidence, keep session identity and duplicate records. */
  discardEvidence(): void;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Shell command running a bundled Status Reporter with the Workbench's own runtime. */
export const reporterCommand = (file: string) => `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(join(__dirname, file))}`;
