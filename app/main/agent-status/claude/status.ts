import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  reporterCommand,
  type Launch,
  type Outcome,
  type Payload,
  type PreparedLaunch,
  type StatusAdapter,
  type StatusInterpreter,
  type Transition,
} from '../adapter';

const events = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'StopFailure',
  'Elicitation',
  'ElicitationResult',
];

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
    settings = JSON.parse(
      value.trimStart().startsWith('{') ? value : await readFile(resolve(directory, value), 'utf8'),
    );
    if (!settings || typeof settings !== 'object' || Array.isArray(settings))
      throw new Error('Invalid Claude settings');
  }
  const existing = settings.hooks ?? {};
  if (typeof existing !== 'object' || Array.isArray(existing)) throw new Error('Invalid Claude hooks');
  const hooks: Record<string, unknown> = { ...existing };
  const reporter = reporterCommand('claude-reporter.cjs');
  for (const event of events) {
    const handlers = hooks[event] ?? [];
    if (!Array.isArray(handlers)) throw new Error('Invalid Claude hook handlers');
    hooks[event] = [...handlers, { hooks: [{ type: 'command', command: reporter, timeout: 3 }] }];
  }
  const settingsJson = JSON.stringify({ ...settings, hooks });
  let settingsArg = settingsJson;
  let cleanup: (() => Promise<void>) | undefined;
  if (value !== undefined && !value.trimStart().startsWith('{')) {
    const temporary = await mkdtemp(join(resolve(resourceDirectory), 'claude-status-'));
    cleanup = () => rm(temporary, { recursive: true, force: true });
    try {
      const file = join(temporary, 'settings.json');
      await writeFile(file, settingsJson, { mode: 0o600, flag: 'wx' });
      settingsArg = file;
    } catch (error) {
      await cleanup();
      throw error;
    }
  }
  return {
    command: {
      ...command,
      args: [...args, '--settings', settingsArg, ...(boundary < 0 ? [] : command.args.slice(boundary))],
    },
    cleanup,
  };
}

class ClaudeInterpreter implements StatusInterpreter {
  private currentSession: string | undefined;
  private sessionStartPromptId: string | undefined;
  private endedSessions = new Set<string>();
  private promptId: string | undefined;
  private oldPromptIds = new Set<string>();
  private seen = new Set<string>();
  private completedTools = new Set<string>();
  private activeTools = new Map<string, unknown>();
  private questions = new Set<string>();
  private permissions = new Set<string>();
  private elicitations = new Set<string>();

  accept(event: Payload): Outcome {
    if (event.agent_id || event.hook_event_name === 'SubagentStart' || event.hook_event_name === 'SubagentStop')
      return 'discard';
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return 'error';
    const admitted = this.admitEvent(event, session);
    return admitted ? this.classify(admitted) : 'discard';
  }

  discardEvidence() {
    this.clearWaits();
    this.activeTools.clear();
  }

  sessionId() {
    return this.currentSession;
  }

  private clearWaits() {
    this.questions.clear();
    this.permissions.clear();
    this.elicitations.clear();
  }

  private admitEvent(event: Payload, session: string): Payload | undefined {
    const name = event.hook_event_name;
    if (name === 'SessionStart') {
      if (this.endedSessions.has(session) && event.source !== 'resume') return;
      if (this.currentSession !== session) {
        if (this.currentSession) this.endedSessions.add(this.currentSession);
        this.currentSession = session;
        this.endedSessions.delete(session);
        this.promptId = undefined;
        this.oldPromptIds.clear();
        this.seen.clear();
        this.completedTools.clear();
        this.activeTools.clear();
      }
      if (event.source !== 'compact')
        this.sessionStartPromptId = typeof event.prompt_id === 'string' ? event.prompt_id : undefined;
      return event;
    }
    if (this.endedSessions.has(session) || (this.currentSession && this.currentSession !== session)) return;
    this.currentSession ??= session;
    if (name === 'SessionEnd') {
      if (this.sessionStartPromptId !== undefined && event.prompt_id === this.sessionStartPromptId) return event;
      this.endedSessions.add(session);
      this.currentSession = undefined;
      this.sessionStartPromptId = undefined;
      return event;
    }
    const promptId = typeof event.prompt_id === 'string' ? event.prompt_id : undefined;
    if (promptId) {
      if (this.oldPromptIds.has(promptId)) return;
      if (this.promptId && this.promptId !== promptId) {
        if (name !== 'UserPromptSubmit') return;
        this.oldPromptIds.add(this.promptId);
      }
      this.promptId = promptId;
    }
    if (name === 'UserPromptSubmit' && promptId) {
      const key = JSON.stringify([session, name, promptId]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    if (
      (name === 'Elicitation' || name === 'ElicitationResult') &&
      typeof event.elicitation_id === 'string' &&
      event.elicitation_id
    ) {
      const identity = [session, event.mcp_server_name, event.elicitation_id];
      const key = JSON.stringify([name, ...identity]);
      if (
        this.seen.has(key) ||
        (name === 'Elicitation' && this.seen.has(JSON.stringify(['ElicitationResult', ...identity])))
      )
        return;
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
      const candidates =
        typeof event.tool_input_hash === 'string'
          ? [...this.activeTools].filter(([, hash]) => hash === event.tool_input_hash)
          : [];
      const { tool_input_hash: _hash, ...unidentified } = event;
      return candidates.length === 1 ? { ...unidentified, tool_use_id: candidates[0][0] } : unidentified;
    }
    return event;
  }

  private classify(event: Payload): Transition {
    const name = event.hook_event_name;
    const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
    const permission = tool
      ? `id:${tool}`
      : typeof event.tool_input_hash === 'string'
        ? `input:${event.tool_input_hash}`
        : '?';
    const elicitation = JSON.stringify([event.mcp_server_name ?? '', event.elicitation_id ?? '']);
    if (
      ['UserPromptSubmit', 'Stop', 'StopFailure'].includes(String(name)) ||
      (name === 'SessionStart' && event.source !== 'compact')
    ) {
      this.clearWaits();
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
      case 'SessionStart':
        return event.source === 'compact' ? (waiting ? 'needs-input' : 'busy') : 'ready';
      case 'PreToolUse':
      case 'PostToolUse':
      case 'PostToolUseFailure':
      case 'UserPromptSubmit':
      case 'PermissionRequest':
      case 'Elicitation':
      case 'ElicitationResult':
      case 'PreCompact':
      case 'PostCompact':
        return waiting ? 'needs-input' : 'busy';
      case 'Stop':
        return Array.isArray(event.background_tasks) && event.background_tasks.some(task => task?.status === 'running')
          ? 'busy'
          : 'done';
      case 'StopFailure':
        return 'error';
      case 'SessionEnd':
      case 'SubagentStart':
      case 'SubagentStop':
        return 'keep';
      default:
        return 'error';
    }
  }
}

export const claude: StatusAdapter = { prepare, createInterpreter: () => new ClaudeInterpreter() };
