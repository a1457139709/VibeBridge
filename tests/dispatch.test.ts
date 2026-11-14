import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble } from './support/gh-double';
import { day, forgeAccount } from './support/bound-workbench';
import { fixture, until } from './support/cli-double';
import { Workbench } from '../app/main/workbench';

const issue = (number: number) => ({ number, title: `Issue ${number}`, state: 'OPEN' as const, createdAt: day(number), labels: [] });
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

/** A Workbench whose one project, bound to octo/tools, has a resident Claude panel running the Claude CLI double. */
async function dispatching(context: test.TestContext) {
  const gh = await ghDouble(context, { ...forgeAccount, repositories: [...forgeAccount.repositories, 'octo/other'], issues: [issue(7), issue(8)] });
  const f = await fixture('claude', ['--raw-input']);
  const { project, launches: [{ run }] } = await f.create();
  await f.workbench.editProject(project.id, { name: project.name, directory: project.directory, repository: { forge: 'github', path: 'octo/tools' } }, false);
  const session = `session-${run.pid}`;
  await until(() => f.workbench.snapshot().projects[0].panels[0].status === 'ready');
  /** What the CLI double has received as typed input, apart from the test's own messages. */
  const typed = async () => {
    await f.send(run.id, undefined, { typed: true });
    return JSON.parse(f.output(run.id).match(/TYPED:([^\r\n]*)\r\n(?![\s\S]*TYPED:)/)![1]) as string;
  };
  const records = () => f.workbench.snapshot().projects[0].dispatches;
  const dispatch = (number: number) => f.workbench.dispatch(project.id, { issue: { number, title: `Issue ${number}` }, workflowId: 'matt',
    commandId: 'implement', target: { kind: 'panel', panelId: run.panelId }, invert: false });
  return { ...f, gh, projectId: project.id, run, session, typed, records, dispatch };
}

test('submitting to an existing panel pastes the command for its Agent type, then presses Enter, and records the dispatch on its session', async context => {
  const f = await dispatching(context);
  try {
    await f.dispatch(7);
    const text = '/implement https://github.com/octo/tools/issues/7';
    assert.equal(await f.typed(), `${paste(text)}\r`);
    await until(() => f.records().length === 1);
    const [record] = f.records();
    assert.deepEqual({ ...record, dispatchedAt: undefined }, { issue: 7, agent: 'claude', text, dispatchedAt: undefined,
      location: { projectId: f.projectId, panelId: f.run.panelId, status: 'ready' } });
    assert.ok(!Number.isNaN(Date.parse(record.dispatchedAt)));
  } finally { await f.close(); }
});

test('a fill-only command is pasted after what the input holds without pressing Enter', async context => {
  const f = await dispatching(context);
  try {
    const { workflows } = f.workbench.snapshot().settings;
    workflows.matt.commands['to-spec'] = { delivery: 'fill' };
    await f.workbench.saveSettings({ workflows });
    await f.workbench.dispatch(f.projectId, { issue: { number: 7, title: 'Issue 7' }, workflowId: 'matt', commandId: 'to-spec',
      target: { kind: 'panel', panelId: f.run.panelId }, invert: false });
    await f.workbench.dispatch(f.projectId, { issue: { number: 8, title: 'Issue 8' }, workflowId: 'matt', commandId: 'triage',
      target: { kind: 'panel', panelId: f.run.panelId }, invert: false });
    assert.equal(await f.typed(), `${paste('/to-spec https://github.com/octo/tools/issues/7')}${paste('/triage look at https://github.com/octo/tools/issues/8')}\r`);
    await until(() => f.records().length === 2);
    assert.deepEqual(f.records().map(record => [record.issue, record.text]),
      [[7, '/to-spec https://github.com/octo/tools/issues/7'], [8, '/triage look at https://github.com/octo/tools/issues/8']]);
  } finally { await f.close(); }
});

test('a record locates no panel once the panel switches session, and the panel again when it resumes that session', async context => {
  const f = await dispatching(context);
  try {
    await f.dispatch(7);
    await until(() => f.records()[0]?.location?.panelId === f.run.panelId);
    await f.send(f.run.id, { hook_event_name: 'SessionStart', source: 'clear', session_id: 'cleared' });
    await until(() => f.records()[0].location === null);
    await f.send(f.run.id, { hook_event_name: 'SessionStart', source: 'resume', session_id: f.session });
    await until(() => f.records()[0].location?.panelId === f.run.panelId);
  } finally { await f.close(); }
});

/** Each of the first project's records as its issue and the panel it locates, or null. */
const located = (workbench: Workbench) => workbench.snapshot().projects[0].dispatches.map(record => [record.issue, record.location?.panelId ?? null]);

test('records stay after their panel closes and after the app reopens, where no panel is on their session', async context => {
  const f = await dispatching(context);
  let reopened: Workbench | undefined;
  try {
    await f.dispatch(7);
    await f.dispatch(8);
    await until(() => located(f.workbench).length === 2);
    assert.deepEqual(located(f.workbench), [[7, f.run.panelId], [8, f.run.panelId]]);
    await f.workbench.closePanel(f.projectId, f.run.panelId);
    await until(() => located(f.workbench).every(([, panel]) => panel === null));
    assert.deepEqual(located(f.workbench), [[7, null], [8, null]]);
    await f.workbench.quit();
    reopened = await Workbench.open(f.directory);
    assert.deepEqual(located(reopened), [[7, null], [8, null]]);
  } finally { await reopened?.quit(); await f.close(); }
});

test('rebinding shows only the records of the bound repository and keeps the others; deleting the project deletes its records', async context => {
  const f = await dispatching(context);
  const bind = (path: string) => f.workbench.editProject(f.projectId, { name: 'claude reporter', directory: f.directory, repository: { forge: 'github', path } }, false);
  let reopened: Workbench | undefined;
  try {
    await f.dispatch(7);
    await until(() => located(f.workbench).length === 1);
    await bind('octo/other');
    assert.deepEqual(located(f.workbench), []);
    await bind('octo/tools');
    assert.deepEqual(located(f.workbench), [[7, f.run.panelId]]);
    // Records reference their project, so the deletion succeeds only when it deletes them too.
    await f.workbench.deleteProject(f.projectId);
    await f.workbench.quit();
    reopened = await Workbench.open(f.directory);
    assert.deepEqual(reopened.snapshot().projects, []);
  } finally { await reopened?.quit(); await f.close(); }
});
