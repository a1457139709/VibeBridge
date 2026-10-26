import { join } from 'node:path';
import type { ProcessingState } from '../../../shared/processing-status';
import type { Outcome, Payload, StatusAdapter, StatusInterpreter } from '../adapter';

interface Evidence {
  stopReason?: string; waiting?: boolean; state?: ProcessingState;
  beforeCompaction?: ProcessingState; compactionFailed?: boolean;
}

/** The reporter runs inside the pi process, subscribes to no child session and delivers
 * its reports in order through one queue, so there is no separate identity to verify.
 */
class PiInterpreter implements StatusInterpreter {
  private evidence: Evidence = {};

  accept(event: Payload): Outcome {
    switch (event.type) {
      case 'session_start': case 'session_switch': case 'session_fork': case 'session_tree':
        delete this.evidence.stopReason;
        delete this.evidence.beforeCompaction; delete this.evidence.compactionFailed;
        this.evidence.state = event.isIdle === false || event.hasPendingMessages === true ? 'busy' : 'ready';
        break;
      case 'agent_start':
        delete this.evidence.stopReason; delete this.evidence.compactionFailed; delete this.evidence.beforeCompaction;
        this.evidence.state = 'busy'; break;
      case 'ui_prompt_start': this.evidence.waiting = true; break;
      case 'ui_prompt_end':
        this.evidence.waiting = false;
        if (event.isIdle !== true || event.hasPendingMessages === true) this.evidence.state = 'busy';
        break;
      case 'tool_execution_start': case 'tool_execution_end': this.evidence.state = 'busy'; break;
      case 'session_before_compact':
        // An earlier extension can start another manual compaction before this
        // observer receives the first completion. Keep the original idle result.
        this.evidence.beforeCompaction ??= this.evidence.state ?? 'error'; this.evidence.state = 'busy'; break;
      case 'session_compact': case 'session_compact_failed':
        this.evidence.compactionFailed = event.type === 'session_compact_failed' && event.aborted !== true;
        if (event.reason === 'manual' && event.isIdle === true && event.hasPendingMessages === false && event.willRetry === false) {
          this.evidence.state = this.evidence.compactionFailed ? 'error' : this.evidence.beforeCompaction ?? this.evidence.state ?? 'error';
          delete this.evidence.beforeCompaction;
        } else this.evidence.state = 'busy';
        if (event.reason !== 'manual') delete this.evidence.beforeCompaction;
        break;
      case 'message_end': {
        const message = event.message as Payload;
        if (message.role === 'assistant') {
          this.evidence.stopReason = typeof message.stopReason === 'string' ? message.stopReason : undefined;
          // Threshold compaction may fail between tool turns without another
          // agent_start. A newer assistant outcome supersedes that failure.
          delete this.evidence.compactionFailed;
        }
        return 'keep';
      }
      case 'agent_settled': {
        if (event.isIdle === false || event.hasPendingMessages === true) { this.evidence.state = 'busy'; break; }
        const reason = this.evidence.stopReason;
        delete this.evidence.stopReason;
        delete this.evidence.beforeCompaction;
        // A run can be cancelled after its last assistant message, so settlement
        // can confirm interruption without an assistant stopReason of aborted.
        const interrupted = event.aborted === true || reason === 'aborted';
        this.evidence.state = interrupted ? event.isIdle === true && event.hasPendingMessages === false ? 'ready' : 'error'
          : this.evidence.compactionFailed ? 'error' : reason === 'stop' ? 'done' : 'error';
        break;
      }
      case 'agent_end':
        this.evidence.stopReason = typeof event.finalStopReason === 'string' ? event.finalStopReason : undefined;
        return 'keep';
      default: return 'error';
    }
    return this.evidence.waiting ? 'needs-input' : this.evidence.state ?? 'error';
  }

  discardEvidence() { this.evidence = {}; }
}

export const pi: StatusAdapter = {
  async prepare({ command }) {
    const boundary = command.args.indexOf('--');
    const index = boundary < 0 ? command.args.length : boundary;
    return { command: { ...command, args: [...command.args.slice(0, index), '--extension', join(__dirname, 'pi-reporter.mjs'), ...command.args.slice(index)] } };
  },
  observe: () => new PiInterpreter(),
};
