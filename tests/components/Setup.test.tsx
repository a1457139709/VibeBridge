import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { Setup } from '../../app/renderer/Setup';
import { newDraft, type DirectoryResult, type ProjectCreation, type ProjectDraft } from '../../app/shared/model';
import { deferred, provideWorkbench } from './support/workbench';

afterEach(cleanup);

function renderSetup(initial = newDraft()) {
  const created = mock.fn(), cancel = mock.fn(), openProject = mock.fn(), report = mock.fn();
  function Form() {
    const [draft, change] = useState(initial);
    return <Setup draft={draft} change={change} {...{ created, cancel, openProject, report }} defaultLayout="auto" />;
  }
  render(<Form />);
  return { user: userEvent.setup(), created, cancel, openProject, report };
}

const validDraft: ProjectDraft = { name: 'Project', directory: '/projects/example', total: 1, counts: { codex: 1, claude: 0, pi: 0 } };

test('choosing a directory uses the latest handwritten project name and cancellation preserves it', async () => {
  const choice = deferred<string | null>();
  provideWorkbench({ chooseDirectory: () => choice.promise, inspectDirectory: async () => ({ valid: true }) });
  function Form() {
    const [draft, change] = useState(newDraft);
    return <Setup draft={draft} change={change} cancel={() => {}} created={() => {}} openProject={() => {}} report={() => {}} defaultLayout="auto" />;
  }
  const user = userEvent.setup();
  render(<Form />);
  await user.click(screen.getByRole('button', { name: 'Choose local directory' }));
  await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'Handwritten');
  await act(async () => choice.resolve('/projects/selected'));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' }).value, 'Handwritten');
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Local directory' }).value, '/projects/selected');
  provideWorkbench({ chooseDirectory: async () => null, inspectDirectory: async () => ({ valid: true }) });
  await user.click(screen.getByRole('button', { name: 'Choose local directory' }));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' }).value, 'Handwritten');
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Local directory' }).value, '/projects/selected');
});

test('creation submits once while pending, retains a failed draft and retries successfully', async () => {
  const pending = deferred<ProjectCreation>();
  const createProject = mock.fn(() => pending.promise);
  provideWorkbench({ inspectDirectory: async () => ({ valid: true }), createProject });
  const { user, created, report } = renderSetup(validDraft);
  const create = screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start' });
  await waitFor(() => assert.equal(create.disabled, false));
  act(() => { fireEvent.submit(create.closest('form')!); fireEvent.submit(create.closest('form')!); });
  assert.equal(createProject.mock.callCount(), 1);
  assert.deepEqual(createProject.mock.calls[0].arguments, [validDraft]);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: 'Creating…' }).disabled, true);
  await act(async () => pending.reject(new Error('创建失败')));
  assert.equal(created.mock.callCount(), 0);
  assert.deepEqual(report.mock.calls[0].arguments, ['创建失败']);
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' }).value, 'Project');
  const result: ProjectCreation = { project: { id: 'created', name: 'Project', directory: validDraft.directory, panels: [], layout: null }, launches: [] };
  provideWorkbench({ createProject: async () => result });
  await user.click(screen.getByRole('button', { name: 'Create and start' }));
  assert.deepEqual(created.mock.calls.map(call => call.arguments), [['created']]);
});

