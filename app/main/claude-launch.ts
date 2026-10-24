import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentCommand } from '../shared/model';

const events = ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse',
  'PostToolUseFailure', 'PermissionRequest', 'PreCompact', 'PostCompact', 'SubagentStart', 'SubagentStop',
  'Stop', 'StopFailure', 'Elicitation', 'ElicitationResult'];
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Augment only the effective invocation settings. Lower layers, trust and policy
 * remain Claude's responsibility. Never rewrite a user's settings file.
 */
export async function claudeLaunch(command: AgentCommand, directory: string, resourceDirectory: string): Promise<{ command: AgentCommand; cleanup?: () => Promise<void> }> {
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
  const reporter = `ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} ${quote(join(__dirname, 'claude-hook.cjs'))}`;
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
