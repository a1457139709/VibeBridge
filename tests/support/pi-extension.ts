import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';
import type { WorkbenchEvent } from '../../app/shared/model';

export async function until(check: () => boolean) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for pi extension');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

export async function fixture(args: string[] = []) {
  const directory = await mkdtemp(resolve("work/pi-extension-'$-"));
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
  const command = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/pi-cli.cjs'), ...args] };
  try { await workbench.saveSettings({ agents: { ...workbench.snapshot().settings.agents, pi: command } }); }
  catch (error) { await close(); throw error; }
  let sequence = 0;
  return { workbench, directory, events, output,
    async create(total = 1) {
      const created = await workbench.createProject({ name: 'pi extensions', directory, total, counts: { codex: 0, claude: 0, pi: total } });
      for (const { run } of created.launches) await until(() => output(run.id).includes('PI-EXTENSION-READY'));
      return created;
    },
    async send(runId: string, payload?: object, options: object = {}) {
      const id = ++sequence;
      await workbench.sendInput(runId, JSON.stringify({ id, payload, ...options }) + '\n');
      await until(() => output(runId).includes(`ACK:${id}\r\n`));
    },
    close,
  };
}
