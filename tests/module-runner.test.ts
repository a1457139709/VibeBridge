import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

function list(environment: NodeJS.ProcessEnv = {}, files: string[] = []) {
  return spawnSync(process.env.VIBEBRIDGE_TEST_NODE!, ['scripts/test.mjs', '--list', ...files], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', RUNNER_OS: '', GITHUB_EVENT_NAME: '',
      VIBEBRIDGE_TEST_CLAUDE: '', ...environment },
  });
}

test('default module selection retains ordinary checks and excludes Claude suites', () => {
  const result = list();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tests\/processing-status\.test\.ts/);
  assert.doesNotMatch(result.stdout, /tests\/claude-/);
});

test('local module selection refuses explicit Claude suites and a local opt-in', () => {
  const explicit = list({}, ['tests/claude-hooks.test.ts']);
  assert.notEqual(explicit.status, 0);
  assert.match(explicit.stderr, /manual Checks workflow/);
  const enabled = list({ VIBEBRIDGE_TEST_CLAUDE: '1' });
  assert.notEqual(enabled.status, 0);
  assert.match(enabled.stderr, /GitHub-hosted macOS/);
});

test('Claude module discovery requires an opted-in manual GitHub macOS run', () => {
  // Listing only: these environment values never launch a suite or a CLI.
  const host = { CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS', GITHUB_EVENT_NAME: 'workflow_dispatch' };
  assert.doesNotMatch(list(host).stdout, /tests\/claude-/);
  const enabled = { ...host, VIBEBRIDGE_TEST_CLAUDE: '1' };
  const result = list(enabled);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tests\/claude-hooks\.test\.ts/);
  assert.match(result.stdout, /tests\/claude-launch\.test\.ts/);
  assert.notEqual(list({ ...enabled, GITHUB_EVENT_NAME: 'push' }).status, 0);
  assert.notEqual(list({ ...enabled, RUNNER_OS: 'Linux' }).status, 0);
});
