import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workbench, WorkbenchOpenError } from './workbench';
import type { Language } from '../shared/model';
import { localize } from '../shared/localization/localization';
import { message } from '../shared/messages';
import { commandEnvironment } from '../terminal/environment';

app.setName('VibeBridge');
// Also permits isolated local acceptance runs without touching the user's projects.
if (process.env.VIBEBRIDGE_DATA_DIR) app.setPath('userData', process.env.VIBEBRIDGE_DATA_DIR);
let window: BrowserWindow | undefined;
let opening: Promise<Workbench>;
let exiting = false;
let confirming = false;
let language: Language = 'en';
// An app opened from the Finder inherits a minimal PATH. Forge CLIs such as gh are looked up on the
// inherited PATH first, then on the login shell's, where the Agents find them too.
const loginPathMerged = commandEnvironment()
  .then(environment => {
    const entries = [...(process.env.PATH ?? '').split(':'), ...(environment.PATH ?? '').split(':')].filter(Boolean);
    process.env.PATH = [...new Set(entries)].join(':');
  })
  .catch(() => {});

function updateNativeLanguage(next: Language) {
  language = next;
  const { t } = localize(language);
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'VibeBridge',
        submenu: [
          { role: 'about', label: t('about') },
          { type: 'separator' },
          { role: 'hide', label: t('hideWorkbench') },
          { role: 'hideOthers', label: t('hideOthers') },
          { role: 'unhide', label: t('showAll') },
          { type: 'separator' },
          { role: 'quit', label: t('quitWorkbench') },
        ],
      },
      {
        label: t('editMenu'),
        submenu: [
          { role: 'undo', label: t('undo') },
          { role: 'redo', label: t('redo') },
          { type: 'separator' },
          { role: 'cut', label: t('cut') },
          { role: 'copy', label: t('copy') },
          { role: 'paste', label: t('paste') },
          { role: 'selectAll', label: t('selectAll') },
        ],
      },
      {
        label: t('windowMenu'),
        submenu: [
          { role: 'minimize', label: t('minimize') },
          { role: 'zoom', label: t('zoom') },
        ],
      },
    ]),
  );
}

async function requestQuit() {
  if (exiting || confirming) return;
  confirming = true;
  const { t, text } = localize(language);
  const answer = await dialog.showMessageBox(window!, {
    type: 'question',
    message: t('quitQuestion'),
    detail: t('quitDetail'),
    buttons: [t('cancel'), t('quit')],
    defaultId: 0,
    cancelId: 0,
  });
  if (answer.response === 0) {
    confirming = false;
    return;
  }
  try {
    await (await opening).quit();
  } catch (error) {
    await dialog.showMessageBox(window!, {
      type: 'error',
      message: t('quitError'),
      detail: text((error as Error).message),
    });
  }
  exiting = true;
  app.quit();
}

app.on('before-quit', event => {
  if (!exiting) {
    event.preventDefault();
    void requestQuit();
  }
});
app.on('window-all-closed', () => {
  if (exiting) app.quit();
});

