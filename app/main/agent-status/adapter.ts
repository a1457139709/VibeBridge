import { join } from 'node:path';
import type { AgentCommand } from '../../shared/model';
import type { ProcessingState } from '../../shared/processing-status';

export type Payload = Record<string, unknown>;
export type Transition = ProcessingState | 'keep';
export type Outcome = Transition | 'discard';
export interface Launch {
  command: AgentCommand;
  directory: string;
  resourceDirectory: string;
}
export interface PreparedLaunch {
  command: AgentCommand;
  cleanup?: (() => Promise<void>) | undefined;
}

export interface StatusAdapter {
  prepare(launch: Launch): Promise<PreparedLaunch>;
  createInterpreter(): StatusInterpreter;
}

export interface StatusInterpreter {
  accept(payload: Payload): Outcome;
  discardEvidence(): void;
  sessionId(): string | undefined;
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export const reporterCommand = (file: string) =>
  `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(join(__dirname, file))}`;
