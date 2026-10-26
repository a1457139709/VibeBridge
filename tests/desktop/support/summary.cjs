const assert = require('node:assert/strict');
const { resolve } = require('node:path');

module.exports = async context => {
  const { evaluate, until, click, window } = context;
  const command = { command: process.env.VIBEBRIDGE_TEST_NODE, args: [resolve('tests/fixtures/status-cli.cjs')] };
  await evaluate(`window.workbench.saveSettings(${JSON.stringify({ agents: { codex: command, claude: command, pi: command } })})`);
  await evaluate(`window.summaryOutput = {}; window.workbench.subscribe(event => {
    if (event.kind === 'output') window.summaryOutput[event.runId] = (window.summaryOutput[event.runId] || '') + event.data;
  }); void 0;`);
  const created = await require('./project.cjs')(context, 'Summary project');
  const projectId = created.activeProjectId;
  for (let i = 0; i < 2; i++) await evaluate(`window.workbench.addPanel(${JSON.stringify(projectId)}, 'codex')`);
  const snapshot = () => evaluate('window.workbench.snapshot()');
  const runs = (await snapshot()).runs;
  let sequence = 0;
  // Every run reports one shared CLI session ID; a different session's facts are discarded.
  const session = 'same-session';
  const send = async (run, message) => {
    const id = `summary-${++sequence}`;
    const payload = message.payload && { session_id: session, ...message.payload };
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(JSON.stringify({ ...message, payload, id }) + '\n')})`);
    await until(() => evaluate(`window.summaryOutput[${JSON.stringify(run.id)}]?.includes(${JSON.stringify(`ACK:${id}\r\n`)})`));
  };
  const nativeKey = keyCode => {
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode });
  };
  const focused = run => evaluate(`document.activeElement?.classList.contains('xterm-helper-textarea') && document.activeElement.closest('[data-panel-id]')?.dataset.panelId === ${JSON.stringify(run.panelId)}`);
  const receiveInput = async (run, marker) => {
    await until(() => focused(run));
    const message = JSON.stringify({ id: marker, output: `RECEIVED:${marker}\n` });
    for (const character of message) window.webContents.sendInputEvent({ type: 'char', keyCode: character });
    nativeKey('Enter');
    await until(() => evaluate(`window.summaryOutput[${JSON.stringify(run.id)}]?.includes(${JSON.stringify(`ACK:${marker}\r\n`)})`));
    const outputs = await evaluate('window.summaryOutput');
    for (const other of runs.filter(other => other.id !== run.id)) assert.ok(!outputs[other.id]?.includes(`ACK:${marker}\r\n`));
    await until(() => evaluate(`document.querySelector('[data-panel-id="${run.panelId}"] .xterm-rows').textContent.includes(${JSON.stringify(`RECEIVED:${marker}`)})`));
  };
  const open = async state => {
    const current = await snapshot();
    const group = current.processing.projects[projectId][state];
    const labels = current.settings.language === 'zh-CN'
      ? { ready: '就绪', 'needs-input': '等待输入', done: '本轮结束', error: '异常' }
      : { ready: 'Ready', 'needs-input': 'Needs input', done: 'Done', error: 'Error' };
    await click(`${group.count} ${labels[state]}`);
    await until(() => evaluate('!!document.querySelector(".summary-list")'));
  };
  const choose = async (state, run) => {
    await open(state);
    await evaluate(`document.querySelector('.summary-list [data-run-id="${run.id}"] button').click()`);
    await until(() => evaluate('!document.querySelector(".summary-list")'));
  };
  for (const [index, run] of runs.entries()) await send(run, {
    payload: { hook_event_name: index === 2 ? 'PermissionRequest' : 'Stop' },
    output: `\x1b]2;Summary session ${index + 1} with a long title | project\x07`,
  });
  return { projectId, runs, snapshot, send, nativeKey, focused, receiveInput, open, choose };
};
