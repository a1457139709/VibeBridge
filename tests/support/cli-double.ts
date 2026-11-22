import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';
import type { AgentType, WorkbenchEvent } from '../../app/shared/model';
import { statusOf } from './panel-views';
import { firstCapture } from './expected';
import { testNode } from './test-node';

export async function until(check: () => boolean, output?: () => string) {
  const deadline = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > deadline)
      throw new Error(`Timed out waiting for the CLI double${output ? `; output: ${JSON.stringify(output())}` : ''}`);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

function assertHooksCompleted(reply: string) {
  if (/HOOK-(FAILED|TIMEOUT):/.test(reply))
    throw new Error(`A hook did not complete; output: ${JSON.stringify(reply)}`);
}

export async function fixture(agent: AgentType, args: string[] = []) {
  const directory = await mkdtemp(resolve(`work/${agent}-reporter-'$-`));
  let workbench: Workbench;
  try {
    workbench = await Workbench.open(directory);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
  const close = async () => {
    try {
      await workbench.quit();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.runs.acknowledgeOutput(event.runId, event.data.length);
  });
  const output = (id: string) => events.flatMap(e => (e.kind === 'output' && e.runId === id ? [e.data] : [])).join('');
  const command = {
    command: testNode,
    args: [resolve(`tests/fixtures/${agent}-cli.cjs`), ...args],
  };
  try {
    await workbench.saveSettings({ agents: { ...workbench.snapshot().settings.agents, [agent]: command } });
  } catch (error) {
    await close();
    throw error;
  }
  let sequence = 0;
  return {
    workbench,
    directory,
    events,
    output,
    state: (runId: string) => statusOf(workbench.snapshot(), runId),
    async create(total = 1) {
      const created = await workbench.createProject({
        name: `${agent} reporter`,
        directory,
        total,
        counts: { codex: 0, claude: 0, pi: 0, [agent]: total },
      });
      for (const { run } of created.launches) {
        await until(
          () => output(run.id).includes('CLI-DOUBLE-READY'),
          () => output(run.id),
        );
        assertHooksCompleted(output(run.id));
      }
      return created;
    },
    async send(runId: string, payload?: object, options: object = {}) {
      const id = ++sequence;
      const start = output(runId).length;
      await workbench.runs.input(runId, JSON.stringify({ id, payload, ...options }) + '\n');
      await until(
        () => output(runId).includes(`ACK:${id}\r\n`),
        () => output(runId).slice(start),
      );
      assertHooksCompleted(output(runId).slice(start));
    },
    async context(runId: string) {
      await this.send(runId, undefined, { context: true });
      return JSON.parse(firstCapture(output(runId), /CONTEXT:([^\r\n]+)/));
    },
    close,
  };
}
