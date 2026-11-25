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
import { testForge, testForgeRepository, testForgeView } from './support/forge';
import { t } from './support/localization';

afterEach(cleanup);

const projectName = 'Project';
const atTestForge = (path: string) => testForgeRepository(path);
const listed = async (directory: string): Promise<RepositoryChoices> => ({
  ok: true,
  forge: testForge,
  account: 'ada',
  origin: atTestForge(directory === '/work/moved' ? 'acme/forge' : 'ada/vibebridge'),
  repositories: ['ada/tools', 'ada/vibebridge', 'acme/forge'].map(atTestForge),
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
    ...testForgeView,
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

const impactRegion = () => screen.getByRole('region', { name: t('afterSave') });
const closed = () => waitFor(() => assert.equal(screen.queryByRole('dialog'), null));

async function moveDirectory(user: ReturnType<typeof userEvent.setup>) {
  const path = screen.getByRole('textbox', { name: t('localDirectory') });
  await user.clear(path);
  await user.type(path, '/work/moved');
  await screen.findByRole('region', { name: t('afterSave') });
}

for (const [state, repository, path, sidebarHint] of [
  ['an unbound', null, t('notBound'), t('bindInSidebar', { forge: testForge.name })],
  ['a bound', atTestForge('ada/tools'), 'ada/tools', t('changeBindingInSidebar', { forge: testForge.name })],
] as const)
  test(`${state} project's Edit project edits only name and directory, shows the binding read-only, and saves only those two`, async () => {
    const { edits } = editor(repository);
    const user = await openEditor();
    assert.ok(screen.getByRole('button', { name: sidebarHint, description: path }), 'the binding shows read-only');
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
  const { edits } = editor(atTestForge('ada/tools'));
  const user = await openEditor();
  await moveDirectory(user);
  await waitFor(() =>
    assert.ok(
      impactRegion().textContent?.includes(
        t('originElsewhereThanBinding', { origin: 'acme/forge', repository: 'ada/tools' }),
      ),
    ),
  );
  assert.ok(impactRegion().textContent?.includes('/work/project → /work/moved'));
  await user.click(screen.getByRole('button', { name: t('changeAndRestart') }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Project', directory: '/work/moved' }, restart: true }]);
});

test('a moved directory whose repositories cannot be listed still saves', async () => {
  const { edits } = editor(atTestForge('ada/tools'), async () => ({
    ok: false,
    failure: { kind: 'notInstalled', detail: '', forge: testForge },
  }));
  const user = await openEditor();
  await moveDirectory(user);
  await user.click(screen.getByRole('button', { name: t('changeWithoutRestart') }));
  await closed();
  assert.deepEqual(edits, [{ edit: { name: 'Project', directory: '/work/moved' }, restart: false }]);
});
