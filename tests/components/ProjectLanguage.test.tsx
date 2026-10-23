import './support/dom';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ProjectNavigationItem } from '../../app/renderer/ProjectManagement';
import { Localization } from '../../app/renderer/Localization';
import { message } from '../../app/shared/messages';
import type { Project } from '../../app/shared/model';
import { provideWorkbench } from './support/workbench';

afterEach(cleanup);

for (const language of ['en', 'zh-CN'] as const) {
  test(`project editing and deletion explain results in ${language} and preserve user content`, async () => {
    const project: Project = { id: 'project', name: 'Untitled task 原样', directory: '/原样/old', panels: [{ id: 'panel', agent: 'pi' }], layout: { panel: 'panel' } };
    const calls: unknown[] = [];
    provideWorkbench({ inspectDirectory: async directory => ({ valid: true, directory }),
      editProject: async (id, edit, restart) => {
        calls.push([id, edit, restart]);
        return { project: { ...project, ...edit }, launches: [{ ok: false, run: { id: 'run', projectId: id, panelId: 'panel', state: 'failed' }, error: message('launchFailed') }] };
      },
      deleteProject: async id => { calls.push(id); throw new Error(message('projectDeleteFailed', { reasons: ['external-detail 原样'] })); },
    });
    render(<Localization language={language}><ProjectNavigationItem project={project} runs={[]} openProject={() => {}}><span>{project.name}</span></ProjectNavigationItem></Localization>);
    const user = userEvent.setup();
    const en = language === 'en';
    await user.click(screen.getByRole('button', { name: `${en ? 'Project menu: ' : '项目菜单：'}${project.name}` }));
    await user.click(screen.getByRole('menuitem', { name: en ? 'Edit project' : '编辑项目' }));
    const path = screen.getByRole('textbox', { name: en ? 'Local directory' : '本地目录' });
    await user.clear(path); await user.type(path, '/原样/new');
    await screen.findByText(en ? 'Previous directory' : '原目录');
    await user.click(screen.getByRole('button', { name: en ? 'Change and restart' : '更改并重启' }));
    assert.deepEqual(calls, [['project', { name: project.name, directory: '/原样/new' }, true]]);
    assert.ok(screen.getByText(en ? 'Saved project name and directory: Untitled task 原样' : '已保存项目名称和目录：Untitled task 原样'));
    assert.ok(screen.getByText(en ? 'Panel 1 · pi: Agent could not start' : '面板 1 · pi：Agent 无法启动'));
    await user.click(screen.getByRole('button', { name: en ? 'Done' : '完成' }));
    await user.click(screen.getByRole('button', { name: `${en ? 'Project menu: ' : '项目菜单：'}${project.name}` }));
    await user.click(screen.getByRole('menuitem', { name: en ? 'Delete project' : '删除项目' }));
    assert.ok(screen.getByRole('heading', { name: en ? 'Delete project “Untitled task 原样”?' : '删除项目「Untitled task 原样」？' }));
    await user.click(screen.getByRole('button', { name: en ? 'Confirm deletion' : '确认删除' }));
    assert.equal(calls.at(-1), 'project');
    assert.equal(screen.getByRole('alert').textContent, en
      ? 'Project was not deleted because its runs could not stop: external-detail 原样'
      : '项目未删除，停止失败：external-detail 原样');
    await user.click(screen.getByRole('button', { name: en ? 'Cancel' : '取消' }));
    assert.equal(screen.queryByRole('dialog'), null);
  });
}
