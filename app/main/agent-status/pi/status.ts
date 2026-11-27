import { join } from 'node:path';
import type { ProcessingState } from '../../../shared/processing-status';
import type { Outcome, Payload, StatusAdapter, StatusInterpreter } from '../adapter';

interface Evidence {
  stopReason?: string;
  waiting?: boolean;
  state?: ProcessingState;
  beforeCompaction?: ProcessingState;
  compactionFailed?: boolean;
}

class PiInterpreter implements StatusInterpreter {
  private evidence: Evidence = {};
  private currentSession: string | undefined;

  private keepStopReason(reason: unknown) {
    if (typeof reason === 'string') this.evidence.stopReason = reason;
    else delete this.evidence.stopReason;
  }
  accept(event: Payload): Outcome {
    if (typeof event.sessionId === 'string' && event.sessionId) this.currentSession = event.sessionId;
    switch (event.type) {
      case 'session_start':
      case 'session_switch':
      case 'session_fork':
      case 'session_tree':
        delete this.evidence.stopReason;
        delete this.evidence.beforeCompaction;
        delete this.evidence.compactionFailed;
        this.evidence.state = event.isIdle === false || event.hasPendingMessages === true ? 'busy' : 'ready';
        break;
      case 'agent_start':
      case 'auto_retry_start':
        delete this.evidence.stopReason;
        delete this.evidence.compactionFailed;
        delete this.evidence.beforeCompaction;
        this.evidence.state = 'busy';
        break;
      case 'ui_prompt_start':
        this.evidence.waiting = true;
        break;
      case 'ui_prompt_end':
        this.evidence.waiting = false;
        if (event.isIdle !== true || event.hasPendingMessages === true) this.evidence.state = 'busy';
        break;
      case 'tool_execution_start':
      case 'tool_execution_update':
      case 'tool_execution_end':
      case 'auto_compaction_start':
      case 'auto_compaction_end':
      case 'auto_retry_end':
        this.evidence.state = 'busy';
        break;
      case 'session_before_compact':
        this.evidence.beforeCompaction ??= this.evidence.state ?? 'error';
        this.evidence.state = 'busy';
        break;
      case 'session_compact':
      case 'session_compact_failed':
        this.evidence.compactionFailed = event.type === 'session_compact_failed' && event.aborted !== true;
        if (
          event.reason === 'manual' &&
          event.isIdle === true &&
          event.hasPendingMessages === false &&
          event.willRetry === false
        ) {
          this.evidence.state = this.evidence.compactionFailed
            ? 'error'
            : (this.evidence.beforeCompaction ?? this.evidence.state ?? 'error');
          delete this.evidence.beforeCompaction;
        } else this.evidence.state = 'busy';
        if (event.reason !== 'manual') delete this.evidence.beforeCompaction;
        break;
      case 'message_end': {
        const message = event.message;
        if (message && typeof message === 'object' && 'role' in message && message.role === 'assistant') {
          this.keepStopReason('stopReason' in message ? message.stopReason : undefined);
          delete this.evidence.compactionFailed;
        }
        return 'keep';
      }
      case 'agent_settled': {
        if (event.isIdle === false || event.hasPendingMessages === true) {
          this.evidence.state = 'busy';
          break;
        }
        const reason = this.evidence.stopReason;
        delete this.evidence.stopReason;
        delete this.evidence.beforeCompaction;
        const interrupted = event.aborted === true || reason === 'aborted';
        this.evidence.state = interrupted
          ? event.isIdle === true && event.hasPendingMessages === false
            ? 'ready'
            : 'error'
          : this.evidence.compactionFailed
            ? 'error'
            : reason === 'stop'
              ? 'done'
              : 'error';
        break;
      }
      case 'agent_end':
        if ('finalStopReason' in event) this.keepStopReason(event.finalStopReason);
        return 'keep';
      case 'turn_start':
      case 'turn_end':
      case 'message_start':
      case 'message_update':
        return 'keep';
      case 'session_shutdown':
        this.currentSession = undefined;
        return 'error';
      default:
        return 'error';
    }
    return this.evidence.waiting ? 'needs-input' : (this.evidence.state ?? 'error');
  }

  discardEvidence() {
    this.evidence = {};
  }

  sessionId() {
    return this.currentSession;
  }
}

export const pi: StatusAdapter = {
  async prepare({ command }) {
    const boundary = command.args.indexOf('--');
    const index = boundary < 0 ? command.args.length : boundary;
    return {
      command: {
        ...command,
        args: [
          ...command.args.slice(0, index),
          '--extension',
          join(__dirname, 'pi-reporter.mjs'),
          ...command.args.slice(index),
        ],
      },
    };
  },
  createInterpreter: () => new PiInterpreter(),
};
