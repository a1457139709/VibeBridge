import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/ProjectManagement';
import { Localization } from '../../app/renderer/Localization';
import type { ProjectEdit, ProjectView } from '../../app/shared/model';
import { detail, message } from '../../app/shared/messages';
import type { ForgeFailureKind, RepositoryChoices, RepositoryReference } from '../../app/shared/forge';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

const github = (path: string): RepositoryReference => ({ forge: 'github', path });
const forge = { name: 'GitHub', cli: 'gh', installUrl: 'https://cli.github.com', loginCommand: 'gh auth login', capabilities: { subIssues: true, blocking: true } };
const listed: RepositoryChoices = { ok: true, forge, account: 'octo', origin: github('octo/vibebridge'),
  repositories: ['octo/tools', 'octo/vibebridge', 'acme/group/forge'].map(github) };
const failed = (kind: ForgeFailureKind, detail = ''): RepositoryChoices => ({ ok: false, failure: { kind, detail, forge } });

function editor(repository: RepositoryReference | null, choices: (directory: string) => Promise<RepositoryChoices>,
  save: (edit: ProjectEdit) => Promise<void> = async () => {}) {
  const project: ProjectView = { id: 'project', name: 'Bound', directory: '/work/bound', panels: [], tray: [], layout: null, repository, forge };
  const edits: { edit: ProjectEdit; restart: boolean }[] = [];
  provideWorkbench({
    inspectDirectory: async directory => ({ valid: true, directory }),
    repositoryChoices: async (_id, directory) => choices(directory),
    editProject: async (_id, edit, restart) => { edits.push({ edit, restart }); await save(edit); return { project: { ...project, ...edit }, launches: [] }; },
  });
  render(<Localization language="en"><ProjectNavigationItem project={project} openProject={() => {}}><span>{project.name}</span></ProjectNavigationItem></Localization>);
  return { edits };
}

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Project menu: Bound' }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
}

const option = (name: string) => screen.getByRole('option', { name: new RegExp(`^${name}`) });
const selected = () => screen.getAllByRole('option').filter(item => item.getAttribute('aria-selected') === 'true').map(item => item.dataset.path);
const field = () => document.querySelector('.repository-current')!.textContent;
const saveButton = () => screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement;
const closed = () => waitFor(() => assert.equal(screen.queryByRole('dialog'), null));

test('an unbound project offers its origin repository, and Save changes binds the one picked from the searchable list', async () => {
  const { edits } = editor(null, async () => listed);
  const user = userEvent.setup();
  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), ['octo/vibebridge']);
  assert.equal(field(), "Binds octo/vibebridge on saveDon't bind");
  assert.ok(within(option('octo/vibebridge')).getByText('origin'));
  assert.ok(screen.getByText('Lists repositories the active gh account owns, collaborates on, or sees through its organizations.'));

  await user.click(screen.getByRole('button', { name: "Don't bind" }));
  assert.equal(field(), 'Not bound');
  assert.deepEqual(selected(), []);
  assert.equal(saveButton().disabled, true, 'nothing to save');

  await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'GROUP');
  assert.deepEqual(screen.getAllByRole('option').map(item => item.dataset.path), ['acme/group/forge']);
  await user.click(option('acme/group/forge'));
  await user.clear(screen.getByRole('searchbox', { name: 'Search repositories' }));
  await user.type(screen.getByRole('searchbox', { name: 'Search repositories' }), 'https://github.com/someone/else');
  assert.ok(screen.getByText('No matching repositories'));
  assert.equal(screen.queryByRole('region', { name: 'After saving' }), null, 'a first binding has no consequence to list');

  await user.click(saveButton());
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Bound', directory: '/work/bound', repository: github('acme/group/forge') }, restart: false }]);
});

test('a bound project shows its repository with Change and Unbind, and the list only after Change', async () => {
  const { edits } = editor(github('octo/tools'), async () => listed);
  const user = userEvent.setup();
  await openEditor(user);
  assert.equal(field(), 'octo/tools currentChangeUnbind');
  assert.equal(screen.queryByRole('listbox'), null);
  assert.equal(saveButton().disabled, true);

  await user.click(screen.getByRole('button', { name: 'Change' }));
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), ['octo/tools']);
  assert.ok(within(option('octo/tools')).getByText('current'));
  await user.click(option('octo/vibebridge'));
  assert.equal(field(), 'octo/tools → octo/vibebridgeUndo');
  const impact = screen.getByRole('region', { name: 'After saving' });
  assert.ok(within(impact).getByText('octo/tools → octo/vibebridge'));
  assert.ok(within(impact).getByText('Dispatch records for the old repository are hidden but kept, and show again if you switch back.'));

  await user.click(screen.getByRole('button', { name: 'Undo' }));
  assert.equal(screen.queryByRole('listbox'), null);
  assert.equal(screen.queryByRole('region', { name: 'After saving' }), null);
  assert.equal(field(), 'octo/tools currentChangeUnbind');

  await user.click(screen.getByRole('button', { name: 'Unbind' }));
  assert.equal(field(), "octo/tools → Don't bindUndo");
  assert.equal(screen.queryByRole('listbox'), null);
  assert.ok(within(screen.getByRole('region', { name: 'After saving' })).getByText('Dispatch records are kept; the sidebar shows the project as unbound.'));
  assert.deepEqual(edits, [], 'nothing is written before Save changes');
  await user.click(saveButton());
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Bound', directory: '/work/bound', repository: null }, restart: false }]);
});

