import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { WorkbenchEvent } from '../app/shared/model';

// File-based Claude settings give each launch its own resource directory, removed exactly
// when the workbench forgets that run's observation. Counting them observes cleanup.
async function until(check: () => boolean | Promise<boolean>, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for run cleanup');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function fixture() {
  const directory = await mkdtemp(resolve('work/run-supervision-'));
  await writeFile(join(directory, 'private-settings.json'), '{}');
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => {
    events.push(event);
    if (event.kind === 'output') workbench.acknowledgeOutput(event.runId, event.data.length);
  });
  const claude = (command = process.env.VIBEBRIDGE_TEST_NODE!) => ({ command, args: [resolve('tests/fixtures/interactive.cjs'), '--settings', './private-settings.json'] });
  await workbench.saveSettings({ agents: { ...workbench.snapshot().settings.agents, claude: claude() } });
  const output = (id: string) => events.flatMap(e => e.kind === 'output' && e.runId === id ? [e.data] : []).join('');
  return { directory, workbench, output, claude,
    resources: async () => (await readdir(directory)).filter(name => name.startsWith('claude-status-')).length,
    async create(total = 1) {
      const created = await workbench.createProject({ name: 'Run supervision', directory, total, counts: { codex: 0, claude: total, pi: 0 } });
      for (const { run } of created.launches) await until(() => output(run.id).includes('READY:'));
      return created;
    },
    async host(runId: string) {
      await workbench.sendInput(runId, 'host');
      await until(() => /HOST:(\d+)/.test(output(runId)));
      return Number(output(runId).match(/HOST:(\d+)/)![1]);
    },
    close: async () => { await workbench.quit().catch(() => {}); await rm(directory, { recursive: true, force: true }); } };
}

test('a run releases its observation when it exits on its own or the workbench stops it', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run: exiting }] } = await f.create(3);
    assert.equal(await f.resources(), 3);
    await f.workbench.sendInput(exiting.id, 'exit');
    await until(async () => await f.resources() === 2);
    const target = join(f.directory, 'target');
    await mkdir(target);
    await writeFile(join(target, 'private-settings.json'), '{}');
    const restarted = await f.workbench.editProject(project.id, { name: project.name, directory: target }, true);
    assert.equal(restarted.launches.length, 2);
    await until(async () => await f.resources() === 2);
  } finally { await f.close(); }
});

test('closing, withdrawing and deleting panels release their runs\' observations', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create(2);
    await f.workbench.closePanel(project.id, run.panelId);
    await until(async () => await f.resources() === 1);
    await f.workbench.saveSettings({ agents: { ...f.workbench.snapshot().settings.agents, claude: f.claude('/no-such-agent') } });
    const failed = await f.workbench.addPanel(project.id, 'claude');
    assert.equal(failed.launch.ok, false);
    assert.equal(f.workbench.snapshot().projects[0].panels.length, 1);
    await until(async () => await f.resources() === 1);
    await f.workbench.deleteProject(project.id);
    await until(async () => await f.resources() === 0);
  } finally { await f.close(); }
});

test('a terminal host failure releases every run\'s observation, including launches attempted afterwards', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create(2);
    process.kill(await f.host(run.id), 'SIGKILL');
    await until(() => f.workbench.snapshot().runs.every(item => item.state === 'stopped'));
    await until(async () => await f.resources() === 0);
    const late = await f.workbench.addPanel(project.id, 'claude');
    assert.equal(late.launch.ok, false);
    await until(async () => await f.resources() === 0);
    assert.notEqual(f.workbench.snapshot().runs.find(item => item.id === late.launch.run.id)?.state, 'starting');
  } finally { await f.close(); }
});

test('an unconfirmed launch keeps its observation until the run later exits, and quitting releases the rest', { timeout: 40000 }, async () => {
  const f = await fixture();
  let host: number | undefined;
  try {
    const { project, launches: [{ run: first }] } = await f.create();
    host = await f.host(first.id);
    process.kill(host, 'SIGSTOP');
    const pending = await f.workbench.addPanel(project.id, 'claude');
    assert.match(pending.launch.ok ? '' : pending.launch.error, /launchUnconfirmed/);
    assert.equal(await f.resources(), 2, 'an unconfirmed launch may still be running');
    process.kill(host, 'SIGCONT'); host = undefined;
    await until(() => f.output(pending.launch.run.id).includes('READY:'));
    await f.workbench.sendInput(pending.launch.run.id, 'exit');
    await until(async () => await f.resources() === 1);
    await f.workbench.quit();
    assert.equal(await f.resources(), 0);
  } finally { if (host) process.kill(host, 'SIGCONT'); await f.close(); }
});