void app.whenReady().then(async () => {
  const page = pathToFileURL(join(__dirname, 'renderer/index.html')).href;
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'VibeBridge',
    titleBarStyle: 'hiddenInset',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141414' : '#f5f5f5',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('close', event => {
    if (!exiting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // The links forge HTML keeps (http, https and mailto) open in the system's own apps.
    if (/^(https?:\/\/|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', event => event.preventDefault());
  updateNativeLanguage(language);
  opening = Workbench.open(app.getPath('userData'), nativeTheme.shouldUseDarkColors);
  void opening
    .then(workbench => {
      updateNativeLanguage(workbench.snapshot().settings.language);
      workbench.subscribe(event => {
        if (event.kind === 'snapshot' && event.snapshot.settings.language !== language)
          updateNativeLanguage(event.snapshot.settings.language);
      });
      nativeTheme.themeSource = workbench.snapshot().resolvedTheme;
      window?.setBackgroundColor(workbench.snapshot().resolvedTheme === 'dark' ? '#141414' : '#f5f5f5');
    })
    .catch(() => {});
  void opening.catch(error => {
    if (error instanceof WorkbenchOpenError) updateNativeLanguage(error.language);
    return dialog.showMessageBox(window!, {
      type: 'error',
      message: localize(language).t('workbenchReadFailed'),
      detail: localize(language).text(error.message),
    });
  });
  // Install handlers before showing the page, while disk work completes asynchronously.
  const handle = (name: string, action: (workbench: Workbench, ...args: any[]) => unknown) => {
    ipcMain.handle(`workbench:${name}`, async (event, ...args) => {
      if (event.sender !== window!.webContents || event.senderFrame?.url !== page)
        throw new Error(message('requestInvalid'));
      try {
        return await action(await opening, ...args);
      } catch (error) {
        if (error instanceof WorkbenchOpenError) throw new Error(localize(error.language).text(error.message));
        throw error;
      }
    });
  };
  handle('snapshot', workbench => workbench.snapshot());
  handle('create', (workbench, draft) => workbench.createProject(draft));
  handle('edit-project', async (workbench, id, edit, restart) => {
    await loginPathMerged;
    return workbench.editProject(id, edit, restart);
  });
  handle('delete-project', (workbench, id) => workbench.deleteProject(id));
  handle('directory', (workbench, directory) => workbench.inspectDirectory(directory));
  handle('repository-choices', async (workbench, id, directory) => {
    await loginPathMerged;
    return workbench.repositoryChoices(id, directory);
  });
  handle('bind-repository', async (workbench, id, repository) => {
    await loginPathMerged;
    return workbench.bindRepository(id, repository);
  });
  handle('unbind-repository', (workbench, id) => workbench.unbindRepository(id));
  handle('show-forge-list', async (workbench, id, view) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showList(id, view);
  });
  handle('report-forge-sidebar-presence', async (workbench, presence) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reportPresence(presence);
  });
  handle('load-more-forge-list', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.loadMore(id);
  });
  handle('show-forge-rows', (workbench, id, numbers) => workbench.forgeSidebar.showRows(id, numbers));
  handle('refresh-forge-list', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.refresh(id);
  });
  handle('show-repository-choices', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showRepositoryChoices(id);
  });
  handle('show-forge-detail', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showDetail(id, item);
  });
  handle('report-forge-row-resting', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reportRestingOn(id, item);
  });
  handle('report-forge-item-changed', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reloadChanged(id, item);
  });
  handle('dispatch', (workbench, id, request) => workbench.dispatch(id, request));
  handle('direct-action', async (workbench, id, action) => {
    await loginPathMerged;
    return workbench.directAction(id, action);
  });
  handle('activate', (workbench, id) => workbench.activateProject(id));
  handle('add', (workbench, project, agent) => workbench.addPanel(project, agent));
  handle('close', (workbench, project, panel) => workbench.closePanel(project, panel));
  handle('place', (workbench, project, panel, layout) => workbench.placeInLayout(project, panel, layout));
  handle('tray', (workbench, project, panel) => workbench.moveToTray(project, panel));
  handle('layout', (workbench, project, layout) => workbench.saveLayout(project, layout));
  handle('sidebar', (workbench, sidebar, preferences) => workbench.saveSidebar(sidebar, preferences));
  handle('settings', (workbench, settings) => workbench.saveSettings(settings));
  handle('check-command', (workbench, command) => workbench.runs.checkCommand(command));
  handle('input', (workbench, run, data) => workbench.runs.input(run, data));
  handle('resize', (workbench, run, cols, rows) => workbench.runs.resize(run, cols, rows));
  ipcMain.on('workbench:output-consumed', (event, run, characters) => {
    if (event.sender === window!.webContents && event.senderFrame?.url === page) {
      void opening.then(workbench => workbench.runs.acknowledgeOutput(run, characters));
    }
  });
  handle('choose-directory', async () => {
    const { t } = localize(language);
    const choice = await dialog.showOpenDialog(window!, {
      title: t('chooseDirectory'),
      buttonLabel: t('selectDirectory'),
      properties: ['openDirectory'],
    });
    return choice.canceled ? null : choice.filePaths[0];
  });
  handle('quit', () => {
    void requestQuit();
  });
  let ready = false;
  handle('ready', async workbench => {
    if (ready) return;
    ready = true;
    workbench.subscribe(event => {
      if (window && !window.isDestroyed()) window.webContents.send('workbench:event', event);
    });
    const active = workbench.snapshot().activeProjectId;
    if (active) await workbench.activateProject(active);
  });
  await window.loadURL(page);
});
