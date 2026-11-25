import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/projects/ProjectManagement';
import { Localization } from '../../app/renderer/common/Localization';
import { message } from '../../app/shared/messages';
import { agentNames, type ProjectView } from '../../app/shared/model';
import { localize } from '../../app/shared/localization/localization';
import { provideWorkbench } from './support/workbench';
import { testForge, testForgeView } from './support/forge';

afterEach(cleanup);

for (const language of ['en', 'zh-CN'] as const) {
  test(`project editing and deletion explain results in ${language} and preserve user content`, async () => {
    const project: ProjectView = {
      id: 'project',
      name: 'Untitled task 原样',
      directory: '/原样/old',
      panels: [{ id: 'panel', agent: 'pi' }],
      tray: [],
      layout: { panel: 'panel' },
      repository: null,
      ...testForgeView,
    };
    const calls: unknown[] = [];
    provideWorkbench({
      inspectDirectory: async directory => ({ ok: true, directory, name: directory }),
      editProject: async (id, edit, restart) => {
        calls.push([id, edit, restart]);
        return {
          project: { ...project, ...edit },
          launches: [
            { outcome: 'failed', run: { id: 'run', projectId: id, panelId: 'panel', state: 'failed' }, agent: 'pi' },
          ],
        };
      },
      deleteProject: async id => {
        calls.push(id);
        throw new Error(message('projectDeleteFailed', { reasons: ['external-detail 原样'] }));
      },
    });
    render(
      <Localization language={language}>
        <ProjectNavigationItem project={project} openProject={() => {}} openBinding={() => {}}>
          <span>{project.name}</span>
        </ProjectNavigationItem>
      </Localization>,
    );
    const user = userEvent.setup();
    const { t } = localize(language);
    await user.click(screen.getByRole('button', { name: t('projectMenu', { name: project.name }) }));
    await user.click(screen.getByRole('menuitem', { name: t('editProject') }));
    const path = screen.getByRole('textbox', { name: t('localDirectory') });
    await user.clear(path);
    await user.type(path, '/原样/new');
    await screen.findByRole('region', { name: t('afterSave') });
    assert.ok(
      screen.getByRole('button', {
        name: t('bindInSidebar', { forge: testForge.name }),
        description: t('notBound'),
      }),
    );
    await user.click(screen.getByRole('button', { name: t('changeAndRestart') }));
    assert.deepEqual(calls, [['project', { name: project.name, directory: '/原样/new' }, true]]);
    const result = screen.getByRole('dialog');
    assert.equal(within(result).getByRole('status').textContent, t('projectSaved', { name: project.name }));
    assert.deepEqual(
      within(result)
        .getAllByRole('listitem')
        .map(item => item.textContent),
      [t('panelLaunchResult', { number: 1, agent: agentNames.pi, result: t('launchFailed') })],
    );
    await user.click(screen.getByRole('button', { name: t('finish') }));
    await user.click(screen.getByRole('button', { name: t('projectMenu', { name: project.name }) }));
    await user.click(screen.getByRole('menuitem', { name: t('deleteProject') }));
    assert.ok(screen.getByRole('heading', { name: t('deleteProjectQuestion', { name: project.name }) }));
    await user.click(screen.getByRole('button', { name: t('confirmDelete') }));
    assert.equal(calls.at(-1), 'project');
    assert.equal(
      screen.getByRole('alert').textContent,
      t('projectDeleteFailed', { reasons: ['external-detail 原样'] }),
    );
    await user.click(screen.getByRole('button', { name: t('cancel') }));
    assert.equal(screen.queryByRole('dialog'), null);
  });
}
