import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Setup } from '../../app/renderer/projects/Setup';
import {
  agentNames,
  newDraft,
  type AgentType,
  type DirectoryInspection,
  type LaunchResult,
  type ProjectCreation,
  type ProjectDraft,
} from '../../app/shared/model';
import { deferred, provideWorkbench } from './support/workbench';
import { t } from './support/localization';
import { requireValue } from '../../app/renderer/common/required';

afterEach(cleanup);

function renderSetup(initial = newDraft()) {
  const onSetupFinished = mock.fn(),
    cancel = mock.fn(),
    openProject = mock.fn(),
    report = mock.fn(),
    openAgentSettings = mock.fn();
  function Form() {
    const [draft, change] = useState(initial);
    return (
      <Setup
        draft={draft}
        changeDraft={change}
        {...{ onSetupFinished, cancel, openProject, report, openAgentSettings }}
        defaultLayout="auto"
      />
    );
  }
  render(<Form />);
  return { user: userEvent.setup(), onSetupFinished, cancel, openProject, report, openAgentSettings };
}

const usable: DirectoryInspection = { ok: true, directory: '/projects/example', name: 'example' };

const validDraft: ProjectDraft = {
  name: 'Project',
  directory: '/projects/example',
  total: 1,
  counts: { codex: 1, claude: 0, pi: 0 },
};

test('choosing a directory uses the latest handwritten project name and cancellation preserves it', async () => {
  const choice = deferred<string | null>();
  provideWorkbench({ chooseDirectory: () => choice.promise, inspectDirectory: async () => usable });
  function Form() {
    const [draft, change] = useState(newDraft);
    return (
      <Setup
        draft={draft}
        changeDraft={change}
        cancel={() => {}}
        onSetupFinished={() => {}}
        openProject={() => {}}
        report={() => {}}
        openAgentSettings={() => {}}
        defaultLayout="auto"
      />
    );
  }
  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole('button', { name: t('chooseDirectory') }));
  await user.type(screen.getByRole('textbox', { name: t('projectName') }), 'Handwritten');
  await act(async () => choice.resolve('/projects/selected'));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') }).value, 'Handwritten');
  assert.equal(
    screen.getByRole<HTMLInputElement>('textbox', { name: t('localDirectory') }).value,
    '/projects/selected',
  );
  provideWorkbench({ chooseDirectory: async () => null, inspectDirectory: async () => usable });
  await user.click(screen.getByRole('button', { name: t('chooseDirectory') }));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') }).value, 'Handwritten');
  assert.equal(
    screen.getByRole<HTMLInputElement>('textbox', { name: t('localDirectory') }).value,
    '/projects/selected',
  );
});

test('creation submits once while pending, retains a failed draft and retries successfully', async () => {
  const pending = deferred<ProjectCreation>();
  const createProject = mock.fn(() => pending.promise);
  provideWorkbench({ inspectDirectory: async () => usable, createProject });
  const { user, onSetupFinished, report } = renderSetup(validDraft);
  const create = screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') });
  await waitFor(() => assert.equal(create.disabled, false));
  act(() => {
    fireEvent.submit(requireValue(create.closest('form'), 'the setup form'));
    fireEvent.submit(requireValue(create.closest('form'), 'the setup form'));
  });
  assert.equal(createProject.mock.callCount(), 1);
  assert.deepEqual(createProject.mock.calls[0].arguments, [validDraft]);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: t('creating') }).disabled, true);
  await act(async () => pending.reject(new Error('创建失败')));
  assert.equal(onSetupFinished.mock.callCount(), 0);
  assert.deepEqual(report.mock.calls[0].arguments, ['创建失败']);
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') }).value, 'Project');
  const result: ProjectCreation = {
    project: { id: 'created', name: 'Project', directory: validDraft.directory, panels: [], layout: null },
    launches: [],
  };
  provideWorkbench({ createProject: async () => result });
  await user.click(screen.getByRole('button', { name: t('createAndStart') }));
  assert.deepEqual(
    onSetupFinished.mock.calls.map(call => call.arguments),
    [['created']],
  );
});

