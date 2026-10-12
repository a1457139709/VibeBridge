import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workbench } from './workbench';

app.setName('VibeBridge');
// Also permits isolated local acceptance runs without touching the user's projects.
if (process.env.VIBEBRIDGE_DATA_DIR) app.setPath('userData', process.env.VIBEBRIDGE_DATA_DIR);
let window: BrowserWindow | undefined;
let workbench: Promise<Workbench>;
let exiting = false;
let confirming = false;

async function requestQuit() {
  if (exiting || confirming) return;
  confirming = true;
  const answer = await dialog.showMessageBox(window!, { type: 'question', message: '退出 VibeBridge？',
    detail: '将保存项目和布局，并结束所有项目中正在运行的 Agent。', buttons: ['取消', '退出'], defaultId: 0, cancelId: 0 });
  if (answer.response === 0) { confirming = false; return; }
  try { await (await workbench).quit(); }
  catch (error) { await dialog.showMessageBox(window!, { type: 'error', message: '退出时发生错误', detail: (error as Error).message }); }
  exiting = true;
  app.quit();
}

app.on('before-quit', event => { if (!exiting) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => { if (exiting) app.quit(); });

void app.whenReady().then(async () => {
  const page = pathToFileURL(join(__dirname, 'renderer/index.html')).href;
  window = new BrowserWindow({ width: 1280, height: 860, title: 'VibeBridge', titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#202322' : '#f3f4f0',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.on('close', event => { if (!exiting) { event.preventDefault(); void requestQuit(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VibeBridge', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
  ]));
  workbench = Workbench.open(app.getPath('userData'), nativeTheme.shouldUseDarkColors);
  void workbench.then(service => {
    nativeTheme.themeSource = service.snapshot().resolvedTheme;
    window?.setBackgroundColor(service.snapshot().resolvedTheme === 'dark' ? '#202322' : '#f3f4f0');
  }).catch(() => {});
  void workbench.catch(error => dialog.showMessageBox(window!, { type: 'error', message: '工作台读取失败', detail: error.message }));
  // Install handlers before showing the page, while disk work completes asynchronously.
  const handle = (name: string, action: (service: Workbench, ...args: any[]) => unknown) => {
    ipcMain.handle(`workbench:${name}`, async (event, ...args) => {
      if (event.sender !== window!.webContents || event.senderFrame?.url !== page) throw new Error('无效工作台请求');
      return action(await workbench, ...args);
    });
  };
  handle('snapshot', service => service.snapshot());
  handle('create', (service, draft) => service.createProject(draft));
  handle('edit-project', (service, id, edit, restart) => service.editProject(id, edit, restart));
  handle('delete-project', (service, id) => service.deleteProject(id));
  handle('directory', (service, directory) => service.inspectDirectory(directory));
  handle('activate', (service, id) => service.activateProject(id));
  handle('add', (service, project, agent) => service.addPanel(project, agent));
  handle('close', (service, project, panel) => service.closePanel(project, panel));
  handle('layout', (service, project, layout) => service.saveLayout(project, layout));
  handle('navigation', (service, preferences) => service.saveNavigation(preferences));
  handle('settings', (service, settings) => service.saveSettings(settings));
  handle('check-command', (service, command) => service.checkCommand(command));
  handle('input', (service, run, data) => service.sendInput(run, data));
  handle('resize', (service, run, cols, rows) => service.resizeRun(run, cols, rows));
  ipcMain.on('workbench:output-consumed', (event, run, characters) => {
    if (event.sender === window!.webContents && event.senderFrame?.url === page) {
      void workbench.then(service => service.acknowledgeOutput(run, characters));
    }
  });
  handle('choose-directory', async () => {
    const choice = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    return choice.canceled ? null : choice.filePaths[0];
  });
  let ready = false;
  handle('ready', async service => {
    if (ready) return;
    ready = true;
    service.subscribe(event => { if (window && !window.isDestroyed()) window.webContents.send('workbench:event', event); });
    const active = service.snapshot().activeProjectId;
    if (active) await service.activateProject(active);
  });
  await window.loadURL(page);
});
