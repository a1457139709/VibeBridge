import test from 'node:test';
import assert from 'node:assert/strict';
import { ghDouble } from './support/gh-double';
import { bindListed, day, forgeAccount } from './support/bound-workbench';
import { fixture, until } from './support/cli-double';
import { Workbench } from '../app/main/workbench';
import { message } from '../app/shared/messages';

const issue = (number: number) => ({
  number,
  title: `Issue ${number}`,
  state: 'OPEN' as const,
  createdAt: day(number),
  labels: [],
});
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

/** A Workbench whose one project, bound to octo/tools, has a resident Claude panel running the Claude CLI double.
 * With `lateSession`, every Claude CLI double reports its session, and so that it is ready, only when the test says. */
async function dispatching(context: test.TestContext, { lateSession = false } = {}) {
  const gh = await ghDouble(context, {
    ...forgeAccount,
    repositories: [...forgeAccount.repositories, 'octo/other'],
    issues: [issue(7), issue(8)],
  });
  const f = await fixture('claude', ['--raw-input', ...(lateSession ? ['--late-session'] : [])]);
  const {
    project,
    launches: [{ run }],
  } = await f.create();
  await bindListed(f.workbench, project.id, 'octo/tools');
  const session = `session-${run.pid}`;
  if (!lateSession) await until(() => f.workbench.snapshot().projects[0].panels[0].status === 'ready');
  /** What the CLI double has received as typed input, apart from the test's own messages. */
  const typed = async (runId = run.id) => {
    await f.send(runId, undefined, { typed: true });
    return JSON.parse(f.output(runId).match(/TYPED:([^\r\n]*)\r\n(?![\s\S]*TYPED:)/)![1]) as string;
  };
  const records = () => f.workbench.snapshot().projects[0].dispatches;
  const dispatch = (number: number) =>
    f.workbench.dispatch(project.id, {
      issue: { number, title: `Issue ${number}` },
      workflowId: 'matt',
      commandId: 'implement',
      target: { kind: 'panel', panelId: run.panelId },
      invertDelivery: false,
    });
  /** Dispatches /implement for the issue to a new Claude panel; `invert` makes it fill only. Returns the new panel's run. */
  const dispatchNew = async (number: number, invert = false) => {
    const { panelId } = await f.workbench.dispatch(project.id, {
      issue: { number, title: `Issue ${number}` },
      workflowId: 'matt',
      commandId: 'implement',
      target: { kind: 'new', agent: 'claude' },
      invertDelivery: invert,
    });
    const panel = f.workbench.snapshot().projects[0].tray.find(panel => panel.id === panelId)!;
    await until(
      () => f.output(panel.run!.id).includes('CLI-DOUBLE-READY'),
      () => f.output(panel.run!.id),
    );
    return panel.run!;
  };
  /** Reports that the run's CLI started on its session, and so is ready. */
  const start = (runId: string) => f.send(runId, { hook_event_name: 'SessionStart', source: 'startup' });
  return { ...f, gh, projectId: project.id, run, session, typed, records, dispatch, dispatchNew, start };
}

test('submitting to an existing panel pastes the command for its Agent type, then presses Enter, and records the dispatch with its skill on its session', async context => {
  const f = await dispatching(context);
  try {
    await f.dispatch(7);
    assert.equal(await f.typed(), `${paste('/implement https://github.com/octo/tools/issues/7')}\r`);
    await until(() => f.records().length === 1);
    const [record] = f.records();
    assert.deepEqual(
      { ...record, dispatchedAt: undefined },
      {
        issueNumber: 7,
        agent: 'claude',
        skill: 'implement',
        sessionId: f.session,
        dispatchedAt: undefined,
        location: { projectId: f.projectId, panelId: f.run.panelId },
      },
    );
    assert.ok(!Number.isNaN(Date.parse(record.dispatchedAt)));
  } finally {
    await f.close();
  }
});

