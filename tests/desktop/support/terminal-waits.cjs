// Suite context for terminal suites. It collects run output in `window.output`; a timed-out wait also reports the
// last 500 characters of it and the text the terminal drew. `reportedSize` asks a run for its PTY size. Pass the returned context on so support modules wait the same way.
module.exports = async context => {
  await context.evaluate('window.output = ""; window.workbench.subscribe(event => { if (event.kind === "output") window.output += event.data; }); void 0;');
  const describeTerminal = async () => {
    const { output, rows } = await context.evaluate(`({ output: window.output.slice(-500),
      rows: document.querySelector('.xterm-rows')?.textContent ?? null })`);
    return `window.output (last 500 characters): ${JSON.stringify(output)}\n.xterm-rows: ${JSON.stringify(rows)}`;
  };
  const until = (check, label, options) => context.until(check, label, { ...options, context: describeTerminal });
  // Asks the run for its size until it answers; the answer is the size its PTY has now.
  async function reportedSize(runId) {
    await context.evaluate(`window.output = ''; window.workbench.sendInput(${JSON.stringify(runId)}, 'size')`);
    await until(() => context.evaluate('/SIZE:\\d+x\\d+\\r/.test(window.output)'), 'run answered the size query');
    const [, cols, rows] = await context.evaluate('window.output.match(/SIZE:(\\d+)x(\\d+)/)');
    return { cols: Number(cols), rows: Number(rows) };
  }
  return { ...context, until, reportedSize };
};
