import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';
import type { AgentType, WorkbenchEvent } from '../../app/shared/model';

export async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the CLI double');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

/** A Workbench whose Agent runs tests/fixtures/<agent>-cli.cjs: a CLI double that loads
 * the launch's Status Reporter through the CLI's native mechanism and emits facts on request.
 */
export async function fixture(agent: AgentType, args: string[] = []) {
  const directory = await mkdtemp(resolve(`work/${agent}-reporter-'$-`));
  let workbench: Workbench;
  try { workbench = await Workbench.open(directory); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  const close = async () => { try { await workbench.quit(); } finally { await rm(directory, { recursive: true, force: true }); } };
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.acknowledgeOutput(event.runId, event.data.length);
  });
  const output = (id: string) => events.flatMap(e => e.kind === 'output' && e.runId === id ? [e.data] : []).join('');
  const command = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve(`tests/fixtures/${agent}-cli.cjs`), ...args] };
  try { await workbench.saveSettings({ agents: { ...workbench.snapshot().settings.agents, [agent]: command } }); }
  catch (error) { await close(); throw error; }
  let sequence = 0;
  return { workbench, directory, events, output,
    state: (runId: string) => workbench.snapshot().processing.runs[runId],
    async create(total = 1) {
      const created = await workbench.createProject({ name: `${agent} reporter`, directory, total,
        counts: { codex: 0, claude: 0, pi: 0, [agent]: total } });
      for (const { run } of created.launches) await until(() => output(run.id).includes('CLI-DOUBLE-READY'));
      return created;
    },
    /** Ask the CLI double to emit one native fact; options are its other per-message controls. */
    async send(runId: string, payload?: object, options: object = {}) {
      const id = ++sequence;
      await workbench.sendInput(runId, JSON.stringify({ id, payload, ...options }) + '\n');
      await until(() => output(runId).includes(`ACK:${id}\r\n`));
    },
    async context(runId: string) {
      await this.send(runId, undefined, { context: true });
      return JSON.parse(output(runId).match(/CONTEXT:([^\r\n]+)/)![1]);
    },
    close,
  };
}
