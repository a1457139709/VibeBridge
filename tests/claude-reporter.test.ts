import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, until } from './support/cli-double';
import { showing, statusOf } from './support/panel-views';

test('Claude loads the invocation hooks, and unreadable hook input becomes Error until a fresh fact', async () => {
  const f = await fixture('claude');
  try {
    const { project, launches: [{ run }] } = await f.create();
    assert.equal(f.state(run.id), 'ready');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    assert.equal(f.state(run.id), 'busy');
    await f.send(run.id, { hook_event_name: 'Stop' });
    assert.equal(f.state(run.id), 'done');
    for (const event of f.events) if (event.kind === 'snapshot' && statusOf(event.snapshot, run.id) === 'done') {
      assert.deepEqual(showing(event.snapshot, project.id, 'done'),
        [[run.panelId, run.id]]);
    }
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { malformed: true, output: 'terminal remains usable' });
    assert.ok(f.output(run.id).includes('terminal remains usable'));
    assert.equal(f.state(run.id), 'error');
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    assert.equal(f.state(run.id), 'busy');
  } finally { await f.close(); }
});

test('the Claude reporter matches a permission request to its tool by exact input without sending it', async () => {
  const f = await fixture('claude');
  try {
    const { launches: [{ run }] } = await f.create();
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' });
    await f.send(run.id, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'approved', tool_input: { command: 'printf approved', description: 'waiting' } });
    await f.send(run.id, { hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'printf approved', description: 'waiting' } });
    assert.equal(f.state(run.id), 'needs-input');
    await f.send(run.id, { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'other', tool_input: { command: 'pwd' } });
    assert.equal(f.state(run.id), 'needs-input');
    await f.send(run.id, { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'approved', tool_input: { description: 'waiting', command: 'printf approved' } });
    assert.equal(f.state(run.id), 'busy', 'key order does not change the matched input');
  } finally { await f.close(); }
});

test('file-based Claude settings stay private and each run cleans only its own invocation resources', async () => {
  const f = await fixture('claude', ['--settings', './private-settings.json']);
  let launchSettings: string | undefined;
  const original = { env: { SYNTHETIC_TEST_SECRET: 'private-value-for-test' } };
  try {
    await writeFile(join(f.directory, 'private-settings.json'), JSON.stringify(original));
    const { project, launches: [{ run }, { run: other }] } = await f.create(2);
    await f.send(run.id, { hook_event_name: 'UserPromptSubmit' }, { arguments: true, settings: true });
    assert.equal(f.state(run.id), 'busy');
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