test('creation requires a valid name and exact Agent allocation, and rejects pasted controls visibly', async () => {
  provideWorkbench({ inspectDirectory: async () => ({ valid: true }) });
  const { user } = renderSetup({ ...validDraft, counts: { codex: 0, claude: 0, pi: 0 } });
  const create = screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start' });
  assert.equal(create.disabled, true);
  assert.ok(screen.getByText('Assign 1 more'));
  await user.click(screen.getByRole('button', { name: 'Increase Codex' }));
  await waitFor(() => assert.equal(create.disabled, false));
  await user.click(screen.getByRole('button', { name: 'Increase Window count' }));
  await user.click(screen.getByRole('button', { name: 'Increase pi' }));
  await user.click(screen.getByRole('button', { name: 'Decrease Window count' }));
  assert.ok(screen.getByText('1 too many assigned'));
  assert.equal(create.disabled, true);
  await user.click(screen.getByRole('button', { name: 'Increase Window count' }));
  assert.equal(create.disabled, false);
  const name = screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' });
  await user.clear(name);
  await user.tab();
  assert.ok(screen.getByText('Enter a project name'));
  assert.equal(create.disabled, true);
  await user.type(name, 'Safe name');
  await user.paste('unsafe\nname');
  assert.ok(screen.getByText('Project names cannot contain line breaks or control characters'));
  assert.equal(name.value, 'Safe name');
  assert.equal(create.disabled, true);
  await user.type(name, '!');
  assert.equal(create.disabled, false);
});

test('directory B remains current when directory A finishes late, including a late failure', async () => {
  for (const failure of [false, true]) {
    const a = deferred<DirectoryResult>(), b = deferred<DirectoryResult>();
    const inspectDirectory = mock.fn((path: string) => path === '/A' ? a.promise : b.promise);
    provideWorkbench({ inspectDirectory });
    const { user, report } = renderSetup({ ...validDraft, directory: '/A' });
    await waitFor(() => assert.equal(inspectDirectory.mock.callCount(), 1));
    const directory = screen.getByRole('textbox', { name: 'Local directory' });
    await user.clear(directory); await user.type(directory, '/B');
    const create = screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start' });
    assert.equal(create.disabled, true);
    await waitFor(() => assert.equal(inspectDirectory.mock.callCount(), 2));
    await act(async () => b.resolve({ valid: true, directory: '/B' }));
    assert.equal(create.disabled, false);
    await act(async () => failure ? a.reject(new Error('Old failure')) : a.resolve({ valid: true, existingProjectId: 'old', existingProjectName: 'Old' }));
    assert.equal(create.disabled, false);
    assert.equal(screen.queryByRole('button', { name: 'Open existing project' }), null);
    assert.equal(report.mock.callCount(), 0);
    cleanup();
  }
});

test('invalid and duplicate directories prevent creation; opening an existing project uses its id', async () => {
  provideWorkbench({ inspectDirectory: async path => path === '/duplicate'
    ? { valid: true, existingProjectId: 'existing-id', existingProjectName: 'Existing' }
    : { valid: false } });
  const { user, openProject } = renderSetup({ ...validDraft, directory: '/missing' });
  await screen.findByText('Choose a valid local directory');
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start' }).disabled, true);
  const directory = screen.getByRole('textbox', { name: 'Local directory' });
  await user.clear(directory); await user.type(directory, '/duplicate');
  await user.click(await screen.findByRole('button', { name: 'Open existing project' }));
  assert.deepEqual(openProject.mock.calls[0].arguments, ['existing-id']);
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: 'Create and start' }).disabled, true);
});

test('choosing fills an empty name, while chooser and inspection failures preserve editable input', async () => {
  provideWorkbench({ chooseDirectory: async () => '/projects/Example', inspectDirectory: async () => { throw new Error('目录检查失败'); } });
  const { user, report } = renderSetup();
  await user.click(screen.getByRole('button', { name: 'Choose local directory' }));
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Project name' }).value, 'Example');
  await waitFor(() => assert.deepEqual(report.mock.calls[0].arguments, ['目录检查失败']));
  provideWorkbench({ chooseDirectory: async () => { throw new Error('目录选择失败'); } });
  await user.click(screen.getByRole('button', { name: 'Choose local directory' }));
  assert.deepEqual(report.mock.calls[1].arguments, ['目录选择失败']);
  assert.equal(screen.getByRole<HTMLInputElement>('textbox', { name: 'Local directory' }).value, '/projects/Example');
  assert.equal(screen.getByRole<HTMLButtonElement>('button', { name: 'Choose local directory' }).disabled, false);
});