test('a directory change and a binding change are listed together and saved by one call', async () => {
  const { edits } = editor(github('octo/tools'), async () => listed);
  const user = userEvent.setup();
  await openEditor(user);
  await user.click(screen.getByRole('button', { name: 'Unbind' }));
  const path = screen.getByRole('textbox', { name: 'Local directory' });
  await user.clear(path); await user.type(path, '/work/moved');
  const impact = await screen.findByRole('region', { name: 'After saving' });
  await waitFor(() => assert.ok(within(impact).getByText('/work/bound → /work/moved')));
  assert.ok(within(impact).getByText("octo/tools → Don't bind"));
  assert.equal(screen.queryByRole('button', { name: 'Save changes' }), null);
  await user.click(screen.getByRole('button', { name: 'Change and restart' }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Bound', directory: '/work/moved', repository: null }, restart: true }]);
});

test('a save that fails keeps the dialog and every pending change', async () => {
  const failure = message('projectEditListFailed', { reason: detail('HTTP 502 原样') });
  const { edits } = editor(github('octo/tools'), async () => listed, async () => { throw new Error(failure); });
  const user = userEvent.setup();
  await openEditor(user);
  await user.click(screen.getByRole('button', { name: 'Change' }));
  await screen.findByRole('listbox', { name: 'Repository' });
  await user.click(option('octo/vibebridge'));
  await user.click(saveButton());
  assert.equal((await screen.findByRole('alert')).textContent,
    'Could not read the repository list: HTTP 502 原样. Name, directory and repository were not saved; try again, or undo the repository change to save only name and directory.');
  assert.equal(field(), 'octo/tools → octo/vibebridgeUndo');
  assert.equal(edits.length, 1);
});

for (const [kind, text] of [
  ['notInstalled', 'Could not find gh; install it to bind a repository.'],
  ['loggedOut', 'gh is logged out. Run gh auth login, then retry.'],
  ['transient', 'Could not read the repository list: HTTP 502 原样'],
] as const) {
  test(`a ${kind} forge shows its state with Retry in place of the list and binds nothing`, async () => {
    let answer = failed(kind, kind === 'transient' ? 'HTTP 502 原样' : 'gh auth login');
    const { edits } = editor(null, async () => answer);
    const user = userEvent.setup();
    await openEditor(user);
    assert.ok(await screen.findByText(text));
    assert.equal(screen.queryByRole('listbox'), null);
    assert.equal(field(), 'Not bound');
    if (kind === 'notInstalled') assert.equal(screen.getByRole('link', { name: 'Install instructions ↗' }).getAttribute('href'), 'https://cli.github.com');
    const name = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(name); await user.type(name, 'Renamed');
    await user.click(saveButton());
    await closed();
    assert.deepEqual(edits, [{ edit: { name: 'Renamed', directory: '/work/bound', repository: null }, restart: false }], 'name and directory still save');

    await openEditor(user);
    await screen.findByText(text);
    answer = listed;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('listbox', { name: 'Repository' });
    assert.deepEqual(selected(), ['octo/vibebridge']);
  });
}

test('a bound project can be unbound while its forge is unavailable', async () => {
  const { edits } = editor(github('octo/tools'), async () => failed('loggedOut', 'gh auth login'));
  const user = userEvent.setup();
  await openEditor(user);
  await user.click(screen.getByRole('button', { name: 'Change' }));
  assert.ok(await screen.findByText('gh is logged out. Run gh auth login, then retry.'));
  assert.equal(saveButton().disabled, true, 'a failed list changes nothing');
  await user.click(screen.getByRole('button', { name: 'Undo' }));
  await user.click(screen.getByRole('button', { name: 'Unbind' }));
  await user.click(saveButton());
  await closed();
  assert.deepEqual(edits.map(item => item.edit.repository), [null]);
});

test('the default follows the origin of the directory being edited until a repository is picked', async () => {
  const { edits } = editor(null, async directory => ({ ...listed, origin: directory === '/work/moved' ? github('acme/group/forge') : listed.origin }));
  const user = userEvent.setup();
  await openEditor(user);
  await screen.findByRole('listbox', { name: 'Repository' });
  assert.deepEqual(selected(), ['octo/vibebridge']);
  const path = screen.getByRole('textbox', { name: 'Local directory' });
  await user.clear(path); await user.type(path, '/work/moved');
  await waitFor(() => assert.deepEqual(selected(), ['acme/group/forge']));
  await user.click(option('octo/tools'));
  await user.clear(path); await user.type(path, '/work/bound');
  await waitFor(() => assert.equal(saveButton().disabled, false));
  assert.deepEqual(selected(), ['octo/tools'], 'a picked repository survives the directory change');
  await user.click(saveButton());
  await closed();
  assert.deepEqual(edits.map(item => item.edit.repository), [github('octo/tools')]);
});
