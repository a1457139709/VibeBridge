import { join } from 'node:path';
import { parse } from 'smol-toml';
import type { AgentCommand } from '../shared/model';

const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop', 'Stop', 'Interrupt'];

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${inline(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Add only session-layer handlers. Lower config layers remain Codex's responsibility;
 * command-line handlers are retained when our event arrays are appended to that layer.
 * Trust stays in Codex's native /hooks UI. The stable command contains no run secrets.
 */
export function codexLaunch(command: AgentCommand): AgentCommand {
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
  const reporter = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(join(__dirname, 'codex-hook.cjs'))}`;
  const added = events.flatMap(event => {
    const existing = hooks[event] ?? [];
    if (!Array.isArray(existing)) throw new Error('Invalid Codex hook handlers');
    return ['-c', `hooks.${event}=${inline([...existing, { hooks: [{ type: 'command', command: reporter, timeout: 3 }] }])}`];
  });
  // Native TUI must stay within the terminal host's run, not attach to a shared daemon.
  added.push('-c', 'features.daemon_auto_start=false');
  return { ...command, args: [...args, ...added, ...(boundary < 0 ? [] : command.args.slice(boundary))] };
}
