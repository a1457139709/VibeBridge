import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workbench, WorkbenchOpenError } from './workbench';
import type { Language } from '../shared/model';
import { localize } from '../shared/localization';
import { message } from '../shared/messages';

app.setName('VibeBridge');
// Also permits isolated local acceptance runs without touching the user's projects.
if (process.env.VIBEBRIDGE_DATA_DIR) app.setPath('userData', process.env.VIBEBRIDGE_DATA_DIR);
let window: BrowserWindow | undefined;
let workbench: Promise<Workbench>;
let exiting = false;
let confirming = false;
let language: Language = 'en';

function updateNativeLanguage(next: Language) {
  language = next;
  const { t } = localize(language);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'VibeBridge', submenu: [{ role: 'about', label: t('about') }, { type: 'separator' },
      { role: 'hide', label: t('hideWorkbench') }, { role: 'hideOthers', label: t('hideOthers') }, { role: 'unhide', label: t('showAll') },
      { type: 'separator' }, { role: 'quit', label: t('quitWorkbench') }] },
    { label: t('editMenu'), submenu: [{ role: 'undo', label: t('undo') }, { role: 'redo', label: t('redo') }, { type: 'separator' },
      { role: 'cut', label: t('cut') }, { role: 'copy', label: t('copy') }, { role: 'paste', label: t('paste') }, { role: 'selectAll', label: t('selectAll') }] },
    { label: t('windowMenu'), submenu: [{ role: 'minimize', label: t('minimize') }, { role: 'zoom', label: t('zoom') }] },
  ]));
}

async function requestQuit() {
  if (exiting || confirming) return;
  confirming = true;
  const { t, text } = localize(language);
  const answer = await dialog.showMessageBox(window!, { type: 'question', message: t('quitQuestion'),
    detail: t('quitDetail'), buttons: [t('cancel'), t('quit')], defaultId: 0, cancelId: 0 });
  if (answer.response === 0) { confirming = false; return; }
  try { await (await workbench).quit(); }
  catch (error) { await dialog.showMessageBox(window!, { type: 'error', message: t('quitError'), detail: text((error as Error).message) }); }
  exiting = true;
  app.quit();
}

app.on('before-quit', event => { if (!exiting) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => { if (exiting) app.quit(); });

void app.whenReady().then(async () => {
  const page = pathToFileURL(join(__dirname, 'renderer/index.html')).href;
  window = new BrowserWindow({ width: 1280, height: 860, title: 'VibeBridge', titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#f5f5f5',
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.on('close', event => { if (!exiting) { event.preventDefault(); void requestQuit(); } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  updateNativeLanguage(language);
  workbench = Workbench.open(app.getPath('userData'), nativeTheme.shouldUseDarkColors);
  void workbench.then(service => {
    updateNativeLanguage(service.snapshot().settings.language);
    service.subscribe(event => {
      if (event.kind === 'snapshot' && event.snapshot.settings.language !== language) updateNativeLanguage(event.snapshot.settings.language);
    });
    nativeTheme.themeSource = service.snapshot().resolvedTheme;
    window?.setBackgroundColor(service.snapshot().resolvedTheme === 'dark' ? '#141414' : '#f5f5f5');
  }).catch(() => {});
  void workbench.catch(error => {
    if (error instanceof WorkbenchOpenError) updateNativeLanguage(error.language);
    return dialog.showMessageBox(window!, { type: 'error', message: localize(language).t('workbenchReadFailed'), detail: localize(language).text(error.message) });
  });
  // Install handlers before showing the page, while disk work completes asynchronously.
  const handle = (name: string, action: (service: Workbench, ...args: any[]) => unknown) => {
    ipcMain.handle(`workbench:${name}`, async (event, ...args) => {
      if (event.sender !== window!.webContents || event.senderFrame?.url !== page) throw new Error(message('requestInvalid'));
      try { return await action(await workbench, ...args); }
      catch (error) {
        if (error instanceof WorkbenchOpenError) throw new Error(localize(error.language).text(error.message));
        throw error;
      }
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
    const { t } = localize(language);
    const choice = await dialog.showOpenDialog(window!, { title: t('chooseDirectory'), buttonLabel: t('selectDirectory'), properties: ['openDirectory'] });
    return choice.canceled ? null : choice.filePaths[0];
  });
  handle('quit', () => { void requestQuit(); });
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
