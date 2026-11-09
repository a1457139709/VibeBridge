import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';
import type { WorkbenchEvent } from '../../app/shared/model';

export async function until(check: () => boolean, timeout = 7000) {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the Workbench');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** A Workbench in its own data directory whose every Agent runs tests/fixtures/interactive.cjs. */
export async function interactiveWorkbench(scope: string) {
  const directory = await mkdtemp(resolve(`work/${scope}-`));
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => events.push(event));
  const settings = workbench.snapshot().settings;
  for (const agent of ['codex', 'claude', 'pi'] as const) settings.agents[agent] = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
  await workbench.saveSettings(settings);
  return { directory, workbench, events,
    output: (id: string) => events.filter(e => e.kind === 'output' && e.runId === id).map(e => e.kind === 'output' ? e.data : '').join(''),
    create: (name: string, path = directory, total = 1) => workbench.createProject({ name, directory: path, total, counts: { codex: total, claude: 0, pi: 0 } }),
    close: async () => { await workbench.quit(); await rm(directory, { recursive: true, force: true }); } };
}
