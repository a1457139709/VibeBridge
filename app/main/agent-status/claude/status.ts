import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { reporterCommand, type Launch, type Outcome, type Payload, type PreparedLaunch, type StatusAdapter, type StatusInterpreter, type Transition } from '../adapter';

const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop',
  'Stop', 'StopFailure', 'Elicitation', 'ElicitationResult'];

/** Augment only the effective invocation settings. Lower layers, trust and policy
 * remain Claude's responsibility. Never rewrite a user's settings file.
 */
async function prepare({ command, directory, resourceDirectory }: Launch): Promise<PreparedLaunch> {
  const boundary = command.args.indexOf('--');
  const args = command.args.slice(0, boundary < 0 ? undefined : boundary);
  let settings: Record<string, unknown> = {};
  let value: string | undefined;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--settings') {
      value = args[++index];
      if (!value) throw new Error('Missing Claude settings');
    } else if (args[index].startsWith('--settings=')) value = args[index].slice(11);
  }
  if (value !== undefined) {
    settings = JSON.parse(value.trimStart().startsWith('{') ? value : await readFile(resolve(directory, value), 'utf8'));
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid Claude settings');
  }
  const existing = settings.hooks ?? {};
  if (typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Invalid Claude hooks');
  const hooks: Record<string, unknown> = { ...existing };
  const reporter = reporterCommand('claude-hook.cjs');
  for (const event of events) {
    const handlers = hooks[event] ?? [];
    if (!Array.isArray(handlers)) throw new Error('Invalid Claude hook handlers');
    hooks[event] = [...handlers, { hooks: [{ type: 'command', command: reporter, timeout: 3 }] }];
  }
  let merged = JSON.stringify({ ...settings, hooks });
  let cleanup: (() => Promise<void>) | undefined;
  if (value !== undefined && !value.trimStart().startsWith('{')) {
    // File settings can contain secrets. Preserve their file boundary rather
    // than exposing all contents to process argument inspection.
    const temporary = await mkdtemp(join(resolve(resourceDirectory), 'claude-status-'));
    cleanup = () => rm(temporary, { recursive: true, force: true });
    try {
      const file = join(temporary, 'settings.json');
      await writeFile(file, merged, { mode: 0o600, flag: 'wx' });
      merged = file;
    } catch (error) { await cleanup(); throw error; }
  }
  return { command: { ...command, args: [...args, '--settings', merged,
    ...(boundary < 0 ? [] : command.args.slice(boundary))] }, cleanup };
}

class ClaudeInterpreter implements StatusInterpreter {
  private session?: string;
  private retired = new Set<string>();
  private prompt?: string;
  private oldPrompts = new Set<string>();
  private seen = new Set<string>();
  private completedTools = new Set<string>();
  private activeTools = new Map<string, unknown>();
  private questions = new Set<string>();
  private permissions = new Set<string>();
  private elicitations = new Set<string>();

  accept(event: Payload): Outcome {
    if (event.observation === 'restored') return 'keep';
    if (event.observation === 'lost' || event.observation === 'unavailable') { this.activeTools.clear(); return 'error'; }
    if (event.agent_id || event.hook_event_name === 'SubagentStart' || event.hook_event_name === 'SubagentStop') return 'discard';
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return 'error';
    const known = this.identify(event, session);
    return known ? this.classify(known) : 'discard';
  }

  discardEvidence() { this.questions.clear(); this.permissions.clear(); this.elicitations.clear(); }

