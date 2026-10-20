module.exports = ({ window, evaluate, until }, projectId) => {
  const settle = () => evaluate('new Promise(resolve => setTimeout(() => requestAnimationFrame(resolve), 250))');
  const save = async value => { await evaluate(`window.workbench.saveLayout(${JSON.stringify(projectId)}, ${JSON.stringify(value)})`); await settle(); };
  const rect = (selector, index = 0) => evaluate(`(() => { const r = document.querySelectorAll(${JSON.stringify(selector)})[${index}].getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; })()`);
  const panel = id => `[data-panel-id="${id}"] .agent-panel`;
  const size = async run => {
    const start = await evaluate('window.observedOutput.length');
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'size')`);
    await until(() => evaluate(`window.observedOutput.slice(${start}).some(event => event.runId === ${JSON.stringify(run.id)} && /SIZE:\\d+x\\d+/.test(event.data))`));
    return evaluate(`window.observedOutput.slice(${start}).filter(event => event.runId === ${JSON.stringify(run.id)}).map(event => event.data).join('').match(/SIZE:(\\d+)x(\\d+)/).slice(1).map(Number)`);
  };
  const mouse = (type, x, y) => window.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), ...(type === 'mouseMove' ? { modifiers: ['leftButtonDown'] } : { button: 'left', clickCount: 1 }) });
  return { settle, save, rect, panel, size, mouse };
};