test('creation requires a valid name and exact Agent allocation, and rejects pasted controls visibly', async () => {
  provideWorkbench({ inspectDirectory: async () => usable });
  const { user } = renderSetup({ ...validDraft, counts: { codex: 0, claude: 0, pi: 0 } });
  const create = screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') });
  assert.equal(create.disabled, true);
  assert.ok(
    screen.getByRole('status', { name: t('assignAgents') }).textContent?.includes(t('assignRemaining', { count: 1 })),
  );
  await user.click(screen.getByRole('button', { name: t('increase', { label: agentNames.codex }) }));
  await waitFor(() => assert.equal(create.disabled, false));
  await user.click(screen.getByRole('button', { name: t('increase', { label: t('windowCount') }) }));
  await user.click(screen.getByRole('button', { name: t('increase', { label: agentNames.pi }) }));
  await user.click(screen.getByRole('button', { name: t('decrease', { label: t('windowCount') }) }));
  assert.ok(
    screen.getByRole('status', { name: t('assignAgents') }).textContent?.includes(t('assignExcess', { count: 1 })),
  );
  assert.equal(create.disabled, true);
  await user.click(screen.getByRole('button', { name: t('increase', { label: t('windowCount') }) }));
  assert.equal(create.disabled, false);
  const name = screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') });
  await user.clear(name);
  await user.tab();
  assert.ok(screen.getByRole('textbox', { name: t('projectName'), description: t('nameRequired') }));
  assert.equal(create.disabled, true);
  await user.type(name, 'Safe name');
  await user.paste('unsafe\nname');
  assert.ok(screen.getByRole('textbox', { name: t('projectName'), description: t('nameControls') }));
  assert.equal(name.value, 'Safe name');
  assert.equal(create.disabled, true);
  await user.type(name, '!');
  assert.equal(create.disabled, false);
});

test('directory B remains current when directory A finishes late, including a late failure', async () => {
  for (const failure of [false, true]) {
    const a = deferred<DirectoryInspection>(),
      b = deferred<DirectoryInspection>();
    const inspectDirectory = mock.fn((path: string) => (path === '/A' ? a.promise : b.promise));
    provideWorkbench({ inspectDirectory });
    const { user, report } = renderSetup({ ...validDraft, directory: '/A' });
    await waitFor(() => assert.equal(inspectDirectory.mock.callCount(), 1));
    const directory = screen.getByRole('textbox', { name: t('localDirectory') });
    await user.clear(directory);
    await user.type(directory, '/B');
    const create = screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') });
    assert.equal(create.disabled, true);
    await waitFor(() => assert.equal(inspectDirectory.mock.callCount(), 2));
    await act(async () => b.resolve({ ok: true, directory: '/B', name: 'B' }));
    assert.equal(create.disabled, false);
    await act(async () =>
      failure
        ? a.reject(new Error('Old failure'))
        : a.resolve({ ok: false, problem: { kind: 'duplicate', projectId: 'old', projectName: 'Old' } }),
    );
    assert.equal(create.disabled, false);
    assert.equal(screen.queryByRole('button', { name: t('openExisting') }), null);
    assert.equal(report.mock.callCount(), 0);
    cleanup();
  }
});

test('invalid and duplicate directories prevent creation; opening an existing project uses its id', async () => {
  provideWorkbench({
    inspectDirectory: async path =>
      path === '/duplicate'
        ? { ok: false, problem: { kind: 'duplicate', projectId: 'existing-id', projectName: 'Existing' } }
        : { ok: false, problem: { kind: 'missing' } },
  });
  const { user, openProject } = renderSetup({ ...validDraft, directory: '/missing' });
  await screen.findByRole('textbox', { name: t('localDirectory'), description: t('directoryInvalid') });
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') }).disabled, true);
  const directory = screen.getByRole('textbox', { name: t('localDirectory') });
  await user.clear(directory);
  await user.type(directory, '/duplicate');
  await user.click(await screen.findByRole('button', { name: t('openExisting') }));
  assert.deepEqual(openProject.mock.calls[0].arguments, ['existing-id']);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') }).disabled, true);
});

