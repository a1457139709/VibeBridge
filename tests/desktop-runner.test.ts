import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

async function fixture() {
  await mkdir('work', { recursive: true });
  const directory = await mkdtemp(resolve('work/desktop-runner-'));
  await mkdir(`${directory}/tests/desktop`, { recursive: true });
  await mkdir(`${directory}/scripts`);
  await copyFile('scripts/test-desktop.mjs', `${directory}/scripts/test-desktop.mjs`);
  await mkdir(`${directory}/node_modules/electron/dist`, { recursive: true });
  await writeFile(`${directory}/node_modules/electron/path.txt`, 'test-electron');
  const node = process.env.VIBEBRIDGE_TEST_NODE!;
  const binary = `${directory}/node_modules/electron/dist/test-electron`;
  // Substitute only the external Electron process; exercise the real runner CLI.
  await writeFile(binary, `#!${node}
const { appendFileSync } = require('node:fs');
const suite = require(process.env.VIBEBRIDGE_TEST_SUITE);
const reopen = !!process.env.VIBEBRIDGE_TEST_REOPEN;
const directory = process.env.VIBEBRIDGE_TEST_DATA;
appendFileSync('events.jsonl', JSON.stringify({ file: process.env.VIBEBRIDGE_TEST_SUITE, reopen, directory }) + '\\n');
Promise.resolve().then(() => (reopen ? suite.reopen : suite.run)({ directory, reopen }))
  .catch(error => { console.error(error); process.exitCode = 1; });
`);
  await chmod(binary, 0o755);
  return {
    directory,
    write: (name: string, source: string) => writeFile(`${directory}/tests/desktop/${name}`, source),
    run: (...args: string[]) => spawnSync(node, ['scripts/test-desktop.mjs', ...args], {
      cwd: directory, encoding: 'utf8', timeout: 10000,
      env: { ...process.env, CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_OS: 'macOS' },
    }),
    events: async (): Promise<Array<{ file: string; reopen: boolean; directory: string }>> =>
      (await readFile(`${directory}/events.jsonl`, 'utf8')).trim().split('\n').map(line => JSON.parse(line)),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}

test('adding a desktop entry automatically runs it, isolates its data, and preserves data for reopening', async () => {
  const f = await fixture();
  try {
    await f.write('existing.test.cjs', 'module.exports = { run() {} };');
    await f.write('helper.cjs', 'throw new Error("helper must not be discovered");');
    await f.write('manual.test.cjs', 'module.exports = { manual: "Requires local CLI", run() { throw new Error("manual must not run"); } };');
    assert.equal(f.run('--all').status, 0);
    await rm(`${f.directory}/events.jsonl`);
    await f.write('agent-status.test.cjs', `const { writeFileSync, readFileSync } = require('node:fs');
module.exports = {
  run({ directory }) { writeFileSync(directory + '/state', 'running'); },
  reopen({ directory }) { require('node:assert/strict').equal(readFileSync(directory + '/state', 'utf8'), 'running'); },
};`);
    const result = f.run('--all');
    assert.equal(result.status, 0, result.stderr);
    const events = await f.events();
    assert.deepEqual(events.map(event => [event.file.split('/').at(-1), event.reopen]), [
      ['agent-status.test.cjs', false], ['agent-status.test.cjs', true], ['existing.test.cjs', false],
    ]);
    assert.equal(events[0].directory, events[1].directory);
    assert.notEqual(events[0].directory, events[2].directory);
    assert.deepEqual(await readdir(`${f.directory}/work/desktop-tests`), []);
  } finally { await f.close(); }
});

test('a newly added failing desktop entry fails the command, reports the error, and stops later suites', async () => {
  const f = await fixture();
  try {
    await f.write('a-existing.test.cjs', 'module.exports = { run() {} };');
    await f.write('b-agent-status.test.cjs', 'module.exports = { run() { console.log("status check started"); throw new Error("AGENT-STATUS-FAIL"); } };');
    await f.write('c-later.test.cjs', 'module.exports = { run() {} };');
    const result = f.run('--all');
    assert.equal(result.status, 1);
    assert.match(result.stdout, /status check started/);
    assert.match(result.stderr, /AGENT-STATUS-FAIL/);
    assert.match(result.stderr, /FAIL: desktop suite b-agent-status/);
    assert.equal((await f.events()).length, 2);
    assert.deepEqual(await readdir(`${f.directory}/work/desktop-tests`), []);
    const artifacts = await readdir(`${f.directory}/work/desktop-artifacts`);
    assert.equal(artifacts.length, 1, 'successful suites discard their diagnostic directories');
    const log = await readFile(`${f.directory}/work/desktop-artifacts/${artifacts[0]}/run/process.log`, 'utf8');
    assert.match(log, /status check started/); assert.match(log, /AGENT-STATUS-FAIL/);
  } finally { await f.close(); }
});

test('desktop execution refuses local machines before launching Electron, but listing is safe', async () => {
  const f = await fixture();
  try {
    await f.write('smoke.test.cjs', 'module.exports = { run() {} };');
    const run = (...args: string[]) => spawnSync(process.env.VIBEBRIDGE_TEST_NODE!, ['scripts/test-desktop.mjs', ...args], {
      cwd: f.directory, encoding: 'utf8', env: { ...process.env, CI: '', GITHUB_ACTIONS: '', RUNNER_OS: '' },
    });
    assert.equal(run('--list').status, 0);
    const result = run('--all');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /GitHub-hosted macOS/);
    await assert.rejects(f.events(), /ENOENT/);
  } finally { await f.close(); }
});

test('new desktop names work without registration and unknown names cannot silently run the default', async () => {
  const f = await fixture();
  try {
    await f.write('agent-status.test.cjs', 'module.exports = { run() {} };');
    const result = f.run('--agent-status');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /PASS: desktop suite agent-status/);
    const unknown = f.run('--misspelled-status');
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /No desktop suites found/);
    assert.equal((await f.events()).length, 1);
  } finally { await f.close(); }
});

test('empty discovery and invalid desktop entries fail instead of reporting an empty successful run', async () => {
  const f = await fixture();
  try {
    assert.notEqual(f.run('--all').status, 0);
    await f.write('invalid.test.cjs', 'module.exports = {};');
    const result = f.run('--all');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Invalid desktop suite/);
  } finally { await f.close(); }
});
