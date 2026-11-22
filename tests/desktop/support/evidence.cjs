const { mkdir, writeFile } = require('node:fs/promises');
const { join } = require('node:path');

module.exports = async function evidence(window) {
  const directory = process.env.VIBEBRIDGE_TEST_EVIDENCE;
  await mkdir(directory, { recursive: true });
  const results = await Promise.allSettled([
    window.webContents.capturePage().then(image => writeFile(join(directory, 'failure.png'), image.toPNG())),
    window.webContents
      .executeJavaScript('document.body.innerText')
      .then(text => writeFile(join(directory, 'renderer.txt'), text)),
    window.webContents
      .executeJavaScript('window.workbench.fetchSnapshot()')
      .then(snapshot => writeFile(join(directory, 'snapshot.json'), JSON.stringify(snapshot, null, 2))),
  ]);
  for (const result of results)
    if (result.status === 'rejected') console.error('Diagnostic unavailable:', result.reason);
};
