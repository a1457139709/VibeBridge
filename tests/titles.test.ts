import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import { sessionTitle } from '../app/main/session-title';
import type { WorkbenchEvent } from '../app/shared/model';
import { runsOf, showing, statusOf, storedProjects } from './support/panel-views';

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

test('PTY OSC 0 titles survive chunk boundaries into the session title while output keeps their exact bytes', async () => {
  const f = await fixture();
  try {
    await f.workbench.createProject({ name: 'Titles', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const run = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(run.id).includes('READY:'));
    const raw = ' ✳ raw title | project 👩🏽‍💻 ';
    const chunks = ['\x1b', ']0', '; ✳ raw', ' title | project 👩🏽‍💻 ', '\x07'];
    await f.emit(run.id, 'split', chunks, 25);
    await until(() => f.output(run.id).includes('DONE:split'));
    assert.equal(runsOf(f.workbench.snapshot())[0].title, '✳ raw title');
    assert.ok(f.output(run.id).includes(chunks.join('')), 'the original title bytes remain in terminal output');
    const long = '  ⠋ ' + 'Long title with  spaces 👩🏽‍💻 '.repeat(80) + '| /some/directory  ';
    await f.emit(run.id, 'long', ['\x1b]2;' + long + '\x07']);
    await until(() => f.output(run.id).includes('DONE:long'));
    assert.equal(runsOf(f.workbench.snapshot())[0].title, 'Long title with  spaces 👩🏽‍💻 '.repeat(80).trim());
  } finally { await f.close(); }
});

test('OSC 2 and OSC 0 publish each session title change once, with split ST terminators, while body text and other OSC commands never supply a title', async () => {
  const f = await fixture();
  try {
    await f.workbench.createProject({ name: 'Title changes', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const run = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(run.id).includes('READY:'));
    const chunks = ['\x1b]2;◐ First | directory\x1b', '\\', '\x1b]0; Second | directory \x07', '\x1b]2;\x1b', '\\', '\x1b]1;not-a-title\x1b', '\\', 'body mentions Claude Code and π - project', '\x1b]2;⠋ Final | directory\x1b', '\\', '\x1b]0;⠙ Final | directory\x07', '\x1b]2;⠹ Final | directory \x07'];
    const from = f.events.length;
    await f.emit(run.id, 'consecutive', chunks, 20);
    await until(() => f.output(run.id).includes('DONE:consecutive'));
    assert.equal(runsOf(f.workbench.snapshot())[0].title, 'Final');
    assert.deepEqual(f.events.slice(from).flatMap(event => event.kind === 'snapshot' ? [runsOf(event.snapshot)[0].title] : []), ['◐ First', 'Second', undefined, 'Final']);
    assert.ok(f.output(run.id).includes(chunks.join('')));
  } finally { await f.close(); }
});

test('titles stay with their running instance, reset on directory restart and never survive workbench reopen', async () => {
  const f = await fixture();
  try {
    const target = join(f.directory, 'target'); await mkdir(target);
    const { project } = await f.workbench.createProject({ name: 'Isolated titles', directory: f.directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const [first, second] = runsOf(f.workbench.snapshot());
    await until(() => [first, second].every(run => f.output(run.id).includes('READY:')));
    await f.emit(first.id, 'first', ['\x1b]0;First | directory\x07']);
    await f.emit(second.id, 'second', ['\x1b]2;Second | directory\x1b\\']);
    await until(() => f.output(first.id).includes('DONE:first') && f.output(second.id).includes('DONE:second'));
    assert.deepEqual(runsOf(f.workbench.snapshot()).map(run => run.title), ['First', 'Second']);
    await f.workbench.sendInput(first.id, JSON.stringify({ id: 'termination', onTerminate: 'Old run late title' }) + '\n');
    await until(() => f.output(first.id).includes('DONE:termination'));
    const result = await f.workbench.editProject(project.id, { name: project.name, directory: target }, true);
    const current = result.launches.map(launch => launch.run);
    await until(() => current.every(run => f.output(run.id).includes('READY:')));
    assert.ok(f.output(first.id).includes('Old run late title'), 'old CLI emitted during controlled cleanup');
    assert.ok(runsOf(f.workbench.snapshot()).every(run => run.title === undefined && run.id !== first.id && run.id !== second.id));
    await f.emit(current[0].id, 'new', ['\x1b]2;New run title | target\x07']);
    await until(() => f.output(current[0].id).includes('DONE:new'));
    assert.equal(runsOf(f.workbench.snapshot()).find(run => run.id === current[0].id)!.title, 'New run title');
    await f.workbench.quit();
    const reopened = await Workbench.open(f.directory);
    try {
      assert.deepEqual(runsOf(reopened.snapshot()), []);
      await reopened.activateProject(project.id);
      assert.ok(runsOf(reopened.snapshot()).every(run => run.title === undefined));
      assert.deepEqual(storedProjects(reopened.snapshot())[0].panels, project.panels);
    } finally { await reopened.quit(); }
  } finally { await f.close(); }
});

test('a delayed genuine start replaces the uncertain starting run and then accepts only its own session title', async () => {
  const f = await fixture(); let host: number | undefined;
  try {
    const secondDirectory = join(f.directory, 'second'); await mkdir(secondDirectory);
    await f.workbench.createProject({ name: 'Existing', directory: f.directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const first = runsOf(f.workbench.snapshot())[0];
    await until(() => f.output(first.id).includes('READY:'));
    await f.workbench.sendInput(first.id, JSON.stringify({ id: 'host', host: true, chunks: ['\x1b]2;Existing title | directory\x07'] }) + '\n');
    await until(() => /HOST:(\d+)/.test(f.output(first.id)));
    host = Number(f.output(first.id).match(/HOST:(\d+)/)![1]);
    const settings = f.workbench.snapshot().settings;
    settings.agents.codex.args.push('--initial-title', ' Late title | raw ');
    await f.workbench.saveSettings(settings);
    process.kill(host, 'SIGSTOP');
    const created = await f.workbench.createProject({ name: 'Delayed', directory: secondDirectory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const pending = created.launches[0].run;
    assert.equal(pending.state, 'starting'); assert.equal(pending.title, undefined);
    assert.equal(statusOf(f.workbench.snapshot(), pending.id), undefined);
    assert.deepEqual(showing(f.workbench.snapshot(), created.project.id, 'error'), []);
    process.kill(host, 'SIGCONT'); host = undefined;
    await until(() => runsOf(f.workbench.snapshot()).some(run => run.id === pending.id && run.title === 'Late title'));
    assert.equal(runsOf(f.workbench.snapshot()).find(run => run.id === pending.id)!.state, 'running');
    assert.equal(runsOf(f.workbench.snapshot()).find(run => run.id === first.id)!.title, 'Existing title');
  } finally { if (host) process.kill(host, 'SIGCONT'); await f.close(); }
});

test('session titles preserve meaningful text, filter known CLI decorations and retain ambiguous forms', () => {
  for (const [agent, raw, expected] of [
    ['claude', '✳ Claude Code', undefined], ['claude', '◐ Review  A ✳ B 👩🏽‍💻 ◑', 'Review  A ✳ B 👩🏽‍💻'],
    ['codex', '⠋ Respond to greeting | VibeBridge ⠹', 'Respond to greeting'], ['codex', 'VibeBridge', undefined],
    ['codex', 'name | | directory', 'name | | directory'], ['codex', ' | directory', '| directory'],
    ['pi', 'π - A', undefined], ['pi', 'π - Read  A + B 👩🏽‍💻 - directory', 'Read  A + B 👩🏽‍💻'],
    ['pi', 'π - A - B - C', 'π - A - B - C'], ['pi', 'Custom  π title ✳', 'Custom  π title ✳'],
  ] as const) assert.equal(sessionTitle(agent, raw), expected);
  for (const agent of ['claude', 'codex', 'pi'] as const) {
    assert.equal(sessionTitle(agent, ''), undefined); assert.equal(sessionTitle(agent, '   '), undefined);
  }
});
