module.exports = async ({ evaluate, until, click, fill, directory }, name = 'Desktop project') => {
  await until(() => evaluate('!!document.getElementById("project-name")'));
  await fill('project-name', name);
  await fill('project-directory', directory);
  await click('减少窗口数量'); await click('减少窗口数量'); await click('增加Codex');
  await until(() => evaluate('!document.querySelector("button[type=submit]").disabled'));
  await click('创建并启动');
  await until(() => evaluate('!!document.querySelector(".xterm-rows")'));
  return evaluate('window.workbench.snapshot()');
};
