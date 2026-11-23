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
import { t } from './support/localization';

afterEach(cleanup);

const projectName = 'Project';
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
    name: projectName,
    directory: '/work/project',
    panels: [],
    tray: [],
    layout: null,
    repository,
    ...githubView,
  };
  const edits: { edit: ProjectEdit; restart: boolean }[] = [];
  provideWorkbench({
    inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
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
  await user.click(screen.getByRole('button', { name: t('projectMenu', { name: projectName }) }));
  await user.click(screen.getByRole('menuitem', { name: t('editProject') }));
  return user;
}

const repositoryRow = () => selectElement('.repository-current').textContent;
const impactRegion = () => screen.getByRole('region', { name: t('afterSave') });
const closed = () => waitFor(() => assert.equal(screen.queryByRole('dialog'), null));

async function moveDirectory(user: ReturnType<typeof userEvent.setup>) {
  const path = screen.getByRole('textbox', { name: t('localDirectory') });
  await user.clear(path);
  await user.type(path, '/work/moved');
  await screen.findByRole('region', { name: t('afterSave') });
}

for (const [state, repository, path, sidebarHint] of [
  ['an unbound', null, t('notBound'), t('bindInSidebar', { forge: githubForge.name })],
  ['a bound', github('octo/tools'), 'octo/tools', t('changeBindingInSidebar', { forge: githubForge.name })],
] as const)
  test(`${state} project's Edit project edits only name and directory, shows the binding read-only, and saves only those two`, async () => {
    const { edits } = editor(repository);
    const user = await openEditor();
    assert.equal(repositoryRow(), `${path}${sidebarHint}`);
    assert.deepEqual(
      screen.getAllByRole('textbox').map(field => field.getAttribute('id')),
      ['edit-project-name', 'edit-project-directory'],
    );
    assert.equal(screen.queryByRole('listbox'), null, 'no repository list');
    const dialog = within(screen.getByRole('dialog'));
    assert.deepEqual(
      dialog.getAllByRole('button'),
      [t('chooseNewDirectory'), sidebarHint, t('cancel'), t('saveChanges')].map(name =>
        dialog.getByRole('button', { name }),
      ),
      'no button changes the binding; the sidebar hint only points at the sidebar',
    );

    const name = screen.getByRole('textbox', { name: t('projectName') });
    await user.clear(name);
    await user.type(name, 'Renamed');
    await user.click(screen.getByRole('button', { name: t('saveChanges') }));
    await closed();
    assert.deepEqual(edits, [{ edit: { name: 'Renamed', directory: '/work/project' }, restart: false }]);
  });

test('a moved directory whose origin points elsewhere than the binding says so after saving, and the binding stays', async () => {
  const { edits } = editor(github('octo/tools'));
  const user = await openEditor();
  await moveDirectory(user);
  await waitFor(() =>
    assert.ok(
      impactRegion().textContent?.includes(
        t('originElsewhereThanBinding', { origin: 'acme/forge', repository: 'octo/tools' }),
      ),
    ),
  );
  assert.ok(impactRegion().textContent?.includes('/work/project → /work/moved'));
  await user.click(screen.getByRole('button', { name: t('changeAndRestart') }));
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
  await user.click(screen.getByRole('button', { name: t('changeWithoutRestart') }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Project', directory: '/work/moved' }, restart: false }]);
});
