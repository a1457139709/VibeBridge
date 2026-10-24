import type { AgentType } from '../shared/model';
import type { ProcessingState } from '../shared/processing-status';
import { claudeStatus, type ClaudeMemory } from './claude-status';
import { piStatus, type PiMemory } from './pi-status';

type Payload = Record<string, unknown>;
type Transition = ProcessingState | 'keep';
export interface StatusMemory { pi?: PiMemory; codexWaits?: Set<string>; codexTurn?: string; claude?: ClaudeMemory }

function codex(event: Payload, memory: StatusMemory): Transition {
  const name = event.hook_event_name ?? event.type;
  if (typeof event.turn_id === 'string' && event.turn_id !== memory.codexTurn) {
    memory.codexTurn = event.turn_id;
    memory.codexWaits?.clear();
  }
  const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
  if (name === 'PermissionRequest' || (name === 'PreToolUse' && event.tool_name === 'request_user_input' && event.blocking === true)) {
    (memory.codexWaits ??= new Set()).add(tool || (name === 'PreToolUse' ? 'request_user_input' : ''));
    return 'needs-input';
  }
  if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
    if (tool) memory.codexWaits?.delete(tool);
    else if (event.tool_name === 'request_user_input') memory.codexWaits?.delete('request_user_input');
  }
  if (['UserPromptSubmit', 'Stop', 'agent-turn-complete'].includes(String(name))
    || (name === 'SessionStart' && event.source !== 'compact')
    || (name === 'Interrupt' && event.confirmed === true && event.can_accept_input === true)) memory.codexWaits?.clear();
  if (memory.codexWaits?.size && ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PostCompact'].includes(String(name))) return 'needs-input';
  switch (event.hook_event_name ?? event.type) {
    case 'SessionStart': return event.source === 'compact' ? 'busy'
      : ['startup', 'resume', 'clear', 'fork'].includes(String(event.source)) ? 'ready' : 'error';
    case 'UserPromptSubmit': case 'PostToolUse': case 'PostToolUseFailure':
    case 'PreCompact': case 'PostCompact': return 'busy';
    case 'PreToolUse': return 'busy';
    case 'Stop': case 'agent-turn-complete': return 'done';
    case 'Interrupt': return event.confirmed === true && event.can_accept_input === true ? 'ready' : 'keep';
    case 'SessionEnd': case 'SubagentStart': case 'SubagentStop': case 'Notification': return 'keep';
    default: return 'error';
  }
}

// CLI protocol differences stay inside the status module, without a plugin registry.
export function interpretStatus(agent: AgentType, event: Payload, memory: StatusMemory): Transition {
  if (event.observation === 'restored') return 'keep';
  if (event.observation === 'lost' || event.observation === 'unavailable') return 'error';
  if (agent === 'codex') return codex(event, memory);
  if (agent === 'claude') return claudeStatus(event, memory.claude ??= {});
  return piStatus(event, memory.pi ??= {});
}
