import test from 'node:test';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { Snapshot } from '../app/shared/model';
import { runsOf, storedProjects } from './support/panel-views';
import { testNode } from './support/test-node';
import { pidOf } from './support/expected';
import { killUnlessExited } from './support/process-cleanup';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
interface Ready {
  snapshot: Snapshot;
  host: number;
  orphan: number;
}
const isReady = (message: unknown): message is Ready =>
  typeof message === 'object' &&
  message !== null &&
  'snapshot' in message &&
  'host' in message &&
  typeof message.host === 'number' &&
  'orphan' in message &&
  typeof message.orphan === 'number';
async function until(check: () => boolean) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for lifecycle cleanup');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('a surviving terminal manager cleans all projects after main-process SIGKILL without harming an unrelated process', async () => {
  const directory = await mkdtemp(resolve('work/lifecycle-'));
  const main = fork(join(__dirname, 'workbench-process.cjs'), [directory], {
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const unrelated = spawn(testNode, [resolve('tests/fixtures/interactive.cjs'), 'orphan-child'], { stdio: 'ignore' });
  let pids: number[] = [];
  try {
    const { snapshot, host, orphan } = await new Promise<Ready>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Main fixture did not become ready')), 10000);
      main.once('message', message => {
        clearTimeout(timer);
        if (isReady(message)) resolve(message);
        else reject(new Error(`Main fixture sent ${JSON.stringify(message)}`));
      });
      main.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Main fixture exited early'));
      });
    });
    pids = [host, orphan, ...runsOf(snapshot).map(pidOf)];
    main.kill('SIGKILL');
    const started = Date.now();
    await until(() => pids.every(pid => !alive(pid)));
    console.log(`Main fault cleanup: ${Date.now() - started} ms`);
    assert.ok(unrelated.pid !== undefined && alive(unrelated.pid));
    assert.match(await readFile(join(directory, 'last-failure.json'), 'utf8'), /mainDisconnected/);
    const reopened = await Workbench.open(directory);
    try {
      assert.deepEqual(storedProjects(reopened.snapshot()), storedProjects(snapshot));
      assert.equal(reopened.snapshot().activeProjectId, snapshot.activeProjectId);
      assert.deepEqual(runsOf(reopened.snapshot()), []);
    } finally {
      await reopened.quit();
    }
  } finally {
    main.kill('SIGKILL');
    unrelated.kill('SIGKILL');
    for (const pid of pids) killUnlessExited(pid);
    await rm(directory, { recursive: true, force: true });
  }
});

test('quit requests termination before forcing a refusing run, and keeps its panel configuration', async () => {
  const directory = await mkdtemp(resolve('work/lifecycle-'));
  const workbench = await Workbench.open(directory);
  let output = '';
  workbench.subscribe(event => {
    if (event.kind === 'output') output += event.data;
  });
  try {
    const settings = workbench.snapshot().settings;
    const terminationFile = join(directory, 'termination.txt');
    settings.agents.codex = {
      command: testNode,
      args: [resolve('tests/fixtures/interactive.cjs'), '--termination-file', terminationFile],
    };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({
      name: 'Refusing run',
      directory,
      total: 1,
      counts: { codex: 1, claude: 0, pi: 0 },
    });
    const run = runsOf(workbench.snapshot())[0];
    await until(() => output.includes('READY:'));
    await workbench.runs.input(run.id, 'resist stream');
    await until(() => output.length >= 128 * 1024);
    const started = Date.now();
    await workbench.quit();
    const elapsed = Date.now() - started;
    assert.equal(await readFile(terminationFile, 'utf8'), 'TERM:received');
    assert.ok(output.length < 160 * 1024, 'quitting must not remove the output bound');
    assert.ok(elapsed >= 1900 && elapsed < 5000, `forced cleanup took ${elapsed} ms`);
    assert.equal(alive(pidOf(run)), false);
    const reopened = await Workbench.open(directory);
    try {
      assert.deepEqual(storedProjects(reopened.snapshot()), [project]);
    } finally {
      await reopened.quit();
    }
    console.log(`Refusing run cleanup: ${elapsed} ms`);
  } finally {
    await workbench.quit();
    await rm(directory, { recursive: true, force: true });
  }
});
