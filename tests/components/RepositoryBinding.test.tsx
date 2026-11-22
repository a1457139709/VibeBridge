import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/projects/ProjectManagement';
import { Localization } from '../../app/renderer/common/Localization';
import type { ProjectEdit, ProjectView } from '../../app/shared/model';
import type { RepositoryChoices, RepositoryReference } from '../../app/shared/forge/forge';
import { provideWorkbench } from './support/workbench';
import { githubForge, githubRepository, githubView } from './support/forge';
import { selectElement } from './support/elements';

afterEach(cleanup);

const github = (path: string) => githubRepository(path);
const listed = async (directory: string): Promise<RepositoryChoices> => ({
  ok: true,
  forge: githubForge,
  account: 'octo',
  origin: github(directory === '/work/moved' ? 'acme/forge' : 'octo/vibebridge'),
  repositories: ['octo/tools', 'octo/vibebridge', 'acme/forge'].map(github),
});

function editor(repository: RepositoryReference | null, choices = listed) {
  const project: ProjectView = {
    id: 'project',
    name: 'Project',
    directory: '/work/project',
    panels: [],
    tray: [],
    layout: null,
    repository,
    ...githubView,
  };
  const edits: { edit: ProjectEdit; restart: boolean }[] = [];
  provideWorkbench({
    inspectDirectory: async directory => ({ valid: true, directory }),
    fetchRepositoryChoices: async (_id, directory) => choices(directory),
    editProject: async (_id, edit, restart) => {
      edits.push({ edit, restart });
      return { project: { ...project, ...edit }, launches: [] };
    },
  });
  render(
    <Localization language="en">
      <ProjectNavigationItem project={project} openProject={() => {}} openBinding={() => {}}>
        <span>{project.name}</span>
      </ProjectNavigationItem>
    </Localization>,
  );
  return { edits };
}

async function openEditor() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Project menu: Project' }));
  await user.click(screen.getByRole('menuitem', { name: 'Edit project' }));
  return user;
}

const repositoryRow = () => selectElement('.repository-current').textContent;
const closed = () => waitFor(() => assert.equal(screen.queryByRole('dialog'), null));

async function moveDirectory(user: ReturnType<typeof userEvent.setup>) {
  const path = screen.getByRole('textbox', { name: 'Local directory' });
  await user.clear(path);
  await user.type(path, '/work/moved');
  return within(await screen.findByRole('region', { name: 'After saving' }));
}

for (const [state, repository, row] of [
  ['an unbound', null, 'Not boundBind in the GitHub sidebar'],
  ['a bound', github('octo/tools'), 'octo/toolsChange or unbind in the GitHub sidebar'],
] as const)
  test(`${state} project's Edit project edits only name and directory, shows the binding read-only, and saves only those two`, async () => {
    const { edits } = editor(repository);
    const user = await openEditor();
    assert.equal(repositoryRow(), row);
    assert.deepEqual(
      screen.getAllByRole('textbox').map(field => field.getAttribute('id')),
      ['edit-project-name', 'edit-project-directory'],
    );
    assert.equal(screen.queryByRole('listbox'), null, 'no repository list');
    for (const name of ['Change', 'Unbind', "Don't bind", 'Undo'])
      assert.equal(screen.queryByRole('button', { name }), null, `no ${name}`);

    const name = screen.getByRole('textbox', { name: 'Project name' });
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await closed();
    assert.deepEqual(edits, [{ edit: { name: 'Renamed', directory: '/work/project' }, restart: false }]);
  });

test('a moved directory whose origin points elsewhere than the binding says so after saving, and the binding stays', async () => {
  const { edits } = editor(github('octo/tools'));
  const user = await openEditor();
  const impact = await moveDirectory(user);
  assert.ok(await impact.findByText('/work/project → /work/moved'));
  assert.ok(
    await impact.findByText(
      "The new directory's origin points at acme/forge; the binding is still octo/tools. You can change it in the sidebar.",
    ),
  );
  await user.click(screen.getByRole('button', { name: 'Change and restart' }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Project', directory: '/work/moved' }, restart: true }]);
});

test('a moved directory whose repositories cannot be listed still saves', async () => {
  const { edits } = editor(github('octo/tools'), async () => ({
    ok: false,
    failure: { kind: 'notInstalled', detail: '', forge: githubForge },
  }));
  const user = await openEditor();
  await moveDirectory(user);
  await user.click(screen.getByRole('button', { name: 'Change without restarting' }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Project', directory: '/work/moved' }, restart: false }]);
});
