import { commandHook } from './command-hook';

// Prompts, transcripts and tool output can be large and are not needed for status.
commandHook('codex', raw => Object.fromEntries(['hook_event_name', 'session_id', 'source', 'turn_id', 'agent_id', 'agent_type',
  'tool_name', 'tool_use_id', 'permission_mode'].filter(key => key in raw).map(key => [key, raw[key]])));
