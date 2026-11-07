// Creates a project through the project creation guide; its panels become resident panels.
// `counts` assigns Agents by their displayed names, e.g. { Codex: 2, pi: 1 }.
module.exports = async ({ evaluate, until, click, fill, directory }, name = 'Desktop project', counts = { Codex: 1 }) => {
  await until(() => evaluate('!!document.getElementById("project-name")'));
  await fill('project-name', name);
  await fill('project-directory', directory);
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const current = await evaluate('Number(document.querySelector(".quantity-row output").textContent)');
  for (let step = current; step > total; step--) await click('Decrease Window count');
  for (let step = current; step < total; step++) await click('Increase Window count');
  for (const [agent, count] of Object.entries(counts)) for (let i = 0; i < count; i++) await click(`Increase ${agent}`);
  await until(() => evaluate('!document.querySelector("button[type=submit]").disabled'));
  await click('Create and start');
  await until(() => evaluate(`document.querySelectorAll(".canvas .xterm-rows").length === ${total}`));
  return evaluate('window.workbench.snapshot()');
};
