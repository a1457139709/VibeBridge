import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { testDirectory } from './support/directory';

async function fixture(context: TestContext) {
  const directory = await testDirectory(context, 'source-shape');
  for (const root of ['app', 'tests', 'scripts']) await mkdir(`${directory}/${root}`);
  return {
    write: async (file: string, source: string) => {
      await mkdir(dirname(`${directory}/${file}`), { recursive: true });
      await writeFile(`${directory}/${file}`, source);
    },
    run: () => spawnSync(process.env.VIBEBRIDGE_TEST_NODE ?? process.execPath,
      [resolve('scripts/check-source-shape.mjs')], { cwd: directory, encoding: 'utf8', timeout: 10000 }),
  };
}

/** A line of `length` characters that packs several short declarations together. */
const packed = (length: number) => Array.from({ length: Math.ceil(length / 12) }, (_, i) => `const a${i} = 1;`)
  .join(' ').slice(0, length);

test('lines over 200 characters fail in app, tests and scripts; a line of exactly 200 passes', async context => {
  const f = await fixture(context);
  await f.write('app/fits.ts', packed(200));
  assert.equal(f.run().status, 0);
  await f.write('app/renderer/View.tsx', `export {};\n${packed(201)}\n`);
  await f.write('tests/view.test.ts', packed(250));
  await f.write('scripts/build.mjs', packed(300));
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\/renderer\/View\.tsx:2: 201 characters/);
  assert.match(result.stderr, /tests\/view\.test\.ts:1: 250 characters/);
  assert.match(result.stderr, /scripts\/build\.mjs:1: 300 characters/);
  assert.match(result.stderr, /wrap them as the surrounding code wraps/);
  assert.doesNotMatch(result.stderr, /fits\.ts/);
});

test('a line holding one string longer than the limit is data and passes', async context => {
  const f = await fixture(context);
  await f.write('app/icon.tsx', `export const path = <path d="${'M1 2L3 4 '.repeat(40)}" />;`);
  await f.write('app/message.ts', `export const text = '${'word '.repeat(50)}';`);
  assert.equal(f.run().status, 0, f.run().stderr);
});

test("Workbench methods that only forward a call to a field's method fail; queued and combining methods pass", async context => {
  const f = await fixture(context);
  await f.write('app/main/workbench.ts', `export class Workbench {
  sendInput(runId: string, data: string) { return this.runs.input(runId, data); }
  acknowledge(runId: string) { this.runs.acknowledgeOutput(runId, 1); }
  async flush(id: string) { await this.runs.flush(id); }
  closePanel(projectId: string, panelId: string) { return this.operation(() => this.panels.close(this.project(projectId), panelId)); }
  inspect(path: string) { return inspectDirectory(path, this.state.projects); }
  bound(projectId: string) {
    this.project(projectId);
    return this.bindings.forCall(projectId);
  }
}`);
  await f.write('app/main/project-panels.ts', `export class ProjectPanels {
  stop(project: Project) { return this.supervision.stopPanels(project.panels); }
}`);
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /workbench\.ts:2: sendInput only forwards to this\.runs\.input/);
  assert.match(result.stderr, /workbench\.ts:3: acknowledge only forwards to this\.runs\.acknowledgeOutput/);
  assert.match(result.stderr, /workbench\.ts:4: flush only forwards to this\.runs\.flush/);
  assert.match(result.stderr, /callers call the feature module directly/);
  assert.doesNotMatch(result.stderr, /closePanel|inspect|bound|project-panels/);
});
