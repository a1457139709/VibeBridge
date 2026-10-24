import type { ProcessingState } from '../shared/processing-status';

export interface ClaudeMemory { questions?: Set<string>; permissions?: Set<string>; elicitations?: Set<string> }

export function claudeStatus(event: Record<string, unknown>, memory: ClaudeMemory): ProcessingState | 'keep' {
  const name = event.hook_event_name;
  const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
  const permission = tool ? `id:${tool}` : typeof event.tool_input_hash === 'string' ? `input:${event.tool_input_hash}` : '?';
  const elicitation = JSON.stringify([event.mcp_server_name ?? '', event.elicitation_id ?? '']);
  if (['UserPromptSubmit', 'Stop', 'StopFailure'].includes(String(name)) || (name === 'SessionStart' && event.source !== 'compact')) {
    memory.questions?.clear(); memory.permissions?.clear(); memory.elicitations?.clear();
  }
  if (name === 'PreToolUse' && event.tool_name === 'AskUserQuestion') (memory.questions ??= new Set()).add(tool);
  if (name === 'PermissionRequest') (memory.permissions ??= new Set()).add(permission);
  if (name === 'Elicitation') (memory.elicitations ??= new Set()).add(elicitation);
  if (name === 'ElicitationResult') memory.elicitations?.delete(elicitation);
  if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
    if (tool || event.tool_name === 'AskUserQuestion') memory.questions?.delete(tool);
    if (tool) memory.permissions?.delete(`id:${tool}`);
    if (typeof event.tool_input_hash === 'string') memory.permissions?.delete(`input:${event.tool_input_hash}`);
  }
  const waiting = !!(memory.questions?.size || memory.permissions?.size || memory.elicitations?.size);
  switch (name) {
    case 'SessionStart': return event.source === 'compact' ? (waiting ? 'needs-input' : 'busy') : 'ready';
    case 'PreToolUse': case 'PostToolUse': case 'PostToolUseFailure': case 'UserPromptSubmit':
    case 'PermissionRequest': case 'Elicitation': case 'ElicitationResult':
    case 'PreCompact': case 'PostCompact': return waiting ? 'needs-input' : 'busy';
    case 'Stop': return 'done';
    case 'StopFailure': return 'error';
    case 'SessionEnd': case 'SubagentStart': case 'SubagentStop': case 'Notification': return 'keep';
    default: return 'error';
  }
}