test('choosing fills an empty name, while chooser and inspection failures preserve editable input', async () => {
  provideWorkbench({
    chooseDirectory: async () => '/projects/Example',
    inspectDirectory: async () => {
      throw new Error('目录检查失败');
    },
  });
  const { user, report } = renderSetup();
  await user.click(screen.getByRole('button', { name: t('chooseDirectory') }));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('projectName') }).value, 'Example');
  await waitFor(() => assert.deepEqual(report.mock.calls[0].arguments, ['目录检查失败']));
  provideWorkbench({
    chooseDirectory: async () => {
      throw new Error('目录选择失败');
    },
  });
  await user.click(screen.getByRole('button', { name: t('chooseDirectory') }));
  assert.deepEqual(report.mock.calls[1].arguments, ['目录选择失败']);
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: t('localDirectory') }).value, '/projects/Example');
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: t('chooseDirectory') }).disabled, false);
});

function launch(panelId: string, agent: AgentType, outcome: 'started' | 'failed'): LaunchResult {
  return {
    outcome,
    agent,
    run: { id: `run-${panelId}`, panelId, projectId: 'created', state: outcome === 'started' ? 'running' : 'failed' },
  };
}

test('creation shows each panel launch result when some Agents cannot start, and leads to Agent settings', async () => {
  const draft: ProjectDraft = { ...validDraft, total: 3, counts: { codex: 2, claude: 0, pi: 1 } };
  const result: ProjectCreation = {
    project: {
      id: 'created',
      name: 'Project',
      directory: draft.directory,
      panels: [
        { id: 'a', agent: 'codex' },
        { id: 'b', agent: 'codex' },
      ],
      layout: null,
    },
    launches: [launch('a', 'codex', 'started'), launch('b', 'codex', 'started'), launch('c', 'pi', 'failed')],
  };
  provideWorkbench({ inspectDirectory: async () => usable, createProject: async () => result });
  const { user, onSetupFinished, openAgentSettings } = renderSetup(draft);
  const create = screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') });
  await waitFor(() => assert.equal(create.disabled, false));
  await user.click(create);
  assert.equal(onSetupFinished.mock.callCount(), 0);
  assert.equal(screen.getByRole('status').textContent, t('setupLaunchFailed'));
  assert.deepEqual(
    screen.getAllByRole('listitem').map(item => item.textContent),
    [
      t('panelLaunchResult', { number: 1, agent: agentNames.codex, result: t('launchSuccess') }),
      t('panelLaunchResult', { number: 2, agent: agentNames.codex, result: t('launchSuccess') }),
      t('panelLaunchResult', { number: 3, agent: agentNames.pi, result: t('launchFailed') }),
    ],
  );
  await user.click(screen.getByRole('button', { name: t('openAgentSettings') }));
  assert.deepEqual(
    onSetupFinished.mock.calls.map(call => call.arguments),
    [['created']],
  );
  assert.equal(openAgentSettings.mock.callCount(), 1);
});

test('creation where no Agent starts reports every panel and opens the empty project when done', async () => {
  const draft: ProjectDraft = { ...validDraft, total: 2, counts: { codex: 0, claude: 1, pi: 1 } };
  const result: ProjectCreation = {
    project: { id: 'created', name: 'Project', directory: draft.directory, panels: [], layout: null },
    launches: [launch('a', 'claude', 'failed'), launch('b', 'pi', 'failed')],
  };
  provideWorkbench({ inspectDirectory: async () => usable, createProject: async () => result });
  const { user, onSetupFinished, openAgentSettings } = renderSetup(draft);
  const create = screen.getByRole<HTMLButtonElement>('button', { name: t('createAndStart') });
  await waitFor(() => assert.equal(create.disabled, false));
  await user.click(create);
  assert.deepEqual(
    screen.getAllByRole('listitem').map(item => item.textContent),
    [
      t('panelLaunchResult', { number: 1, agent: agentNames.claude, result: t('launchFailed') }),
      t('panelLaunchResult', { number: 2, agent: agentNames.pi, result: t('launchFailed') }),
    ],
  );
  await user.click(screen.getByRole('button', { name: t('finish') }));
  assert.deepEqual(
    onSetupFinished.mock.calls.map(call => call.arguments),
    [['created']],
  );
  assert.equal(openAgentSettings.mock.callCount(), 0);
});