  /** Native identity checks run after capability authentication. Independent hook
   * processes cannot invent a shared sequence; only recognizable stale facts drop.
   */
  private identify(event: Payload, session: string): Payload | undefined {
    const name = event.hook_event_name;
    if (name === 'SessionStart') {
      if (this.retired.has(session) && event.source !== 'resume') return;
      if (this.session !== session) {
        if (this.session) this.retired.add(this.session);
        this.session = session;
        this.retired.delete(session);
        this.prompt = undefined;
        this.oldPrompts.clear();
        this.seen.clear();
        this.completedTools.clear();
        this.activeTools.clear();
      }
      return event;
    }
    if (this.retired.has(session) || (this.session && this.session !== session)) return;
    this.session ??= session;
    if (name === 'SessionEnd') {
      this.retired.add(session);
      this.session = undefined;
      return event;
    }
    const prompt = typeof event.prompt_id === 'string' ? event.prompt_id : undefined;
    if (prompt) {
      if (this.oldPrompts.has(prompt)) return;
      if (this.prompt && this.prompt !== prompt) {
        if (name !== 'UserPromptSubmit') return;
        this.oldPrompts.add(this.prompt);
      }
      this.prompt = prompt;
    }
    if (name === 'UserPromptSubmit' && prompt) {
      const key = JSON.stringify([session, name, prompt]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    if ((name === 'Elicitation' || name === 'ElicitationResult') && typeof event.elicitation_id === 'string' && event.elicitation_id) {
      const identity = [session, event.mcp_server_name, event.elicitation_id];
      const key = JSON.stringify([name, ...identity]);
      if (this.seen.has(key) || (name === 'Elicitation' && this.seen.has(JSON.stringify(['ElicitationResult', ...identity])))) return;
      this.seen.add(key);
    }
    if (typeof event.tool_use_id === 'string' && event.tool_use_id) {
      const tool = JSON.stringify([session, event.tool_use_id]);
      const key = JSON.stringify([session, name, event.tool_use_id]);
      if (this.seen.has(key) || (name === 'PreToolUse' && this.completedTools.has(tool))) return;
      this.seen.add(key);
      if (name === 'PreToolUse') this.activeTools.set(event.tool_use_id, event.tool_input_hash);
      if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
        this.completedTools.add(tool);
        this.activeTools.delete(event.tool_use_id);
      }
    }
    if (name === 'UserPromptSubmit' || name === 'Stop' || name === 'StopFailure') this.activeTools.clear();
    if (name === 'PermissionRequest' && !event.tool_use_id) {
      const candidates = typeof event.tool_input_hash === 'string'
        ? [...this.activeTools].filter(([, hash]) => hash === event.tool_input_hash) : [];
      // Never resolve an unidentified wait by tool name or by an ambiguous
      // input match. A later main-turn fact can still establish a fresh state.
      const { tool_input_hash: _hash, ...unidentified } = event;
      return candidates.length === 1 ? { ...unidentified, tool_use_id: candidates[0][0] } : unidentified;
    }
    return event;
  }

  private classify(event: Payload): Transition {
    const name = event.hook_event_name;
    const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
    const permission = tool ? `id:${tool}` : typeof event.tool_input_hash === 'string' ? `input:${event.tool_input_hash}` : '?';
    const elicitation = JSON.stringify([event.mcp_server_name ?? '', event.elicitation_id ?? '']);
    if (['UserPromptSubmit', 'Stop', 'StopFailure'].includes(String(name)) || (name === 'SessionStart' && event.source !== 'compact')) {
      this.discardEvidence();
    }
    if (name === 'PreToolUse' && event.tool_name === 'AskUserQuestion') this.questions.add(tool);
    if (name === 'PermissionRequest') this.permissions.add(permission);
    if (name === 'Elicitation') this.elicitations.add(elicitation);
    if (name === 'ElicitationResult') this.elicitations.delete(elicitation);
    if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
      if (tool || event.tool_name === 'AskUserQuestion') this.questions.delete(tool);
      if (tool) this.permissions.delete(`id:${tool}`);
      if (typeof event.tool_input_hash === 'string') this.permissions.delete(`input:${event.tool_input_hash}`);
    }
    const waiting = !!(this.questions.size || this.permissions.size || this.elicitations.size);
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
}

export const claude: StatusAdapter = { prepare, observe: () => new ClaudeInterpreter() };
