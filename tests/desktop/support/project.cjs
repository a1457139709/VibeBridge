module.exports = async ({ evaluate, until, click, fill, directory }, name = 'Desktop project') => {
  await until(() => evaluate('!!document.getElementById("project-name")'));
  await fill('project-name', name);
  await fill('project-directory', directory);
  await click('Decrease Window count'); await click('Decrease Window count'); await click('Increase Codex');
  await until(() => evaluate('!document.querySelector("button[type=submit]").disabled'));
  await click('Create and start');
  await until(() => evaluate('!!document.querySelector(".xterm-rows")'));
  return evaluate('window.workbench.snapshot()');
};
