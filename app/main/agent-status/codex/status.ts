import { parse } from 'smol-toml';
import type { AgentCommand } from '../../../shared/model';
import {
  reporterCommand,
  type Outcome,
  type Payload,
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
  'PermissionRequest',
  'PreCompact',
  'PostCompact',
  'SubagentStart',
  'SubagentStop',
  'Stop',
  'Interrupt',
];

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}=${inline(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

function withReporterHooks(command: AgentCommand): AgentCommand {
  const hooks: Record<string, unknown> = {};
  const boundary = command.args.indexOf('--');
  const args = command.args.slice(0, boundary < 0 ? undefined : boundary);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const override =
      arg === '-c' || arg === '--config'
        ? args[++index]
        : arg.startsWith('--config=')
          ? arg.slice(9)
          : arg.startsWith('-c=')
            ? arg.slice(3)
            : arg.startsWith('-c')
              ? arg.slice(2)
              : undefined;
    if (!override || !/^\s*["']?hooks(?:["']?\s*[.=])/.test(override)) continue;
    const parsed = parse(override).hooks;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Codex hook override');
    Object.assign(hooks, parsed);
  }
  const reporter = reporterCommand('codex-reporter.cjs');
  const added = events.flatMap(event => {
    const existing = hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error('Invalid Codex hook handlers');
    return [
      '-c',
      `hooks.${event}=${inline([...existing, { hooks: [{ type: 'command', command: reporter, timeout: 3 }] }])}`,
    ];
  });
  added.push('-c', 'features.daemon_auto_start=false');
  return { ...command, args: [...args, ...added, ...(boundary < 0 ? [] : command.args.slice(boundary))] };
}

class CodexInterpreter implements StatusInterpreter {
  private currentSession: string | undefined;
  private endedSessions = new Set<string>();
  private turn: string | undefined;
  private oldTurns = new Set<string>();
  private seen = new Set<string>();
  private waits = new Set<string>();
  private unansweredAsyncQuestion = false;

  accept(event: Payload): Outcome {
    if (event.agent_id || event.hook_event_name === 'SubagentStart' || event.hook_event_name === 'SubagentStop')
      return 'discard';
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return 'error';
    const known = this.admitFacts(event, session);
    return known ? this.classify(known) : 'discard';
  }

  discardEvidence() {
    this.waits.clear();
    this.unansweredAsyncQuestion = false;
  }

  sessionId() {
    return this.currentSession;
  }

  private admitFacts(event: Payload, session: string): Payload | undefined {
    const name = event.hook_event_name;
    if (name === 'SessionStart') {
      if (this.currentSession !== session) {
        if (this.currentSession) this.endedSessions.add(this.currentSession);
        this.currentSession = session;
        this.endedSessions.delete(session);
        this.turn = undefined;
        this.oldTurns.clear();
        this.seen.clear();
      }
      return event;
    }
    if (this.endedSessions.has(session) || (this.currentSession && this.currentSession !== session)) return;
    this.currentSession ??= session;
    if (name === 'SessionEnd') {
      this.endedSessions.add(session);
      this.currentSession = undefined;
      this.turn = undefined;
      return event;
    }
    const turn = typeof event.turn_id === 'string' ? event.turn_id : undefined;
    if (turn) {
      if (this.oldTurns.has(turn)) return;
      if (this.turn !== turn) {
        if (this.turn) this.oldTurns.add(this.turn);
        this.turn = turn;
        this.waits.clear();
      }
      const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : undefined;
      if (tool) {
        const key = JSON.stringify([session, turn, name, tool]);
        if (this.seen.has(key)) return;
        this.seen.add(key);
      }
    }
    return event;
  }

  private classify(event: Payload): Transition {
    const name = event.hook_event_name;
    const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
    const interrupted = name === 'Interrupt' && typeof event.turn_id === 'string' && event.turn_id !== '';
    if (name === 'PermissionRequest' || (name === 'PreToolUse' && event.tool_name === 'request_user_input')) {
      this.waits.add(tool || (name === 'PreToolUse' ? 'request_user_input' : ''));
      return 'needs-input';
    }
    if (name === 'PostToolUse') {
      if (tool) this.waits.delete(tool);
      else if (event.tool_name === 'request_user_input') this.waits.delete('request_user_input');
    }
    const answered =
      name === 'UserPromptSubmit' || (name === 'SessionStart' && event.source !== 'compact') || interrupted;
    if (answered || name === 'Stop') this.waits.clear();
    if (answered) this.unansweredAsyncQuestion = false;
    if (name === 'PreToolUse' && event.tool_name === 'request_user_input_async') this.unansweredAsyncQuestion = true;
    const waiting = this.waits.size > 0 || this.unansweredAsyncQuestion;
    if (
      waiting &&
      (['PreToolUse', 'PostToolUse', 'PreCompact', 'PostCompact', 'Stop'].includes(String(name)) ||
        (name === 'SessionStart' && event.source === 'compact'))
    )
      return 'needs-input';
    switch (name) {
      case 'SessionStart':
        return event.source === 'compact'
          ? 'busy'
          : ['startup', 'resume', 'clear', 'fork'].includes(String(event.source))
            ? 'ready'
            : 'error';
      case 'UserPromptSubmit':
      case 'PostToolUse':
      case 'PreCompact':
      case 'PostCompact':
        return 'busy';
      case 'PreToolUse':
        return 'busy';
      case 'Stop':
        return 'done';
      case 'Interrupt':
        return interrupted ? 'ready' : 'keep';
      case 'SessionEnd':
      case 'SubagentStart':
      case 'SubagentStop':
        return 'keep';
      default:
        return 'error';
    }
  }
}

export const codex: StatusAdapter = {
  async prepare({ command }) {
    return { command: withReporterHooks(command) };
  },
  createInterpreter: () => new CodexInterpreter(),
};
