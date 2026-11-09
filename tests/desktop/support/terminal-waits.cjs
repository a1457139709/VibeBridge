// Suite context for terminal suites: a timed-out wait also reports the end of `window.output`, the run output the
// suite collects, and the text the terminal drew. Pass the returned context on so support modules wait the same way.
module.exports = context => {
  const terminal = async () => {
    const { output, rows } = await context.evaluate(`({ output: typeof window.output === 'string' ? window.output.slice(-500) : null,
      rows: document.querySelector('.xterm-rows')?.textContent ?? null })`);
    return `window.output (last 500 characters): ${JSON.stringify(output)}\n.xterm-rows: ${JSON.stringify(rows)}`;
  };
  return { ...context, until: (check, label, options) => context.until(check, label, { ...options, context: terminal }) };
};
