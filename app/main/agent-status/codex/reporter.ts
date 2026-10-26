import { reportCommandHook } from '../reporter';

// Prompts, transcripts and tool output can be large and are not needed for status.
reportCommandHook('codex', raw => Object.fromEntries(['hook_event_name', 'session_id', 'source', 'turn_id', 'agent_id',
  'tool_name', 'tool_use_id'].filter(key => key in raw).map(key => [key, raw[key]])));
