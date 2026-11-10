const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

// Full-width punctuation alone and in adjacent pairs, the shapes Chromium's punctuation trimming squeezes.
const line = 'ab你好，世界。这是测试：（）［］｛｝「」『』【】《》〈〉〔〕、；．END';
// The line keeps to single-unit characters, ASCII in one cell and the rest in two, so a prefix's
// length in cells follows from its characters.
const cellsOf = prefix => prefix.split('').reduce((count, char) => count + (char.charCodeAt(0) < 0x80 ? 1 : 2), 0);

module.exports = {
  async run(suite) {
    const context = await require('./support/terminal-waits.cjs')(suite);
    const { window, evaluate, until } = context;
    const [run] = runsOf(await require('./support/project.cjs')(context));
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'), 'terminal shows READY:');
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    // xterm draws its cursor once the user has typed.
    window.webContents.sendInputEvent({ type: 'char', keyCode: 'k' });
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("INPUT:k")'), 'terminal echoes typed k');
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(`print:${line}`)})`);
    await until(() => evaluate(`document.querySelector(".xterm-rows > div").textContent.startsWith(${JSON.stringify(line)})`), 'full-width punctuation line drawn on the first row');

    window.webContents.debugger.attach();
    try {
      await window.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
      await until(() => evaluate('(view => view?.classList.contains("active") && !!view.style.left)(document.querySelector(".composition-view"))'), 'IME composition view active and positioned');
      // Each drawn position, or a description of where it is off its cell.
      const offGrid = async () => {
        const { chars, cursor, composition } = await evaluate(`(() => {
          const row = document.querySelector('.xterm-rows > div');
          const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
          const range = document.createRange(); const chars = [];
          for (let node; (node = walker.nextNode());) for (let i = 0; i < node.length; i++) {
            range.setStart(node, i); range.setEnd(node, i + 1);
            chars.push({ char: node.data[i], left: range.getBoundingClientRect().left });
          }
          return { chars, cursor: row.querySelector('.xterm-cursor')?.getBoundingClientRect().left,
            composition: document.querySelector('.composition-view').getBoundingClientRect().left };
        })()`);
        if (chars.length < line.length) return [`the first row draws ${chars.length} of ${line.length} characters`];
        const origin = chars[0].left; const cell = chars[1].left - origin;
        // A squeezed mark shifts later text by about 0.8 cells; a quarter cell absorbs sub-pixel rounding.
        const check = (left, column, label) => left !== undefined && Math.abs(left - (origin + column * cell)) < cell / 4 ? []
          : [`${label} is drawn at ${left === undefined ? 'no position' : (left - origin) / cell} cells; its cell is ${column}`];
        return [...chars.slice(0, line.length).flatMap((char, i) => check(char.left, cellsOf(line.slice(0, i)), `"${char.char}" at index ${i}`)),
          ...check(cursor, cellsOf(line), 'The cursor'), ...check(composition, cellsOf(line), 'The composition view')];
      };
      let problems;
      await suite.until(async () => (problems = await offGrid()).length === 0, 'text, cursor and composition view drawn on their terminal cells',
        { context: () => problems.join('\n') });
    } finally {
      await window.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }).catch(() => {});
      window.webContents.debugger.detach();
    }
    console.log('Text after full-width punctuation, the cursor and the IME composition view all sat on their terminal cells.');
  },
};
