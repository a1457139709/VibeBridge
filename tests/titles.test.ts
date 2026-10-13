import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { WorkbenchEvent } from '../app/shared/model';

async function until(check: () => boolean) {
  const deadline = Date.now() + 7000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for terminal title');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function fixture() {
  const directory = await mkdtemp(resolve('work/titles-'));
  const workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => events.push(event));
  const settings = workbench.snapshot().settings;
  settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/title-cli.cjs')] };
  await workbench.saveSettings(settings);
  return { directory, workbench, events,
    output: (id: string) => events.filter(e => e.kind === 'output' && e.runId === id).map(e => e.kind === 'output' ? e.data : '').join(''),
    emit: (runId: string, id: string, chunks: string[], delay = 0) => workbench.sendInput(runId, JSON.stringify({ id, chunks, delay }) + '\n'),
    close: async () => { await workbench.quit(); await rm(directory, { recursive: true, force: true }); } };
}

test('PTY OSC 0 titles survive chunk boundaries and retain their exact raw text and output', async () => {
  const f = await fixture();
  try {
    await f.workbench.createProject({ name: 'Titles', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const run = f.workbench.snapshot().runs[0];
    await until(() => f.output(run.id).includes('READY:'));
    const raw = ' ✳ raw title | project 👩🏽‍💻 ';
    const chunks = ['\x1b', ']0', '; ✳ raw', ' title | project 👩🏽‍💻 ', '\x07'];
    await f.emit(run.id, 'split', chunks, 25);
    await until(() => f.output(run.id).includes('DONE:split'));
    assert.equal(f.workbench.snapshot().runs[0].rawTitle, raw);
    assert.ok(f.output(run.id).includes(chunks.join('')), 'the original title bytes remain in terminal output');
    const long = '  ⠋ CLI status | ' + 'Long title with  spaces 👩🏽‍💻 '.repeat(80) + ' /some/directory  ';
    await f.emit(run.id, 'long', ['\x1b]2;' + long + '\x07']);
    await until(() => f.output(run.id).includes('DONE:long'));
    assert.equal(f.workbench.snapshot().runs[0].rawTitle, long);
  } finally { await f.close(); }
});

test('OSC 2 and OSC 0 update consecutively with split ST terminators while body text and other OSC commands never supply a title', async () => {
  const f = await fixture();
  try {
    await f.workbench.createProject({ name: 'Title changes', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const run = f.workbench.snapshot().runs[0];
    await until(() => f.output(run.id).includes('READY:'));
    const chunks = ['\x1b]2;◐ First | directory\x1b', '\\', '\x1b]0; Second \x07', '\x1b]2;\x1b', '\\', '\x1b]1;not-a-title\x1b', '\\', 'body mentions Claude Code and π - project', '\x1b]2;⠋ Final\x1b', '\\'];
    await f.emit(run.id, 'consecutive', chunks, 20);
    await until(() => f.output(run.id).includes('DONE:consecutive'));
    assert.equal(f.workbench.snapshot().runs[0].rawTitle, '⠋ Final');
    assert.deepEqual(f.events.filter(event => event.kind === 'title').map(event => event.kind === 'title' ? event.title : ''), ['◐ First | directory', ' Second ', '', '⠋ Final']);
    assert.ok(f.output(run.id).includes(chunks.join('')));
  } finally { await f.close(); }
});

test('titles stay with their running instance, reset on directory restart and never survive workbench reopen', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.workbench.createProject({ name: 'Isolated titles', directory: f.directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const [first, second] = f.workbench.snapshot().runs;
    await until(() => [first, second].every(run => f.output(run.id).includes('READY:')));
    await f.emit(first.id, 'first', ['\x1b]0;First\x07']);
    await f.emit(second.id, 'second', ['\x1b]2;Second\x1b\\']);
    await until(() => f.output(first.id).includes('DONE:first') && f.output(second.id).includes('DONE:second'));
    assert.deepEqual(f.workbench.snapshot().runs.map(run => run.rawTitle), ['First', 'Second']);
    await f.workbench.sendInput(first.id, JSON.stringify({ id: 'termination', onTerminate: 'Old run late title' }) + '\n');
    await until(() => f.output(first.id).includes('DONE:termination'));
    const result = await f.workbench.editProject(project.id, { name: project.name, directory: target }, true);
    const current = result.launches.map(launch => launch.run);
    await until(() => current.every(run => f.output(run.id).includes('READY:')));
    assert.ok(f.output(first.id).includes('Old run late title'), 'old CLI emitted during controlled cleanup');
    assert.ok(f.workbench.snapshot().runs.every(run => run.rawTitle === undefined && run.id !== first.id && run.id !== second.id));
    await f.emit(current[0].id, 'new', ['\x1b]2;New run title\x07']);
    await until(() => f.output(current[0].id).includes('DONE:new'));
    assert.equal(f.workbench.snapshot().runs.find(run => run.id === current[0].id)!.rawTitle, 'New run title');
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(reopened.snapshot().runs, []);
      await reopened.activateProject(project.id);
      assert.ok(reopened.snapshot().runs.every(run => run.rawTitle === undefined));
      assert.deepEqual(reopened.snapshot().projects[0].panels, project.panels);
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('a delayed genuine start replaces the uncertain starting run and then accepts only its own raw title', async () => {
  const f = await fixture(); let host: number | undefined;
  try {
    const secondDirectory = join(f.directory, 'second'); await mkdir(secondDirectory);
    await f.workbench.createProject({ name: 'Existing', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const first = f.workbench.snapshot().runs[0];
    await until(() => f.output(first.id).includes('READY:'));
    await f.workbench.sendInput(first.id, JSON.stringify({ id: 'host', host: true, chunks: ['\x1b]2;Existing title\x07'] }) + '\n');
    await until(() => /HOST:(\d+)/.test(f.output(first.id)));
    host = Number(f.output(first.id).match(/HOST:(\d+)/)![1]);
    const settings = f.workbench.snapshot().settings;
    settings.agents.codex.args.push('--initial-title', ' Late title | raw ');
    await f.workbench.saveSettings(settings);
    process.kill(host, 'SIGSTOP');
    const created = await f.workbench.createProject({ name: 'Delayed', directory: secondDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const pending = created.launches[0].run;
    assert.equal(pending.state, 'starting'); assert.equal(pending.rawTitle, undefined);
    process.kill(host, 'SIGCONT'); host = undefined;
    await until(() => f.workbench.snapshot().runs.some(run => run.id === pending.id && run.rawTitle === ' Late title | raw '));
    assert.equal(f.workbench.snapshot().runs.find(run => run.id === pending.id)!.state, 'running');
    assert.equal(f.workbench.snapshot().runs.find(run => run.id === first.id)!.rawTitle, 'Existing title');
  } finally { if (host) process.kill(host, 'SIGCONT'); await f.close(); }
});