test('a fill-only command is pasted after what the input holds without pressing Enter', async context => {
  const f = await dispatching(context);
  try {
    const { workflows } = f.workbench.snapshot().settings;
    workflows.matt.commands['to-spec'] = { delivery: 'fill' };
    await f.workbench.saveSettings({ workflows });
    await f.workbench.dispatch(f.projectId, {
      issue: { number: 7, title: 'Issue 7' },
      workflowId: 'matt',
      commandId: 'to-spec',
      target: { kind: 'panel', panelId: f.run.panelId },
      invertDelivery: false,
    });
    await f.workbench.dispatch(f.projectId, {
      issue: { number: 8, title: 'Issue 8' },
      workflowId: 'matt',
      commandId: 'triage',
      target: { kind: 'panel', panelId: f.run.panelId },
      invertDelivery: false,
    });
    assert.equal(
      await f.typed(),
      `${paste('/to-spec https://github.com/octo/tools/issues/7')}${paste('/triage look at https://github.com/octo/tools/issues/8')}\r`,
    );
    await until(() => f.records().length === 2);
    assert.deepEqual(
      f.records().map(record => [record.issueNumber, record.skill]),
      [
        [7, 'to-spec'],
        [8, 'triage'],
      ],
    );
  } finally {
    await f.close();
  }
});

test("inverting a dispatch inverts the command's delivery for that dispatch only", async context => {
  const f = await dispatching(context);
  try {
    const { workflows } = f.workbench.snapshot().settings;
    workflows.matt.commands['to-spec'] = { delivery: 'fill' };
    await f.workbench.saveSettings({ workflows });
    const toPanel = (commandId: string, number: number, invert: boolean) =>
      f.workbench.dispatch(f.projectId, {
        issue: { number, title: `Issue ${number}` },
        workflowId: 'matt',
        commandId,
        target: { kind: 'panel', panelId: f.run.panelId },
        invertDelivery: invert,
      });
    assert.equal((await toPanel('implement', 7, true)).delivery, 'fill');
    assert.equal((await toPanel('to-spec', 8, true)).delivery, 'submit');
    assert.equal((await toPanel('to-spec', 7, false)).delivery, 'fill');
    assert.equal(
      await f.typed(),
      `${paste('/implement https://github.com/octo/tools/issues/7')}${paste('/to-spec https://github.com/octo/tools/issues/8')}\r` +
        paste('/to-spec https://github.com/octo/tools/issues/7'),
    );
  } finally {
    await f.close();
  }
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
  } finally {
    await f.close();
  }
});

/** Each of the first project's records as its issue and the panel it locates, or null. */
const located = (workbench: Workbench) =>
  workbench.snapshot().projects[0].dispatches.map(record => [record.issueNumber, record.location?.panelId ?? null]);

test('records stay after their panel closes and after the app reopens, where no panel is on their session', async context => {
  const f = await dispatching(context);
  let reopened: Workbench | undefined;
  try {
    await f.dispatch(7);
    await f.dispatch(8);
    await until(() => located(f.workbench).length === 2);
    assert.deepEqual(located(f.workbench), [
      [7, f.run.panelId],
      [8, f.run.panelId],
    ]);
    await f.workbench.closePanel(f.projectId, f.run.panelId);
    await until(() => located(f.workbench).every(([, panel]) => panel === null));
    assert.deepEqual(located(f.workbench), [
      [7, null],
      [8, null],
    ]);
    await f.workbench.quit();
    reopened = await Workbench.open(f.directory);
    assert.deepEqual(located(reopened), [
      [7, null],
      [8, null],
    ]);
  } finally {
    await reopened?.quit();
    await f.close();
  }
});

test('rebinding shows only the records of the bound repository and keeps the others; deleting the project deletes its records', async context => {
  const f = await dispatching(context);
  const bind = (path: string) => bindListed(f.workbench, f.projectId, path);
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
  } finally {
    await reopened?.quit();
    await f.close();
  }
});

