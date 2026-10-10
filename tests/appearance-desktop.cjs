const assert = require('node:assert/strict');

module.exports = async function verifyAppearance({ window, evaluate, until, run }) {
  assert.equal(await evaluate('document.documentElement.dataset.theme'), 'dark');
  // The fixture emits pi's dark-theme footer RGB plus indexed and ANSI gray.
  await evaluate(`window.workbench.sendInput(${JSON.stringify(run.id)}, 'palette')`);
  await until(() => evaluate(`document.querySelector('.xterm-rows')?.textContent.includes('PI-FOOTER')`));
  const colors = await evaluate(`(() => {
    const terminal = document.querySelector('[data-panel-id="${run.panelId}"] .xterm');
    const rgb = value => value.match(/[\\d.]+/g).slice(0, 3).map(Number);
    let background = terminal;
    while (getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
    return {
      background: rgb(getComputedStyle(background).backgroundColor),
      samples: ['ANSI-GRAY', 'INDEXED-GRAY', 'PI-FOOTER', 'ACCENT', 'TEXT', 'DIM', '\u2588\u2588'].map(label => {
        const span = [...terminal.querySelectorAll('.xterm-rows span')].find(span => span.textContent.includes(label));
        const style = getComputedStyle(span);
        const alpha = Number(style.color.match(/[\\d.]+/g)[3] ?? 1);
        return { label, color: rgb(style.color), opacity: Number(style.opacity) * alpha };
      })
    };
  })()`);
  const luminance = rgb => rgb.map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  const bg = luminance(colors.background);
  assert.deepEqual(colors.background, [38, 42, 40]);
  const failures = [];
  for (const { label, color, opacity } of colors.samples) {
    const fg = luminance(color.map((value, index) => opacity * value + (1 - opacity) * colors.background[index]));
    const ratio = (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05);
    console.log(`${label}: RGB ${color.join(',')} on ${colors.background.join(',')}, contrast ${ratio.toFixed(2)}:1`);
    if (!['DIM', '\u2588\u2588'].includes(label) && ratio < 4.5) failures.push(`${label} contrast ${ratio.toFixed(2)} is below 4.5`);
  }
  assert.deepEqual(colors.samples.find(sample => sample.label === 'ACCENT').color, [138, 190, 183], 'Already legible CLI colors are preserved');
  assert.deepEqual(colors.samples.find(sample => sample.label === '\u2588\u2588').color, [102, 102, 102], 'Block graphics keep their original colors');
  const dim = colors.samples.find(sample => sample.label === 'DIM');
  const normal = colors.samples.find(sample => sample.label === 'TEXT');
  assert.ok(dim.opacity < normal.opacity, 'SGR dim remains visually distinct');
  if (process.env.VIBEBRIDGE_TEST_SCREENSHOT) {
    await require('node:fs/promises').writeFile(process.env.VIBEBRIDGE_TEST_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(failures, []);
};
