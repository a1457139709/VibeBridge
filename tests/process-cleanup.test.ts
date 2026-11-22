import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { killUnlessExited } from './support/process-cleanup';
import { testNode } from './support/test-node';

test('killing a process that has already exited succeeds', async () => {
  const child = spawn(testNode, ['-e', '']);
  await once(child, 'exit');
  const pid = child.pid;
  assert.ok(pid);
  assert.doesNotThrow(() => killUnlessExited(pid));
});

test('a kill that fails for any reason but an exited process is raised, not ignored', () => {
  assert.throws(() => killUnlessExited(Number.NaN), { code: 'ERR_INVALID_ARG_TYPE' });
});
