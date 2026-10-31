const assert = require('node:assert/strict');
const { runsOf } = require('./support/panel-views.cjs');

// Full-width punctuation alone and in adjacent pairs, the shapes Chromium's punctuation trimming squeezes.
const line = 'ab你好，世界。这是测试：（）［］｛｝「」『』【】《》〈〉〔〕、；．END';
// Every non-ASCII character in the line occupies two cells.
const cells = text => [...text].reduce((count, char) => count + (char.charCodeAt(0) < 0x80 ? 1 : 2), 0);

module.exports = {
  async run(context) {
    const { window, evaluate, until } = context;
    const [run] = runsOf(await require('./support/project.cjs')(context));
    await until(() => evaluate('document.querySelector(".xterm-rows").textContent.includes("READY:")'));
    await evaluate('document.querySelector(".xterm-helper-textarea").focus()');
    await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, ${JSON.stringify(`print:${line}`)})`);
    await until(() => evaluate(`document.querySelector(".xterm-rows > div").textContent.startsWith(${JSON.stringify(line)})`));

    window.webContents.debugger.attach();
    try {
      await window.webContents.debugger.sendCommand('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 });
      await until(() => evaluate('(view => view?.classList.contains("active") && !!view.style.left)(document.querySelector(".composition-view"))'));
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      const { chars, cursor, composition } = await evaluate(`(() => {
        const row = document.querySelector('.xterm-rows > div');
        const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
        const range = document.createRange(); const chars = [];
        for (let node; (node = walker.nextNode());) for (let i = 0; i < node.length; i++) {
          range.setStart(node, i); range.setEnd(node, i + 1);
          chars.push({ char: node.data[i], left: range.getBoundingClientRect().left });
        }
        return { chars, cursor: row.querySelector('.xterm-cursor').getBoundingClientRect().left,
          composition: document.querySelector('.composition-view').getBoundingClientRect().left };
      })()`);
      const origin = chars[0].left; const cell = chars[1].left - origin;
      const onGrid = (left, column, what) => assert.ok(Math.abs(left - (origin + column * cell)) < 1,
        `${what} is drawn at ${(left - origin) / cell} cells; its cell is ${column}`);
      for (let i = 0; i < line.length; i++) onGrid(chars[i].left, cells(line.slice(0, i)), `"${chars[i].char}" at index ${i}`);
      onGrid(cursor, cells(line), 'The cursor');
      onGrid(composition, cells(line), 'The composition view');
    } finally {
      await window.webContents.debugger.sendCommand('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 }).catch(() => {});
      window.webContents.debugger.detach();
    }
    console.log('Text after full-width punctuation, the cursor and the IME composition view all sat on their terminal cells.');
  },
};
