const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = function evidence(window) {
  const directory = process.env.VIBEBRIDGE_TEST_EVIDENCE;
  return async name => {
    if (!directory) return;
    require('electron').app.focus({ steal: true }); window.focus();
    await window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 150))))');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
};

// Optional continuous capture of the real Electron surface, including held-mouse
// states. The timestamp manifest preserves timing when encoding the PNG frames.
module.exports.record = async function record(window, name) {
  const directory = process.env.VIBEBRIDGE_TEST_EVIDENCE;
  if (!directory) return async () => {};
  const framesDirectory = join(directory, `${name}-frames`);
  await mkdir(framesDirectory, { recursive: true });
  const frames = [];
  let active = true, failure;
  const start = Date.now();
  const capture = (async () => {
    while (active) {
      const time = Date.now() - start;
      const file = `${String(frames.length).padStart(5, '0')}.png`;
      await writeFile(join(framesDirectory, file), (await window.webContents.capturePage()).toPNG());
      frames.push({ file, time });
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  })().catch(error => { failure = error; active = false; });
  return async () => {
    active = false; await capture;
    if (failure) throw failure;
    await writeFile(join(framesDirectory, 'timing.json'), JSON.stringify({ frames, duration: Date.now() - start }));
  };
};
