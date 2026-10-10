const assert = require('node:assert/strict');
const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async ({ window, evaluate, click, fill, until, directory, dialog }) => {
  const failures = [];
  const check = async (label, assertion) => {
    try { await assertion(); console.log(`PASS: ${label}`); }
    catch (error) { failures.push(error); console.error(`FAIL: ${label}: ${error.message}`); }
  };
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const value = id => evaluate(`document.getElementById(${JSON.stringify(id)}).value`);
  const blur = id => evaluate(`document.getElementById(${JSON.stringify(id)}).focus(); document.getElementById(${JSON.stringify(id)}).blur();`);
  const redWarning = text => evaluate(`Array.from(document.querySelectorAll('.setup .error-text')).some(node => node.textContent.includes(${JSON.stringify(text)}) && node.getBoundingClientRect().height > 0)`);
  const nameStatusLayout = async () => {
    await settle();
    return evaluate(`(() => {
      const name = document.getElementById('project-name');
      const status = document.getElementById('project-name-status');
      const nextLabel = document.querySelector('label[for="project-directory"]');
      return {
        height: status?.getBoundingClientRect().height ?? 0,
        gap: nextLabel.getBoundingClientRect().top - name.getBoundingClientRect().bottom,
        normalGap: parseFloat(getComputedStyle(nextLabel).marginTop)
      };
    })()`);
  };
  const assertNameStatusCollapsed = async label => {
    const layout = await nameStatusLayout();
    assert.equal(layout.height, 0, `${label}: empty name warning must not reserve height`);
    assert.equal(layout.gap, layout.normalGap, `${label}: empty name warning must not add spacing`);
    console.log(`PASS: ${label} collapses the name warning and its spacing`);
  };
  const choose = async path => {
    let returned = false;
    dialog.showOpenDialog = async () => { returned = true; return { canceled: path === null, filePaths: path === null ? [] : [path] }; };
    await click('选择本地目录');
    await until(() => returned);
    await settle();
  };
  const first = join(directory, 'first');
  const second = join(directory, 'second');
  const special = join(directory, '  👩🏽‍💻 示例\n项目\t\u0001\u007f\u0085\u2028\u2029"\' $ & [测试]  ');
  const blank = join(directory, '\u0001\t ');
  await until(() => evaluate(`!!document.getElementById('project-name')`));
  await check('new form does not report untouched empty fields', async () => assert.doesNotMatch(await evaluate('document.body.innerText'), /请输入项目名称|请选择项目目录/));
  await assertNameStatusCollapsed('untouched name');
  await blur('project-name');
  await check('empty name shows a red field warning after blur', async () => assert.equal(await redWarning('请输入项目名称'), true));
  const errorLayout = await nameStatusLayout();
  assert.ok(errorLayout.height > 0, 'name warning expands when an error is shown');
  assert.equal(errorLayout.gap, errorLayout.normalGap + errorLayout.height, 'expanded warning participates in layout');
  await fill('project-name', 'Valid project');
  await assertNameStatusCollapsed('corrected name');
  await fill('project-name', '');
  await check('clearing the corrected name expands its warning again', async () => {
    assert.equal(await redWarning('请输入项目名称'), true);
    assert.deepEqual(await nameStatusLayout(), errorLayout);
  });
  await Promise.all([first, second, special, blank].map(path => mkdir(path)));
  await blur('project-directory');
  await check('empty directory shows a red field warning after blur', async () => assert.equal(await redWarning('请选择项目目录'), true));
  if (process.env.VIBEBRIDGE_TEST_SETUP_SCREENSHOTS) {
    await settle();
    await new Promise(resolve => setTimeout(resolve, 100));
    await writeFile(join(process.env.VIBEBRIDGE_TEST_SETUP_SCREENSHOTS, 'empty-fields.png'), (await window.webContents.capturePage()).toPNG());
  }
  await fill('project-directory', `${directory}/missing`);
  await until(() => evaluate(`document.querySelector('.directory-status').textContent.includes('请选择有效的本地目录')`));
  await check('nonexistent directory explains why creation is unavailable', async () => assert.equal(await redWarning('请选择有效的本地目录'), true));
  await fill('project-directory', first);
  await check('typing a directory does not change the name', async () => assert.equal(await value('project-name'), ''));
  await fill('project-name', 'Edited then cleared');
  await fill('project-name', '');
  await choose(first);
  await check('choosing a directory fills a cleared name', async () => assert.equal(await value('project-name'), 'first'));
  await choose(second);
  await check('a previously filled name is retained on the next selection', async () => assert.equal(await value('project-name'), 'first'));
  await fill('project-name', 'Manual');
  await choose(first);
  await check('a handwritten name is retained', async () => assert.equal(await value('project-name'), 'Manual'));
  await fill('project-name', '   ');
  await choose(first);
  await check('whitespace-only name is filled even when selecting the same directory', async () => assert.equal(await value('project-name'), 'first'));
  const beforeCancel = [await value('project-name'), await value('project-directory')];
  await choose(null);
  await check('canceling the chooser preserves the draft', async () => assert.deepEqual([await value('project-name'), await value('project-directory')], beforeCancel));

  let finishChoice;
  dialog.showOpenDialog = () => new Promise(resolve => { finishChoice = resolve; });
  await fill('project-name', '');
  await click('选择本地目录');
  await until(() => !!finishChoice);
  await fill('project-name', 'Entered while waiting');
  finishChoice({ canceled: false, filePaths: [second] });
  await settle();
  await check('selection uses the name at completion, not at opening', async () => assert.equal(await value('project-name'), 'Entered while waiting'));

  await fill('project-name', '');
  await choose(blank);
  await check('an empty cleaned directory name requires a handwritten name', async () => {
    assert.equal(await value('project-name'), '');
    assert.equal(await redWarning('请输入项目名称'), true);
  });
  await fill('project-name', '');
  await choose(special);
  const cleanName = '👩🏽‍💻 示例 项目    "\' $ & [测试]';
  await check('automatic name cleans controls and retains emoji and punctuation', async () => assert.equal(await value('project-name'), cleanName));
  await click('减少窗口数量');
  await click('减少窗口数量');
  await click('增加Codex');
  await fill('project-name', 'Manual');
  await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
  await fill('project-name', 'Manual\u001bname');
  await blur('project-name');
  await check('handwritten control characters have an inline error and prevent creation', async () => {
    assert.equal(await redWarning('控制字符'), true);
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
  });
  await fill('project-name', 'Manual');
  await evaluate(`(() => { const data = new DataTransfer(); data.setData('text/plain', ${JSON.stringify('Pasted\nname')}); document.getElementById('project-name').dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); })()`);
  await check('pasted newlines are reported instead of silently dropped', async () => {
    assert.equal(await redWarning('控制字符'), true);
    assert.equal(await value('project-name'), 'Manual');
    assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
  });
  await fill('project-name', cleanName);
  await check('correcting the name clears its warning', async () => assert.equal(await redWarning('控制字符'), false));
  await assertNameStatusCollapsed('corrected pasted control characters');
  await until(() => evaluate(`!document.querySelector('button[type="submit"]').disabled`));
  await evaluate(`window.setupOutput = ''; window.workbench.subscribe(event => { if (event.kind === 'output') window.setupOutput += event.data; }); void 0;`);
  await click('创建并启动');
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 1`));
  const before = await evaluate('window.workbench.snapshot()');
  await check('creation keeps the real directory and the display name intact', async () => assert.deepEqual([before.projects[0].name, before.projects[0].directory], [cleanName, special]));
  await until(() => evaluate(`window.setupOutput.includes(${JSON.stringify(Buffer.from(special).toString('hex'))})`));
  await check('navigation abbreviation preserves the complete emoji', async () => assert.equal(await evaluate(`document.querySelector('.project-initial').textContent`), '👩🏽‍💻'));
  await click('添加项目');
  await choose(special);
  await check('a fresh draft also cleans its first automatically filled name', async () => assert.equal(await value('project-name'), cleanName));
  await until(() => evaluate(`document.querySelector('.directory-status').textContent.includes('打开已有项目')`));
  await check('duplicate directory explains the existing project in red', async () => assert.equal(await redWarning(`此目录已添加为项目『${cleanName}』，无法重复创建`), true));
  assert.equal(await evaluate(`document.querySelector('button[type="submit"]').disabled`), true);
  if (process.env.VIBEBRIDGE_TEST_SETUP_SCREENSHOTS) {
    await settle();
    await new Promise(resolve => setTimeout(resolve, 100));
    await writeFile(join(process.env.VIBEBRIDGE_TEST_SETUP_SCREENSHOTS, 'duplicate.png'), (await window.webContents.capturePage()).toPNG());
  }
  await evaluate(`Array.from(document.querySelectorAll('.directory-status button')).find(button => button.textContent.includes('打开已有项目')).click()`);
  await until(() => evaluate(`document.querySelectorAll('.xterm').length === 1`));
  const opened = await evaluate('window.workbench.snapshot()');
  assert.equal(opened.projects.length, 1);
  assert.equal(opened.activeProjectId, before.projects[0].id);
  assert.deepEqual(opened.runs, before.runs);
  if (failures.length) throw new AggregateError(failures, `${failures.length} project creation checks failed`);
  console.log('Project creation warnings, chooser, special characters and duplicate project passed.');
};
