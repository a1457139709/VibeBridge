import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface ProcessIdentity { pid: number; parent: number; started: string; owner?: string }
const execute = promisify(execFile);
export async function processTable(includeOwners = false): Promise<ProcessIdentity[]> {
  // macOS -E reads the launch environment, including inherited ownership after reparenting.
  // Only retain our marker; never log or send command lines or other environment values.
  const args = includeOwners ? ['-Eww', '-U', String(process.getuid!()), '-o', 'pid=,ppid=,lstart=,state=,command=']
    : ['-axo', 'pid=,ppid=,lstart=,state='];
  let stdout: string;
  try { ({ stdout } = await execute('/bin/ps', args, { timeout: 1000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } })); }
  catch { throw new Error('无法检查受管进程'); }
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(\S+)(.*)$/);
    if (!match || match[4].includes('Z')) return [];
    const owner = match[5].match(/(?:^|\s)VIBEBRIDGE_RUN_OWNER=([a-f0-9-]+:[a-f0-9-]+)(?:\s|$)/)?.[1];
    return [{ pid: Number(match[1]), parent: Number(match[2]), started: match[3], ...(owner ? { owner } : {}) }];
  });
}

export function descendants(table: ProcessIdentity[], known: ProcessIdentity[], owner?: string): ProcessIdentity[] {
  const result = table.filter(row => known.some(p => p.pid === row.pid && p.started === row.started)
    || (owner && (row.owner === owner || row.owner?.startsWith(`${owner}:`))));
  for (let size = -1; size !== result.length;) {
    size = result.length;
    for (const row of table) if (!result.some(p => p.pid === row.pid) && result.some(p => p.pid === row.parent)) result.push(row);
  }
  return result;
}

export async function stopProcesses(known: ProcessIdentity[], owner?: string, afterForce?: () => void): Promise<void> {
  const deadline = Date.now() + 2000;
  let remaining = descendants(await processTable(!!owner), known, owner);
  const signal = (processes: ProcessIdentity[], name: NodeJS.Signals) => {
    for (const processInfo of [...processes].reverse()) {
      try { process.kill(processInfo.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  };
  signal(remaining, 'SIGTERM');
  while (remaining.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 40));
    remaining = descendants(await processTable(!!owner), remaining, owner);
  }
  if (remaining.length) {
    signal(remaining, 'SIGKILL');
    afterForce?.();
    const forcedDeadline = Date.now() + 1000;
    while (remaining.length && Date.now() < forcedDeadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
      remaining = descendants(await processTable(!!owner), remaining, owner);
    }
  }
  if (remaining.length) throw new Error('部分受管进程未能在时限内结束');
}