test('submitting to a new panel launches it in the tray with the command after the configured arguments, unopened', async context => {
  const f = await dispatching(context, { lateSession: true });
  try {
    const run = await f.dispatchNew(7);
    assert.deepEqual(
      f.workbench.snapshot().projects[0].tray.map(panel => panel.id),
      [run.panelId],
    );
    await f.send(run.id, undefined, { arguments: true });
    const args = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]) as string[];
    assert.deepEqual(args.slice(0, 3), [
      '--raw-input',
      '--late-session',
      '/implement https://github.com/octo/tools/issues/7',
    ]);
  } finally {
    await f.close();
  }
});

test('filling a new panel pastes the command once it reports ready, without pressing Enter', async context => {
  const f = await dispatching(context, { lateSession: true });
  try {
    const run = await f.dispatchNew(7, true);
    await f.send(run.id, undefined, { arguments: true });
    const args = JSON.parse(f.output(run.id).match(/ARGUMENTS:([^\r\n]+)/)![1]) as string[];
    assert.deepEqual(args.slice(0, 2), ['--raw-input', '--late-session'], 'the configured arguments only');
    assert.ok(!args.some(arg => arg.includes('/implement')));
    // The paste is sent to the terminal while the ready report is answered, so it is in before the double acknowledges.
    await f.start(run.id);
    assert.equal(await f.typed(run.id), `[SessionStart]${paste('/implement https://github.com/octo/tools/issues/7')}`);
  } finally {
    await f.close();
  }
});

test("a new panel's dispatch locates its panel at once, and is recorded on the first session it reports", async context => {
  const f = await dispatching(context, { lateSession: true });
  let reopened: Workbench | undefined;
  try {
    const run = await f.dispatchNew(7);
    assert.deepEqual(located(f.workbench), [[7, run.panelId]], 'shown before the panel reports a session');
    const [waiting] = f.records();
    assert.deepEqual(
      { ...waiting, dispatchedAt: undefined },
      {
        issueNumber: 7,
        agent: 'claude',
        skill: 'implement',
        dispatchedAt: undefined,
        location: { projectId: f.projectId, panelId: run.panelId },
      },
      'no session ID until the panel reports one',
    );
    await f.start(run.id);
    await until(() => f.records()[0]?.sessionId === `session-${run.pid}`);
    // Once recorded, the dispatch follows its session rather than the panel.
    await f.send(run.id, { hook_event_name: 'SessionStart', source: 'clear', session_id: 'cleared' });
    await until(() => located(f.workbench)[0]?.[1] === null);
    await f.send(run.id, { hook_event_name: 'SessionStart', source: 'resume', session_id: `session-${run.pid}` });
    await until(() => located(f.workbench)[0]?.[1] === run.panelId);
    await f.workbench.quit();
    reopened = await Workbench.open(f.directory);
    assert.deepEqual(located(reopened), [[7, null]]);
  } finally {
    await reopened?.quit();
    await f.close();
  }
});

test('a new panel that ends before reporting a session leaves no record', async context => {
  const f = await dispatching(context, { lateSession: true });
  let reopened: Workbench | undefined;
  try {
    const run = await f.dispatchNew(7);
    await f.workbench.closePanel(f.projectId, run.panelId);
    assert.deepEqual(located(f.workbench), []);
    await f.workbench.quit();
    reopened = await Workbench.open(f.directory);
    assert.deepEqual(located(reopened), []);
  } finally {
    await reopened?.quit();
    await f.close();
  }
});

test('a new panel whose Agent fails to launch is withdrawn, fails the dispatch and leaves no record', async context => {
  const f = await dispatching(context);
  try {
    const { agents } = f.workbench.snapshot().settings;
    await f.workbench.saveSettings({ agents: { ...agents, codex: { command: '/no-such-agent', args: [] } } });
    await assert.rejects(
      f.workbench.dispatch(f.projectId, {
        issue: { number: 7, title: 'Issue 7' },
        workflowId: 'matt',
        commandId: 'implement',
        target: { kind: 'new', agent: 'codex' },
        invertDelivery: false,
      }),
      { message: message('launchFailed') },
    );
    assert.deepEqual(f.workbench.snapshot().projects[0].tray, []);
    assert.deepEqual(located(f.workbench), []);
  } finally {
    await f.close();
  }
});
