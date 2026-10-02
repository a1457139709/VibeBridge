// THROWAWAY: one window + one common PTY host. No product persistence.
const { app, BrowserWindow, ipcMain, utilityProcess, clipboard, Menu, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { tmpdir } = require('node:os');
// Deliberately disposable; never writes product settings or any CLI configuration.
const themeFile = path.join(tmpdir(), 'vibebridge-terminal-settings.prototype.json');
const isTheme = value => ['system', 'dark', 'light'].includes(value);
let savedTheme = 'system';
try {
  const saved = JSON.parse(fs.readFileSync(themeFile, 'utf8'));
  if (isTheme(saved.theme)) savedTheme = saved.theme;
} catch (error) { if (error.code !== 'ENOENT') console.warn('原型主题配置无法读取，使用跟随系统'); }
const runtime = process.env.VIBEBRIDGE_PROTOTYPE_RUNTIME;
if (!runtime) throw new Error('请从 npm run prototype:terminal 启动');
const config = JSON.parse(fs.readFileSync(path.join(runtime, 'launch.json'), 'utf8'));
const startupPreference = isTheme(config.startupTheme) ? config.startupTheme : savedTheme;
app.setName('VibeBridge Terminal Prototype');
app.setPath('userData', path.join(runtime, 'electron-profile'));
const renderer = path.resolve(__dirname, '../../dist.terminal.prototype/index.html');
let window, host, quitting = false, stopped = false, sequence = 0;
const pending = new Map();
let hostReady;
const ready = new Promise(resolve => { hostReady = resolve; });
const request = async message => {
  await ready;
  if (stopped) throw new Error('终端管理进程已结束，请重新启动原型');
  return new Promise((resolve, reject) => {
    const requestId = ++sequence;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('终端管理进程响应超时')); }, 10000);
    pending.set(requestId, { resolve, reject, timer });
    host.postMessage({ ...message, requestId });
  });
};
function trusted(event) {
  try { return event.sender === window?.webContents && event.senderFrame === window.webContents.mainFrame && fileURLToPath(event.senderFrame.url.split('?')[0]) === renderer; }
  catch { return false; }
}
function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...args) => { if (!trusted(event)) throw new Error('Unexpected renderer'); return callback(...args); });
}
handle('terminal:boot', async () => {
  await ready;
  return { cwd: config.cwd, agents: config.agents, savedTheme, electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, platform: `${process.platform}/${process.arch}`, hostPid: host.pid };
});
handle('terminal:save-theme', theme => {
  if (!isTheme(theme)) throw new Error('未知主题');
  fs.writeFileSync(themeFile, JSON.stringify({ prototype: 'THROWAWAY, safe to delete', theme }, null, 2) + '\n');
  savedTheme = theme;
});
handle('terminal:start', options => request({ type: 'start', ...options }));
handle('terminal:stop', id => request({ type: 'stop', id }));
handle('terminal:copy', text => { if (typeof text === 'string') clipboard.writeText(text); });
for (const type of ['input', 'resize']) ipcMain.on(`terminal:${type}`, (event, payload) => {
  if (trusted(event) && !stopped) host.postMessage({ type, ...payload });
});
async function quit() {
  if (quitting) return;
  quitting = true;
  try { await request({ type: 'shutdown' }); } catch {}
  stopped = true;
  host?.kill();
  app.quit();
}
app.on('before-quit', event => { if (!stopped) { event.preventDefault(); void quit(); } });
app.on('window-all-closed', () => { void quit(); });
process.on('SIGTERM', () => { void quit(); });
app.whenReady().then(async () => {
  // Resolve once. System appearance changes must not recolor a running CLI.
  const startupTheme = startupPreference === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : startupPreference;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VibeBridge', submenu: [{ role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'togglefullscreen' }] },
  ]));
  host = utilityProcess.fork(path.join(__dirname, 'host.prototype.cjs'), [runtime, String(process.pid)], { serviceName: 'VibeBridge Prototype PTY Host', stdio: 'inherit' });
  host.on('message', message => {
    if (message.type === 'ready') { hostReady(); return; }
    if (message.requestId) {
      const waiter = pending.get(message.requestId);
      if (waiter) { clearTimeout(waiter.timer); pending.delete(message.requestId); message.error ? waiter.reject(new Error(message.error)) : waiter.resolve(message.result); }
      return;
    }
    if (window && !window.isDestroyed()) window.webContents.send('terminal:event', message);
  });
  host.on('exit', code => {
    stopped = true; hostReady();
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(new Error(`终端管理进程退出：${code}`)); }
    pending.clear();
    if (!quitting && window && !window.isDestroyed()) window.webContents.send('terminal:event', { type: 'error', id: '*', message: '终端管理进程退出，请关闭并重新启动原型' });
  });
  window = new BrowserWindow({
    width: 1360, height: 900, minWidth: 620, minHeight: 420,
    title: 'VibeBridge · 真实终端原型', backgroundColor: startupTheme === 'light' ? '#eeeff1' : '#14161a',
    webPreferences: { preload: path.join(__dirname, 'preload.prototype.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.on('render-process-gone', () => { void quit(); });
  window.on('close', event => { if (!stopped) { event.preventDefault(); void quit(); } });
  await window.loadFile(renderer, { query: { theme: startupTheme, preference: startupPreference } });
  window.show();
  app.focus({ steal: true });
  window.focus();
});
