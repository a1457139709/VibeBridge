import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { inspectDirectory } from '../app/main/projects/project-directory';
import { testDirectory } from './support/directory';

test('directory inspection names the real directory or says why it cannot hold a project', async context => {
  const root = await realpath(await testDirectory(context, 'project-directory'));
  const free = join(root, 'free');
  const used = join(root, 'used');
  const file = join(root, 'file');
  await mkdir(free);
  await mkdir(used);
  await writeFile(file, 'not a directory');
  await symlink(free, join(root, 'alias'));
  const projects = [{ id: 'used-id', name: 'Used', directory: used, panels: [], layout: null }];

  assert.deepEqual(await inspectDirectory(join(root, 'alias'), projects), {
    ok: true,
    directory: free,
    name: basename(free),
  });
  assert.deepEqual(await inspectDirectory(join(root, 'missing'), projects), {
    ok: false,
    problem: { kind: 'missing' },
  });
  assert.deepEqual(await inspectDirectory(file, projects), { ok: false, problem: { kind: 'notDirectory' } });
  assert.deepEqual(await inspectDirectory(`${used}/.`, projects), {
    ok: false,
    problem: { kind: 'duplicate', projectId: 'used-id', projectName: 'Used' },
  });
});
