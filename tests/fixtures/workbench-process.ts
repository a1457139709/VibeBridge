import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';
import { runsOf } from '../support/panel-views';
import { testNode } from '../support/test-node';
import { firstCapture } from '../support/expected';

void (async () => {
  const directory = process.argv[2];
  const workbench = await Workbench.open(directory);
  const settings = workbench.snapshot().settings;
  settings.agents.codex = {
    command: testNode,
    args: [resolve('tests/fixtures/interactive.cjs')],
  };
  await workbench.saveSettings(settings);
  let output = '';
  workbench.subscribe(event => {
    if (event.kind === 'output') output += event.data;
  });
  await workbench.createProject({ name: 'First', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
  const second = resolve(directory, 'second');
  await mkdir(second);
  await workbench.createProject({
    name: 'Second',
    directory: second,
    total: 1,
    counts: { codex: 1, claude: 0, pi: 0 },
  });
  const run = runsOf(workbench.snapshot())[0];
  await workbench.runs.input(run.id, 'host orphan');
  const deadline = Date.now() + 5000;
  while (!/ORPHAN:(\d+)/.test(output)) {
    if (Date.now() > deadline) throw new Error('Fixture did not create orphan');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.ok(process.send, 'the fixture runs as a forked child');
  process.send({
    snapshot: workbench.snapshot(),
    host: Number(firstCapture(output, /HOST:(\d+)/)),
    orphan: Number(firstCapture(output, /ORPHAN:(\d+)/)),
  });
})().catch(error => {
  console.error(error);
  process.exit(1);
});
