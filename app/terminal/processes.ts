import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export interface ProcessIdentity { pid: number; parent: number; started: string }
const execute = promisify(execFile);
export async function processTable(): Promise<ProcessIdentity[]> {
  const { stdout } = await execute('/bin/ps', ['-axo', 'pid=,ppid=,lstart='], { timeout: 1000, maxBuffer: 4 * 1024 * 1024 });
  return stdout.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    return match ? [{ pid: Number(match[1]), parent: Number(match[2]), started: match[3] }] : [];
  });
}

export function descendants(table: ProcessIdentity[], known: ProcessIdentity[]): ProcessIdentity[] {
  const result = table.filter(row => known.some(p => p.pid === row.pid && p.started === row.started));
  for (let size = -1; size !== result.length;) {
    size = result.length;
    for (const row of table) if (!result.some(p => p.pid === row.pid) && result.some(p => p.pid === row.parent)) result.push(row);
  }
  return result;
}

export async function stopProcesses(known: ProcessIdentity[]): Promise<void> {
  const deadline = Date.now() + 2000;
  let remaining = descendants(await processTable(), known);
  const signal = (processes: ProcessIdentity[], name: NodeJS.Signals) => {
    for (const processInfo of [...processes].reverse()) {
      try { process.kill(processInfo.pid, name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
  };
  signal(remaining, 'SIGTERM');
  while (remaining.length && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 40));
    remaining = descendants(await processTable(), remaining);
  }
  if (remaining.length) {
    signal(remaining, 'SIGKILL');
    const forcedDeadline = Date.now() + 1000;
    while (remaining.length && Date.now() < forcedDeadline) {
      await new Promise(resolve => setTimeout(resolve, 40));
      remaining = descendants(await processTable(), remaining);
    }
  }
  if (remaining.length) throw new Error('部分受管进程未能在时限内结束');
}
