import { runCommandHookReporter } from '../reporter';

runCommandHookReporter('codex', raw =>
  Object.fromEntries(
    ['hook_event_name', 'session_id', 'source', 'turn_id', 'agent_id', 'tool_name', 'tool_use_id']
      .filter(key => key in raw)
      .map(key => [key, raw[key]]),
  ),
);
