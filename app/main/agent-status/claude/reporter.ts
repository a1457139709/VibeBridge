import { createHash } from 'node:crypto';
import { runCommandHookReporter } from '../reporter';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

runCommandHookReporter('claude', raw => {
  const payload = Object.fromEntries(
    [
      'hook_event_name',
      'session_id',
      'source',
      'prompt_id',
      'agent_id',
      'tool_name',
      'tool_use_id',
      'mcp_server_name',
      'elicitation_id',
    ]
      .filter(key => key in raw)
      .map(key => [key, raw[key]]),
  );
  if (typeof raw.tool_name === 'string' && raw.tool_input && typeof raw.tool_input === 'object') {
    payload.tool_input_hash = createHash('sha256')
      .update(canonical([raw.tool_name, raw.tool_input]))
      .digest('hex');
  }
  if (Array.isArray(raw.background_tasks)) {
    payload.background_tasks = raw.background_tasks.map(task =>
      task && typeof task === 'object'
        ? {
            type: typeof task.type === 'string' ? task.type : undefined,
            status: typeof task.status === 'string' ? task.status : undefined,
          }
        : {},
    );
  }
  return payload;
});
