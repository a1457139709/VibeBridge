import { join } from 'node:path';
import type { AgentCommand } from '../shared/model';

export function piLaunch(command: AgentCommand): AgentCommand {
  const boundary = command.args.indexOf('--');
  const index = boundary < 0 ? command.args.length : boundary;
  return { ...command, args: [...command.args.slice(0, index), '--extension', join(__dirname, 'pi-extension.mjs'), ...command.args.slice(index)] };
}
