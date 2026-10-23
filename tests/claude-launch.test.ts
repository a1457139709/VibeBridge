import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, until } from './support/claude-hooks';

test('Claude preserves invocation settings, existing hooks and files including relative paths', async () => {
  const original = { model: 'fixture-model', permissions: { allow: ['Read'] }, hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'printf "EXISTING-HOOK\\n"' }] }],
  } };
  for (const option of [ ['--settings', JSON.stringify(original)], ['--settings=./settings with spaces.json'] ]) {
    const args = [...option, '--', '--settings=literal-prompt'];
    const f = await fixture(args);
    try {
      const file = join(f.directory, 'settings with spaces.json');
      await writeFile(file, JSON.stringify(original));
      const { launches: [{ run }] } = await f.create();
      await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { settings: true });
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
      assert.ok(f.output(run.id).includes('EXISTING-HOOK'));
      const effective = JSON.parse(f.output(run.id).match(/SETTINGS:([^\r\n]+)/)![1]);
      assert.equal(effective.model, 'fixture-model');
      assert.deepEqual(effective.permissions, original.permissions);
      assert.deepEqual(effective.hooks.UserPromptSubmit[0], original.hooks.UserPromptSubmit[0]);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), original);
      assert.deepEqual(f.workbench.snapshot().settings.agents.claude.args.slice(1), args);
    } finally { await f.close(); }
  }
});

test('file-based Claude settings stay private and each run cleans only its own invocation resources', async () => {
  const f = await fixture(['--settings', './private-settings.json']);
  let launchSettings: string | undefined;
  const original = { env: { SYNTHETIC_TEST_SECRET: 'private-value-for-test' } };
  try {
    await writeFile(join(f.directory, 'private-settings.json'), JSON.stringify(original));
    const { project, launches: [{ run }, { run: other }] } = await f.create(2);
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { arguments: true, settings: true });
    const args: string[] = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]);
    assert.ok(!args.some(arg => arg.includes('private-value-for-test')), 'file contents must not become process arguments');
    launchSettings = args[args.lastIndexOf('--settings') + 1];
    assert.notEqual(launchSettings, './private-settings.json');
    assert.equal((await stat(launchSettings)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(launchSettings, 'utf8')).env, original.env);
    await f.send(other.id, {}, { arguments: true });
    const otherArgs: string[] = JSON.parse(f.output(other.id).match(/ARGUMENTS:([^\r\n]+)/)![1]);
    const otherSettings = otherArgs[otherArgs.lastIndexOf('--settings') + 1];
    assert.notEqual(launchSettings, otherSettings);
    await f.workbench.closePanel(project.id, run.panelId);
    await until(() => !existsSync(launchSettings!));
    assert.ok(existsSync(otherSettings));
    await f.workbench.quit();
    await assert.rejects(access(launchSettings), { code: 'ENOENT' });
    await assert.rejects(access(otherSettings), { code: 'ENOENT' });
    assert.deepEqual(JSON.parse(await readFile(join(f.directory, 'private-settings.json'), 'utf8')), original);
  } finally { await f.close(); }
});

test('disabled or unsafe Claude hook configuration leaves the original terminal usable with Error', async () => {
  for (const value of ['{"disableAllHooks":true}', '{"hooks":{"Stop":42}}', './missing-settings.json']) {
    const f = await fixture(['--settings', value]);
    try {
      const { launches: [{ run }] } = await f.create();
      await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { output: 'still interactive' });
      assert.ok(f.output(run.id).includes('still interactive'));
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
    } finally { await f.close(); }
  }
});

test('Claude observation loss requires a fresh event and retired run credentials cannot affect its replacement', async () => {
  const f = await fixture();
  try {
    const { project, launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'Stop' }, { context: true });
    const context = JSON.parse(f.output(run.id).match(/CONTEXT:([^\r\n]+)/)![1]);
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { malformed: true });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
    const post = async (payload: object, overrides: object = {}) => {
      const response = await fetch(context.url, { method: 'POST', body: JSON.stringify({ ...context, version: 1,
        source: 'claude-hook', scope: 'main', payload, ...overrides }) });
      await response.text(); return response.status;
    };
    assert.equal(await post({ observation: 'restored' }), 204);
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'error');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    for (const overrides of [{ token: 'wrong' }, { agent: 'pi' }, { occurredAt: 1 }, { expiresAt: 1 }]) {
      await post({ hook_event_name: 'Stop', session_id: 'unknown' }, overrides);
      assert.equal(f.workbench.snapshot().processing.runs[run.id], 'busy');
    }
    await f.workbench.closePanel(project.id, run.panelId);
    const fresh = await f.workbench.addPanel(project.id, 'claude');
    const freshRun = fresh.launch.run;
    await until(() => f.workbench.snapshot().processing.runs[freshRun.id] === 'ready');
    assert.equal(await post({ hook_event_name: 'Stop', session_id: 'old' }), 403);
    assert.equal(f.workbench.snapshot().processing.runs[freshRun.id], 'ready');
    assert.equal(f.workbench.snapshot().processing.projects[project.id].done.count, 0);
  } finally { await f.close(); }
});
