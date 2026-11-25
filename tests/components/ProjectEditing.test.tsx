import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/projects/ProjectManagement';
import type { ProjectView } from '../../app/shared/model';
import type { RepositoryChoices } from '../../app/shared/forge/forge';
import { deferred, provideWorkbench } from './support/workbench';
import { testForge, testForgeRepository, testForgeView } from './support/forge';
import { t } from './support/localization';

afterEach(cleanup);

const project: ProjectView = {
  id: 'project',
  name: 'Example',
  directory: '/old',
  panels: [],
  tray: [],
  layout: null,
  repository: testForgeRepository('team/bound'),
  ...testForgeView,
};

function renderItem() {
  render(
    <ProjectNavigationItem project={project} openProject={() => {}} openBinding={() => {}}>
      <span>{project.name}</span>
    </ProjectNavigationItem>,
  );
  return userEvent.setup();
}

const openMenu = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: t('projectMenu', { name: project.name }) }));

test('the project menu focuses its first item and closes on Escape or a press outside it', async () => {
  provideWorkbench({});
  const user = renderItem();
  await openMenu(user);
  await waitFor(() => assert.equal(document.activeElement, screen.getByRole('menuitem', { name: t('editProject') })));
  await user.keyboard('{Escape}');
  assert.equal(screen.queryByRole('menu'), null);
  await openMenu(user);
  assert.ok(screen.getByRole('menu'));
  await user.click(document.body);
  assert.equal(screen.queryByRole('menu'), null);
});

test('editing a bound project notes the origin of the current directory and drops a late listing for an earlier one', async () => {
  const listings: Record<string, ReturnType<typeof deferred<RepositoryChoices>>> = {
    '/A': deferred(),
    '/B': deferred(),
  };
  const listed = (path: string): RepositoryChoices => ({
    ok: true,
    forge: testForge,
    account: 'me',
    repositories: [],
    origin: testForgeRepository(path),
  });
  provideWorkbench({
    inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
    fetchRepositoryChoices: async (_projectId, directory) => listings[directory].promise,
  });
  const user = renderItem();
  await openMenu(user);
  await user.click(screen.getByRole('menuitem', { name: t('editProject') }));
  const path = screen.getByRole('textbox', { name: t('localDirectory') });
  await user.clear(path);
  await user.type(path, '/A');
  await screen.findByRole('region', { name: t('afterSave') });
  await user.clear(path);
  await user.type(path, '/B');
  await waitFor(() => assert.match(screen.getByRole('region', { name: t('afterSave') }).textContent, /\/old → \/B/));
  await act(async () => listings['/B'].resolve(listed('team/b')));
  const repositoryNotes = () =>
    within(screen.getByRole('region', { name: t('afterSave') }))
      .getAllByRole('definition')
      .slice(1)
      .map(note => note.textContent);
  const note = t('originElsewhereThanBinding', { origin: 'team/b', repository: 'team/bound' });
  await waitFor(() => assert.deepEqual(repositoryNotes(), [note]));
  await act(async () => listings['/A'].resolve(listed('team/a')));
  assert.deepEqual(repositoryNotes(), [note]);
});
