import type { ProcessingState } from '../shared/processing-status';

export interface PiMemory {
  stopReason?: string; waiting?: boolean; state?: ProcessingState;
  beforeCompaction?: ProcessingState; compactionFailed?: boolean;
}

export function piStatus(event: Record<string, unknown>, memory: PiMemory): ProcessingState | 'keep' {
  switch (event.type) {
    case 'session_start': case 'session_switch': case 'session_fork': case 'session_tree':
      delete memory.stopReason;
      delete memory.beforeCompaction; delete memory.compactionFailed;
      memory.state = event.isIdle === false || event.hasPendingMessages === true ? 'busy' : 'ready';
      break;
    case 'agent_start': case 'auto_retry_start':
      delete memory.stopReason; delete memory.compactionFailed; delete memory.beforeCompaction;
      memory.state = 'busy'; break;
    case 'ui_prompt_start': memory.waiting = true; break;
    case 'ui_prompt_end':
      memory.waiting = false;
      if (event.isIdle !== true || event.hasPendingMessages === true) memory.state = 'busy';
      break;
    case 'tool_execution_start': case 'tool_execution_update': case 'tool_execution_end':
    case 'auto_compaction_start': case 'auto_compaction_end': case 'auto_retry_end':
      memory.state = 'busy'; break;
    case 'session_before_compact':
      // An earlier extension can start another manual compaction before this
      // observer receives the first completion. Keep the original idle result.
      memory.beforeCompaction ??= memory.state ?? 'error'; memory.state = 'busy'; break;
    case 'session_compact': case 'session_compact_failed':
      memory.compactionFailed = event.type === 'session_compact_failed' && event.aborted !== true;
      if (event.reason === 'manual' && event.isIdle === true && event.hasPendingMessages === false && event.willRetry === false) {
        memory.state = memory.compactionFailed ? 'error' : memory.beforeCompaction ?? memory.state ?? 'error';
        delete memory.beforeCompaction;
      } else memory.state = 'busy';
      if (event.reason !== 'manual') delete memory.beforeCompaction;
      break;
    case 'message_end': {
      const message = event.message;
      if (message && typeof message === 'object' && 'role' in message && message.role === 'assistant') {
        memory.stopReason = 'stopReason' in message && typeof message.stopReason === 'string' ? message.stopReason : undefined;
        // Threshold compaction may fail between tool turns without another
        // agent_start. A newer assistant outcome supersedes that failure.
        delete memory.compactionFailed;
      }
      return 'keep';
    }
    case 'agent_settled': {
      if (event.isIdle === false || event.hasPendingMessages === true) { memory.state = 'busy'; break; }
      const reason = memory.stopReason;
      delete memory.stopReason;
      delete memory.beforeCompaction;
      // A run can be cancelled after its last assistant message, so settlement
      // can confirm interruption without an assistant stopReason of aborted.
      const interrupted = event.aborted === true || reason === 'aborted';
      memory.state = interrupted ? event.isIdle === true && event.hasPendingMessages === false ? 'ready' : 'error'
        : memory.compactionFailed ? 'error' : reason === 'stop' ? 'done' : 'error';
      break;
    }
    case 'agent_end':
      if ('finalStopReason' in event) memory.stopReason = typeof event.finalStopReason === 'string' ? event.finalStopReason : undefined;
      return 'keep';
    case 'turn_start': case 'turn_end': case 'message_start': case 'message_update':
    case 'session_shutdown': return 'keep';
    default: return 'error';
  }
  return memory.waiting ? 'needs-input' : memory.state ?? 'error';
}
