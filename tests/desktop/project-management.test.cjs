const assert = require('node:assert/strict');
const { mkdir, symlink } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = {
  async run({ window, evaluate, click, fill, until, directory }) {
    const target = join(directory, 'target'), secondPath = join(directory, 'second'), alias = join(directory, 'alias');
    await mkdir(target); await mkdir(secondPath); await symlink(directory, alias);
    await until(() => evaluate(`!!document.getElementById('project-name')`));
    await fill('project-name', 'First'); await fill('project-directory', directory);
    await click('减少窗口数量'); await click('减少窗口数量'); await click('增加Codex');
    await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
    await click('创建并启动');
    await until(() => evaluate(`!!document.querySelector('.xterm')`));
    const original = await evaluate('window.workbench.snapshot()');
    const first = original.projects[0];
    await click('项目菜单：First'); await click('编辑项目');
    await until(() => evaluate(`!!document.querySelector('dialog[open]')`));
    assert.equal(await evaluate(`document.getElementById('edit-project-name').value`), 'First');
    assert.equal(await evaluate(`document.getElementById('edit-project-directory').value`), directory);
    await click('保存修改');
    await until(() => evaluate(`!document.querySelector('dialog[open]')`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, original.runs);
    console.log('PASS: project overflow menu opens a prefilled editor and unchanged save closes it');

    // Native right-click opens the very same menu without activating another project.
    const center = await evaluate(`(() => { const b = document.querySelector('.project-link').getBoundingClientRect(); return { x: Math.round(b.left + 50), y: Math.round(b.top + b.height / 2) }; })()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', ...center, button: 'right', clickCount: 1 });
    window.webContents.sendInputEvent({ type: 'mouseUp', ...center, button: 'right', clickCount: 1 });
    await until(() => evaluate(`!!document.querySelector('[role="menu"]')`));
    assert.equal(await evaluate(`document.querySelector('[role="menu"]').innerText`), '编辑项目\n删除项目');
    await click('编辑项目');
    await fill('edit-project-name', 'Renamed'); await click('保存修改');
    await until(() => evaluate(`!document.querySelector('dialog[open]')`));
    assert.equal(await evaluate(`document.querySelector('.project-name').textContent`), 'Renamed');
    assert.ok((await evaluate('document.body.innerText')).includes('Renamed'));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, original.runs);
    console.log('PASS: native context menu shares actions; rename preserves the live run');

    await click('项目菜单：Renamed'); await click('编辑项目');
    await fill('edit-project-name', 'Cancelled'); await fill('edit-project-directory', target);
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === '更改并重启')`));
    assert.equal(await evaluate(`document.querySelectorAll('dialog[open]').length`), 1);
    const text = await evaluate(`document.querySelector('dialog').innerText`);
    assert.match(text, /当前运行实例：1/); assert.match(text, /原目录/); assert.match(text, /新目录/);
    assert.match(text, /实际工作目录/); assert.match(text, /CLI.*历史/);
    await fill('edit-project-directory', alias);
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === '保存修改' && !b.disabled)`));
    await fill('edit-project-directory', target);
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === '取消更改')`));
    await click('取消更改');
    assert.equal((await evaluate('window.workbench.snapshot()')).projects[0].name, 'Renamed');
    assert.equal((await evaluate('window.workbench.snapshot()')).projects[0].directory, directory);
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs, original.runs);
    console.log('PASS: single-dialog directory decisions, real-path reversal and cancellation preserve state');

    const second = (await evaluate(`window.workbench.createProject(${JSON.stringify({ name: 'Second', directory: secondPath, total: 1, counts: { codex: 1, claude: 0, pi: 0 } })})`)).project;
    await click('项目菜单：Renamed'); await click('编辑项目');
    await fill('edit-project-name', '');
    await until(() => evaluate(`document.querySelector('dialog').innerText.includes('请输入项目名称')`));
    await fill('edit-project-name', 'Renamed'); await fill('edit-project-directory', secondPath);
    await until(() => evaluate(`document.querySelector('dialog').innerText.includes('Second') && !!document.querySelector('dialog .open-existing-project')`));
    await click('打开已有项目');
    await until(() => evaluate(`!document.querySelector('dialog')`));
    assert.equal((await evaluate('window.workbench.snapshot()')).activeProjectId, second.id);
    await click('项目菜单：Renamed'); await click('编辑项目');
    await fill('edit-project-directory', target);
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === '更改但不重启' && !b.disabled)`));
    await click('更改但不重启');
    await until(() => evaluate(`!document.querySelector('dialog')`));
    await click('Renamed');
    await until(() => evaluate(`document.querySelector('.workspace-toolbar .project-path')?.getAttribute('title') === ${JSON.stringify(target)}`));
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).runs.find(r => r.projectId === first.id), original.runs[0]);
    console.log('PASS: duplicate directory opens its project; no-restart save shows the new directory');

    await click('项目菜单：Renamed'); await click('编辑项目');
    await fill('edit-project-directory', directory);
    await until(() => evaluate(`!!Array.from(document.querySelectorAll('dialog button')).find(b => b.textContent === '更改并重启' && !b.disabled)`));
    await click('更改并重启');
    await until(() => evaluate(`document.querySelector('dialog')?.innerText.includes('启动成功')`));
    await click('完成');
    const after = await evaluate('window.workbench.snapshot()');
    assert.deepEqual(after.projects[0].panels, first.panels); assert.deepEqual(after.projects[0].layout, first.layout);
    assert.notEqual(after.runs.find(r => r.projectId === first.id).id, original.runs[0].id);
    await click('项目菜单：Renamed'); await click('删除项目');
    assert.match(await evaluate(`document.querySelector('dialog').innerText`), /本地目录、文件和 CLI 历史.*保留/);
    await click('取消');
    assert.deepEqual((await evaluate('window.workbench.snapshot()')).projects, after.projects);
    await click('项目菜单：Renamed'); await click('删除项目'); await click('确认删除');
    await until(async () => (await evaluate('window.workbench.snapshot()')).projects.length === 1);
    assert.equal((await evaluate('window.workbench.snapshot()')).activeProjectId, second.id);
    await click('项目菜单：Second'); await click('删除项目'); await click('确认删除');
    await until(() => evaluate(`document.body.innerText.includes('让你的 Agent 在同一个工作台中并行工作')`));
    console.log('PASS: restart shows per-panel results, deletion cancellation and final empty workbench');
  },
};
