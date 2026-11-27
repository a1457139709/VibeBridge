import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/projects/ProjectManagement';
import { Localization } from '../../app/renderer/common/Localization';
import type { ProjectView } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';
import { testForgeView } from './support/forge';
import { t } from './support/localization';

afterEach(cleanup);

const project: ProjectView = {
  id: 'project',
  name: 'Project',
  directory: '/work/project',
  panels: [],
  tray: [],
  layout: null,
  repository: null,
  ...testForgeView,
};

function renderItem() {
  provideWorkbench({
    inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
  });
  render(
    <Localization language="en">
      <ProjectNavigationItem project={project} openProject={() => {}} openBinding={() => {}}>
        <span>{project.name}</span>
      </ProjectNavigationItem>
    </Localization>,
  );
  return userEvent.setup();
}

const trigger = () => screen.getByRole('button', { name: t('projectMenu', { name: project.name }) });
const menu = () => screen.queryByRole('menu');

test('opening the project menu focuses its first item; Escape closes it', async () => {
  const user = renderItem();
  await user.click(trigger());
  assert.equal(document.activeElement, screen.getByRole('menuitem', { name: t('editProject') }));
  assert.equal(trigger().getAttribute('aria-expanded'), 'true');
  await user.keyboard('{Escape}');
  assert.equal(menu(), null);
  assert.equal(trigger().getAttribute('aria-expanded'), 'false');
});

test('a press outside the project menu closes it, a press inside keeps it open', async () => {
  const user = renderItem();
  await user.click(trigger());
  await user.pointer({ keys: '[MouseLeft>]', target: screen.getByRole('menuitem', { name: t('deleteProject') }) });
  assert.ok(menu());
  await user.pointer({ keys: '[/MouseLeft]', target: document.body });
  await user.click(document.body);
  assert.equal(menu(), null);
});

test('a right click opens the project menu at the pointer with its first item focused', async () => {
  const user = renderItem();
  await user.pointer({ keys: '[MouseRight]', target: trigger(), coords: { clientX: 40, clientY: 50 } });
  const opened = screen.getByRole('menu');
  assert.equal(opened.style.left, '40px');
  assert.equal(opened.style.top, '50px');
  assert.equal(document.activeElement, screen.getByRole('menuitem', { name: t('editProject') }));
});

for (const item of [t('editProject'), t('deleteProject')])
  test(`${item} opens a modal dialog that Escape closes`, async () => {
    const user = renderItem();
    await user.click(trigger());
    await user.click(screen.getByRole('menuitem', { name: item }));
    const dialog = screen.getByRole<HTMLDialogElement>('dialog', { name: item });
    assert.equal(dialog.open, true);
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    assert.equal(screen.queryByRole('dialog'), null);
    assert.equal(dialog.open, false);
  });
