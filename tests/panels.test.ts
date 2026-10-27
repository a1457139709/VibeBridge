import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Workbench } from '../app/main/workbench';
import type { Snapshot, WorkbenchEvent } from '../app/shared/model';
import { layoutBoxes } from '../app/shared/layout';

async function until(check: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for panel operation');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

test('adding and closing a panel preserve unrelated regions, existing runs and the saved arrangement', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  const events: WorkbenchEvent[] = [];
  workbench.subscribe(event => events.push(event));
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Panels', directory, total: 3, counts: { codex: 3, claude: 0, pi: 0 } });
    const originalRuns = workbench.snapshot().runs;
    const layout = { axis: 'column' as const, ratio: 0.7, first: { panel: project.panels[1].id },
      second: { axis: 'row' as const, ratio: 0.35, first: { panel: project.panels[2].id }, second: { panel: project.panels[0].id } } };
    await workbench.saveLayout(project.id, layout);
    const added = await workbench.addPanel(project.id, 'codex');
    assert.equal(added.launch.outcome, 'started');
    const after = workbench.snapshot();
    assert.deepEqual(after.runs.filter(run => run.id !== added.launch.run.id), originalRuns);
    const expanded = after.projects[0].layout;
    assert.ok(expanded && !('panel' in expanded));
    assert.equal(expanded.axis, layout.axis);
    assert.equal(expanded.ratio, layout.ratio);
    assert.deepEqual(expanded.second, layout.second);
    const output = (id: string) => events.filter(e => e.kind === 'output' && e.runId === id).map(e => e.kind === 'output' ? e.data : '').join('');
    await until(() => after.runs.every(run => output(run.id).includes('READY:')));
    await workbench.sendInput(originalRuns[1].id, 'after-layout');
    await until(() => output(originalRuns[1].id).includes('INPUT:after-layout'));
    assert.ok(after.runs.filter(run => run.id !== originalRuns[1].id).every(run => !output(run.id).includes('after-layout')));
    await workbench.sendInput(added.launch.run.id, 'child');
    await until(() => /CHILD:(\d+)/.test(output(added.launch.run.id)));
    const childPid = Number(output(added.launch.run.id).match(/CHILD:(\d+)/)![1]);
    await workbench.closePanel(project.id, added.panel.id);
    assert.throws(() => process.kill(childPid, 0));
    assert.throws(() => process.kill(added.launch.run.pid!, 0));
    await assert.rejects(workbench.sendInput(added.launch.run.id, 'stale'), /runInvalid/);
    assert.deepEqual(workbench.snapshot().projects[0].layout, layout);
    assert.deepEqual(workbench.snapshot().runs, originalRuns);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects[0], { ...project, layout });
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('normal and abnormal run exits remove panels', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    // A successfully spawned CLI can exit before the caller receives its launch result.
    settings.agents.claude = { command: '/usr/bin/false', args: [] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Empty project', directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const old = workbench.snapshot().runs[0];
    await workbench.closePanel(project.id, project.panels[0].id);
    assert.equal(workbench.snapshot().projects[0].layout, null);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    await workbench.activateProject(project.id);
    assert.deepEqual(workbench.snapshot().projects[0].panels, []);
    assert.deepEqual(workbench.snapshot().runs, []);
    const events: WorkbenchEvent[] = [];
    workbench.subscribe(event => events.push(event));
    const added = await workbench.addPanel(project.id, 'codex');
    assert.notEqual(added.launch.run.id, old.id);
    await until(() => events.some(e => e.kind === 'output' && e.runId === added.launch.run.id && e.data.includes('READY:')));
    await assert.rejects(workbench.sendInput(old.id, 'old-input'), /runInvalid/);
    await workbench.sendInput(added.launch.run.id, 'exit');
    await until(() => workbench.snapshot().projects[0].panels.length === 0);
    const abnormal = await workbench.addPanel(project.id, 'claude');
    assert.equal(abnormal.launch.outcome, 'started');
    await until(() => workbench.snapshot().projects[0].panels.length === 0);
    await assert.rejects(workbench.sendInput(abnormal.launch.run.id, 'old-input'), /runInvalid/);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('quitting the Workbench preserves panels and layout', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    await workbench.createProject({ name: 'Quit', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const [project] = workbench.snapshot().projects;
    assert.equal(project.panels.length, 2);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, [project]);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('an added panel whose Agent cannot start is withdrawn, and adding succeeds once the command is fixed', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    settings.agents.pi = { command: '/no-such-agent', args: [] };
    await workbench.saveSettings(settings);
    let output = '';
    workbench.subscribe(event => { if (event.kind === 'output') output += event.data; });
    await workbench.createProject({ name: 'Withdraw', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    const before = workbench.snapshot();
    const snapshots: Snapshot[] = [];
    workbench.subscribe(event => { if (event.kind === 'snapshot') snapshots.push(event.snapshot); });
    const failed = await workbench.addPanel(before.projects[0].id, 'pi');
    assert.equal(failed.launch.outcome, 'failed');
    const after = workbench.snapshot();
    assert.deepEqual(after.projects, before.projects);
    assert.deepEqual(after.runs, before.runs);
    assert.deepEqual(snapshots.at(-1)!.projects, before.projects);
    assert.equal(after.processing.runs[failed.launch.run.id], undefined);
    assert.deepEqual(after.processing.projects, before.processing.projects);
    await until(() => output.includes('READY:'));
    await workbench.sendInput(before.runs[1].id, 'still-alive');
    await until(() => output.includes('INPUT:still-alive'));
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, before.projects);
    await workbench.activateProject(before.projects[0].id);
    await workbench.saveSettings({ agents: { ...settings.agents, pi: settings.agents.codex } });
    const fixed = await workbench.addPanel(before.projects[0].id, 'pi');
    assert.equal(fixed.launch.outcome, 'started');
    assert.equal(workbench.snapshot().projects[0].panels.length, 3);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('project creation withdraws only the panels whose Agent cannot start, keeping the project even when none start', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    settings.agents.pi = { command: '/no-such-agent', args: [] };
    await workbench.saveSettings(settings);
    const partial = await workbench.createProject({ name: 'Partial', directory, total: 3, counts: { codex: 2, claude: 0, pi: 1 } });
    assert.deepEqual(partial.launches.map(launch => launch.outcome), ['started', 'started', 'failed']);
    const started = partial.launches.filter(launch => launch.outcome === 'started').map(launch => launch.run.panelId);
    assert.deepEqual(partial.project.panels.map(panel => panel.id), started);
    assert.deepEqual(partial.project.panels.map(panel => panel.agent), ['codex', 'codex']);
    assert.deepEqual([...layoutBoxes(partial.project.layout).panels.keys()].sort(), [...started].sort());
    assert.deepEqual(workbench.snapshot().projects, [partial.project]);
    assert.ok(workbench.snapshot().runs.every(run => started.includes(run.panelId)));
    await mkdir(resolve(directory, 'none'));
    const none = await workbench.createProject({ name: 'None', directory: resolve(directory, 'none'), total: 2, counts: { codex: 0, claude: 0, pi: 2 } });
    assert.deepEqual(none.launches.map(launch => launch.outcome), ['failed', 'failed']);
    assert.deepEqual(none.project.panels, []);
    assert.equal(none.project.layout, null);
    assert.equal(workbench.snapshot().activeProjectId, none.project.id);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, [partial.project, none.project]);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('restoring a layout keeps panels whose Agent cannot start', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    const { project } = await workbench.createProject({ name: 'Restore', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    await workbench.saveSettings({ agents: { ...settings.agents, codex: { command: '/no-such-agent', args: [] } } });
    await workbench.quit();
    workbench = await Workbench.open(directory);
    await workbench.activateProject(project.id);
    const snapshot = workbench.snapshot();
    assert.deepEqual(snapshot.projects, [project]);
    assert.deepEqual(snapshot.runs.map(run => run.state), ['failed', 'failed']);
    assert.equal(snapshot.processing.projects[project.id]?.error.count ?? 0, 0);
    await workbench.quit();
    workbench = await Workbench.open(directory);
    assert.deepEqual(workbench.snapshot().projects, [project]);
  } finally { await workbench.quit(); await rm(directory, { recursive: true, force: true }); }
});

test('terminal manager failure cleans up runs without removing saved panel configurations', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  let workbench = await Workbench.open(directory);
  let hostStopped = false;
  let orphanPid = 0;
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    let output = '';
    workbench.subscribe(event => { if (event.kind === 'output') output += event.data; });
    const { project } = await workbench.createProject({ name: 'Fault cleanup', directory, total: 2, counts: { codex: 2, claude: 0, pi: 0 } });
    await mkdir(resolve(directory, 'second'));
    const { project: second } = await workbench.createProject({ name: 'Background cleanup', directory: resolve(directory, 'second'), total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const runs = workbench.snapshot().runs;
    await until(() => output.includes('READY:'));
    await workbench.sendInput(runs[0].id, 'host');
    await until(() => /HOST:(\d+)/.test(output));
    await workbench.sendInput(runs[0].id, 'orphan');
    await until(() => /ORPHAN:(\d+)/.test(output));
    orphanPid = Number(output.match(/ORPHAN:(\d+)/)![1]);
    process.kill(Number(output.match(/HOST:(\d+)/)![1]), 'SIGKILL');
    hostStopped = true;
    await until(() => workbench.snapshot().errors.some(message => message.includes('terminalHostExited')));
    await until(() => [...runs.map(run => run.pid!), orphanPid].every(pid => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }));
    assert.deepEqual(workbench.snapshot().projects, [project, second]);
    assert.ok(workbench.snapshot().runs.every(run => run.state !== 'running'));
    await assert.rejects(workbench.sendInput(runs[0].id, 'after-fault'), /terminalHostExited/);
    await assert.rejects(workbench.quit(), /terminalHostExited/);
    assert.match(await readFile(resolve(directory, 'last-failure.json'), 'utf8'), /SIGKILL/);
    workbench = await Workbench.open(directory);
    hostStopped = false;
    assert.deepEqual(workbench.snapshot().projects, [project, second]);
  } finally {
    if (orphanPid) { try { process.kill(orphanPid, 'SIGKILL'); } catch { /* already cleaned */ } }
    if (hostStopped) await workbench.quit().catch(() => {}); else await workbench.quit();
    await rm(directory, { recursive: true, force: true });
  }
});

test('input while a naturally exited run is still being cleaned up is dropped without an error', async () => {
  const directory = await mkdtemp(resolve('work/panels-'));
  const workbench = await Workbench.open(directory);
  let lingerPid = 0;
  try {
    const settings = workbench.snapshot().settings;
    settings.agents.codex = { command: process.env.VIBEBRIDGE_TEST_NODE!, args: [resolve('tests/fixtures/interactive.cjs')] };
    await workbench.saveSettings(settings);
    let output = '';
    const exits: string[] = [];
    workbench.subscribe(event => {
      if (event.kind === 'output') output += event.data;
      if (event.kind === 'exit') exits.push(event.runId);
    });
    await workbench.createProject({ name: 'Exit cleanup', directory, total: 1, counts: { codex: 1, claude: 0, pi: 0 } });
    const [run] = workbench.snapshot().runs;
    await until(() => output.includes('READY:'));
    await workbench.sendInput(run.id, 'linger');
    await until(() => /LINGER:(\d+)/.test(output));
    lingerPid = Number(output.match(/LINGER:(\d+)/)![1]);
    // Let the host sample the child so cleanup has to wait for it to ignore SIGTERM.
    await new Promise(resolve => setTimeout(resolve, 700));
    await workbench.sendInput(run.id, 'exit');
    await until(() => { try { process.kill(run.pid!, 0); return false; } catch { return true; } });
    // The panel still shows the run while its leftover child is cleaned up.
    assert.equal(workbench.snapshot().runs.find(r => r.id === run.id)?.state, 'running');
    await workbench.sendInput(run.id, 'typed-after-exit');
    await workbench.sendInput(run.id, '\x1b[O');
    await until(() => exits.includes(run.id));
    // The exit event precedes the queued panel removal.
    await until(() => workbench.snapshot().projects[0].panels.length === 0);
    assert.deepEqual(workbench.snapshot().errors, []);
  } finally {
    if (lingerPid) { try { process.kill(lingerPid, 'SIGKILL'); } catch { /* already cleaned */ } }
    await workbench.quit();
    await rm(directory, { recursive: true, force: true });
  }
});
