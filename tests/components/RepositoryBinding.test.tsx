import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/ProjectManagement';
import { Localization } from '../../app/renderer/Localization';
import type { ProjectView } from '../../app/shared/model';
import type { CodeHostingFailureKind, RepositoryChoices, RepositoryReference } from '../../app/shared/code-hosting';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const github = (path: string): RepositoryReference => ({ platform: 'github', path });
const platform = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login' };
const listed: RepositoryChoices = { ok: true, platform, account: 'octo', origin: github('octo/vibebridge'),
  repositories: ['octo/tools', 'octo/vibebridge', 'acme/group/platform'].map(github) };
const failed = (kind: CodeHostingFailureKind, detail = ''): RepositoryChoices => ({ ok: false, failure: { kind, detail, platform } });

function editor(repository: RepositoryReference | null, choices: () => Promise<RepositoryChoices>) {
  const project: ProjectView = { id: 'project', name: 'Bound', directory: '/work/bound', panels: [], tray: [], layout: null, repository };
  const bindings: (RepositoryReference | null)[] = [], edits: unknown[] = [];
  provideWorkbench({
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async () => choices(),
    bindRepository: async (_id, value) => { bindings.push(value); },
    editProject: async (_id, edit) => { edits.push(edit); return { project: { ...project, ...edit }, launches: [] }; },
  });
  render(<Localization language="en"><ProjectNavigationItem project={project} openProject={() => {}}><span>{project.name}</span></ProjectNavigationItem></Localization>);
  return { bindings, edits };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Project menu: Bound' }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
}

const option = (name: string) => screen.getByRole('option', { name: new RegExp(`^${name}`) });
const selected = () => screen.getAllByRole('option').filter(item => item.getAttribute('aria-selected') === 'true').map(item => item.dataset.path);

test('an unbound project offers its origin repository, and saving binds the repository picked from the searchable list', async () => {
  const { bindings, edits } = editor(null, async () => listed);
  const user = userEvent.setup();
  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), ['octo/vibebridge']);
  assert.ok(within(option('octo/vibebridge')).getByText('origin'));
  assert.ok(screen.getByText('Lists repositories the active gh account owns, collaborates on, or sees through its organizations.'));

  await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'GROUP');
  assert.deepEqual(screen.getAllByRole('option').map(item => item.dataset.path), ['acme/group/platform']);
  await user.click(option('acme/group/platform'));
  await user.clear(screen.getByRole('searchbox', { name: 'Search repositories' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'https://github.com/someone/else');
  assert.ok(screen.getByText('No matching repositories'));

  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(bindings, [github('acme/group/platform')]);
  assert.equal(edits.length, 1);
});

test('saving without a listed origin and without picking leaves the project unbound', async () => {
  const { bindings } = editor(null, async () => ({ ...listed, origin: null }));
  const user = userEvent.setup();
  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), []);
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(bindings, []);
});

test('changing and removing a binding each ask for confirmation first', async () => {
  const { bindings } = editor(github('octo/tools'), async () => listed);
  const user = userEvent.setup();
  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), ['octo/tools']);
  assert.ok(within(option('octo/tools')).getByText('current'));

  await user.click(option('octo/vibebridge'));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  assert.ok(screen.getByText('Change the binding from octo/tools to octo/vibebridge? Dispatch records for the old repository are hidden but kept.'));
  assert.deepEqual(bindings, []);
  await user.click(within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Cancel' }));
  assert.equal(screen.queryByRole('group', { name: 'Confirm' }), null);

  await user.click(screen.getByRole('button', { name: 'Unbind' }));
  assert.ok(screen.getByText('Unbind octo/tools? Dispatch records are kept.'));
  assert.deepEqual(bindings, []);
  await user.click(within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Unbind' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(bindings, [null]);

  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  await user.click(option('octo/vibebridge'));
  await user.click(screen.getByRole('button', { name: 'Save changes' }));
  await user.click(within(screen.getByRole('group', { name: 'Confirm' })).getByRole('button', { name: 'Change' }));
  await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
  assert.deepEqual(bindings, [null, github('octo/vibebridge')]);
});

for (const [kind, text] of [
  ['notInstalled', 'Could not find gh; install it to bind a repository.'],
  ['loggedOut', 'gh is logged out. Run gh auth login, then retry.'],
  ['transient', 'Could not read the repository list: HTTP 502 原样'],
] as const) {
  test(`a ${kind} platform shows its state with Retry in place of the picker and binds nothing`, async () => {
    let answer = failed(kind, kind === 'transient' ? 'HTTP 502 原样' : 'gh auth login');
    const { bindings, edits } = editor(null, async () => answer);
    const user = userEvent.setup();
    await openEditor(user);
    assert.ok(await screen.findByText(text));
    assert.equal(screen.queryByRole('listbox'), null);
    if (kind === 'notInstalled') assert.equal(screen.getByRole('link', { name: 'Install instructions ↗' }).getAttribute('href'), 'https://cli.github.com');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => assert.equal(screen.queryByRole('dialog'), null));
    assert.deepEqual(bindings, []);
    assert.equal(edits.length, 1, 'name and directory still save');

    await openEditor(user);
    await screen.findByText(text);
    answer = listed;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('listbox', { name: 'Repository' });
    assert.deepEqual(selected(), ['octo/vibebridge']);
  });
}
