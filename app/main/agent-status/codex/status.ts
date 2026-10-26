import { parse } from 'smol-toml';
import type { AgentCommand } from '../../../shared/model';
import { reporterCommand, type Outcome, type Payload, type StatusAdapter, type StatusInterpreter, type Transition } from '../adapter';

const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${inline(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

/** Add only session-layer handlers. Lower config layers remain Codex's responsibility;
 * command-line handlers are retained when our event arrays are appended to that layer.
 * Trust stays in Codex's native /hooks UI. The stable command contains no run secrets.
 */
function launch(command: AgentCommand): AgentCommand {
  const hooks: Record<string, unknown> = {};
  const boundary = command.args.indexOf('--');
  const args = command.args.slice(0, boundary < 0 ? undefined : boundary);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const override = arg === '-c' || arg === '--config' ? args[++index]
      : arg.startsWith('--config=') ? arg.slice(9) : arg.startsWith('-c=') ? arg.slice(3) : arg.startsWith('-c') ? arg.slice(2) : undefined;
    if (!override || !/^\s*["']?hooks(?:["']?\s*[.=])/.test(override)) continue;
    const parsed = parse(override).hooks;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid Codex hook override');
    Object.assign(hooks, parsed);
  }
  const reporter = reporterCommand('codex-reporter.cjs');
  const added = events.flatMap(event => {
    const existing = hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error('Invalid Codex hook handlers');
    return ['-c', `hooks.${event}=${inline([...existing, { hooks: [{ type: 'command', command: reporter, timeout: 3 }] }])}`];
  });
  // Native TUI must stay within the terminal host's run, not attach to a shared daemon.
  added.push('-c', 'features.daemon_auto_start=false');
  return { ...command, args: [...args, ...added, ...(boundary < 0 ? [] : command.args.slice(boundary))] };
}

class CodexInterpreter implements StatusInterpreter {
  private session?: string;
  private retired = new Set<string>();
  private turn?: string;
  private oldTurns = new Set<string>();
  private seen = new Set<string>();
  private waits = new Set<string>();

  accept(event: Payload): Outcome {
    if (event.agent_id || event.hook_event_name === 'SubagentStart' || event.hook_event_name === 'SubagentStop') return 'discard';
    const session = event.session_id;
    if (typeof session !== 'string' || !session) return 'error';
    const known = this.identify(event, session);
    return known ? this.classify(known) : 'discard';
  }

  discardEvidence() { this.waits.clear(); }

  /** Interpret identity only after the outer run capability was authenticated.
   * No receipt-time sequence is invented: only identifiable retired sessions,
   * turns and repeated source boundaries can be excluded.
   */
  private identify(event: Payload, session: string): Payload | undefined {
    const name = event.hook_event_name;
    if (name === 'SessionStart') {
      if (this.session !== session) {
        if (this.session) this.retired.add(this.session);
        this.session = session;
        this.retired.delete(session);
        this.turn = undefined;
        this.oldTurns.clear();
        this.seen.clear();
      }
      return event;
    }
    if (this.retired.has(session) || (this.session && this.session !== session)) return;
    // A user may trust hooks after startup. A fresh main event can establish the
    // association; directory, session ID and parent ID never authorize a run.
    this.session ??= session;
    if (name === 'SessionEnd') {
      this.retired.add(session);
      this.session = undefined;
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
      // Stop hooks can request continuation and submit again within a turn.
      // A turn ID alone is not a unique event ID.
      if (tool) {
        const key = JSON.stringify([session, turn, name, tool]);
        if (this.seen.has(key)) return;
        this.seen.add(key);
      }
    }
    // Native Interrupt is root-only and dispatched after detaching the active
    // turn. Generic reports still require explicit confirmation annotations.
    if (name === 'Interrupt' && turn) return { ...event, confirmed: true, can_accept_input: true };
    return event;
  }

  private classify(event: Payload): Transition {
    const name = event.hook_event_name;
    const tool = typeof event.tool_use_id === 'string' ? event.tool_use_id : '';
    // The native handler awaits the answer in every mode; Plan-only blocking just disables auto-resolution.
    if (name === 'PermissionRequest' || (name === 'PreToolUse' && event.tool_name === 'request_user_input')) {
      this.waits.add(tool || (name === 'PreToolUse' ? 'request_user_input' : ''));
      return 'needs-input';
    }
    if (name === 'PostToolUse' || name === 'PostToolUseFailure') {
      if (tool) this.waits.delete(tool);
      else if (event.tool_name === 'request_user_input') this.waits.delete('request_user_input');
    }
    if (['UserPromptSubmit', 'Stop'].includes(String(name))
      || (name === 'SessionStart' && event.source !== 'compact')
      || (name === 'Interrupt' && event.confirmed === true && event.can_accept_input === true)) this.waits.clear();
    if (this.waits.size && ['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PostCompact'].includes(String(name))) return 'needs-input';
    switch (name) {
      case 'SessionStart': return event.source === 'compact' ? 'busy'
        : ['startup', 'resume', 'clear', 'fork'].includes(String(event.source)) ? 'ready' : 'error';
      case 'UserPromptSubmit': case 'PostToolUse': case 'PostToolUseFailure':
      case 'PreCompact': case 'PostCompact': return 'busy';
      case 'PreToolUse': return 'busy';
      case 'Stop': return 'done';
      case 'Interrupt': return event.confirmed === true && event.can_accept_input === true ? 'ready' : 'keep';
      case 'SessionEnd': case 'SubagentStart': case 'SubagentStop': case 'Notification': return 'keep';
      default: return 'error';
    }
  }
}

export const codex: StatusAdapter = {
  async prepare({ command }) { return { command: launch(command) }; },
  observe: () => new CodexInterpreter(),
};
