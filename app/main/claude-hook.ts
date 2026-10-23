import { createHash } from 'node:crypto';
import { commandHook } from './command-hook';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

commandHook('claude', raw => {
  const payload = Object.fromEntries(['hook_event_name', 'session_id', 'source', 'prompt_id', 'agent_id',
    'tool_name', 'tool_use_id', 'mcp_server_name', 'elicitation_id'].filter(key => key in raw).map(key => [key, raw[key]]));
  // PermissionRequest omits tool_use_id. Match exact tool inputs without sending
  // commands, paths, answers or other tool content to the status module.
  if (typeof raw.tool_name === 'string' && raw.tool_input && typeof raw.tool_input === 'object') {
    payload.tool_input_hash = createHash('sha256').update(canonical([raw.tool_name, raw.tool_input])).digest('hex');
  }
  return payload;
});
