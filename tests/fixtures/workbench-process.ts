import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../../app/main/workbench';

void (async () => {
  const directory = process.argv[2];
  const workbench = await Workbench.open(directory);
  const settings = workbench.snapshot().settings;
  settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
  await workbench.saveSettings(settings);
  let output = '';
  workbench.subscribe(event => { if (event.kind === 'output') output += event.data; });
  await workbench.createProject({ name: 'First', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
  const second = resolve(directory, 'second');
  await mkdir(second);
  await workbench.createProject({ name: 'Second', directory: second, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
  const run = workbench.snapshot().runs[0];
  await workbench.sendInput(run.id, 'host orphan');
  const deadline = Date.now() + 5000;
  while (!/ORPHAN:(\d+)/.test(output)) {
    if (Date.now() > deadline) throw new Error('Fixture did not create orphan');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  process.send!({ snapshot: workbench.snapshot(), host: Number(output.match(/HOST:(\d+)/)![1]), orphan: Number(output.match(/ORPHAN:(\d+)/)![1]) });
})().catch(error => { console.error(error); process.exit(1); });
