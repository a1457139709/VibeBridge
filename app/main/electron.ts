import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell, type MessageBoxOptions } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Workbench, WorkbenchOpenError } from './workbench';
import type { Language } from '../shared/model';
import { localize } from '../shared/localization/localization';
import { message } from '../shared/messages';
import { readLoginEnvironment } from '../terminal/environment';
import { errorMessage } from '../shared/caught-error';
import { desktopChannels, workbenchEventChannel, type DesktopAPI, type DesktopRequest } from '../shared/api';
import { desktopRequestArguments } from './desktop-requests';
import type { z } from 'zod';

app.setName('VibeBridge');
if (process.env.VIBEBRIDGE_DATA_DIR) app.setPath('userData', process.env.VIBEBRIDGE_DATA_DIR);
let window: BrowserWindow | undefined;
let opening: Promise<Workbench>;
let exiting = false;
let confirming = false;
let language: Language = 'en';
const loginPathMerged = readLoginEnvironment()
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

const showMessageBox = (options: MessageBoxOptions) =>
  window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);

async function requestQuit() {
  if (exiting || confirming) return;
  confirming = true;
  const { t, text } = localize(language);
  const answer = await showMessageBox({
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
    await showMessageBox({
      type: 'error',
      message: t('quitError'),
      detail: text(errorMessage(error)),
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
  const mainWindow = new BrowserWindow({
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
  window = mainWindow;
  mainWindow.on('close', event => {
    if (!exiting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:\/\/|mailto:)/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  updateNativeLanguage(language);
  opening = Workbench.open(app.getPath('userData'), nativeTheme.shouldUseDarkColors);
  void opening.then(
    workbench => {
      updateNativeLanguage(workbench.snapshot().settings.language);
      workbench.subscribe(event => {
        if (event.kind === 'snapshot' && event.snapshot.settings.language !== language)
          updateNativeLanguage(event.snapshot.settings.language);
      });
      nativeTheme.themeSource = workbench.snapshot().resolvedTheme;
      mainWindow.setBackgroundColor(workbench.snapshot().resolvedTheme === 'dark' ? '#141414' : '#f5f5f5');
    },
    error => {
      if (error instanceof WorkbenchOpenError) updateNativeLanguage(error.language);
      return dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: localize(language).t('workbenchReadFailed'),
        detail: localize(language).text(errorMessage(error)),
      });
    },
  );
  const fromPage = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.sender === mainWindow.webContents && event.senderFrame?.url === page;
  const readArguments = <R extends DesktopRequest>(request: R, args: unknown[]): Parameters<DesktopAPI[R]> => {
    const schema: z.ZodType<Parameters<DesktopAPI[R]>> = desktopRequestArguments[request];
    const parsed = schema.safeParse(args);
    if (!parsed.success) throw new Error(message('requestInvalid'));
    return parsed.data;
  };
  const handle = <R extends DesktopRequest>(
    request: R,
    action: (
      workbench: Workbench,
      ...args: Parameters<DesktopAPI[R]>
    ) => ReturnType<DesktopAPI[R]> | Awaited<ReturnType<DesktopAPI[R]>>,
  ) => {
    ipcMain.handle(desktopChannels[request], async (event, ...args: unknown[]) => {
      if (!fromPage(event)) throw new Error(message('requestInvalid'));
      const parsed = readArguments(request, args);
      try {
        return await action(await opening, ...parsed);
      } catch (error) {
        if (error instanceof WorkbenchOpenError) throw new Error(localize(error.language).text(error.message));
        throw error;
      }
    });
  };
  handle('fetchSnapshot', workbench => workbench.snapshot());
  handle('createProject', (workbench, draft) => workbench.createProject(draft));
  handle('editProject', async (workbench, id, edit, restart) => {
    await loginPathMerged;
    return workbench.editProject(id, edit, restart);
  });
  handle('deleteProject', (workbench, id) => workbench.deleteProject(id));
  handle('inspectDirectory', (workbench, directory) => workbench.inspectDirectory(directory));
  handle('fetchRepositoryChoices', async (workbench, id, directory) => {
    await loginPathMerged;
    return workbench.fetchRepositoryChoices(id, directory);
  });
  handle('bindRepository', async (workbench, id, repository) => {
    await loginPathMerged;
    return workbench.bindRepository(id, repository);
  });
  handle('unbindRepository', (workbench, id) => workbench.unbindRepository(id));
  handle('showForgeList', async (workbench, id, view) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showList(id, view);
  });
  handle('reportForgeSidebarPresence', async (workbench, presence) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reportPresence(presence);
  });
  handle('loadMoreForgeList', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.loadMore(id);
  });
  handle('showForgeRows', (workbench, id, numbers) => workbench.forgeSidebar.showRows(id, numbers));
  handle('refreshForgeList', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.refresh(id);
  });
  handle('showRepositoryChoices', async (workbench, id) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showRepositoryChoices(id);
  });
  handle('showForgeDetail', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.showDetail(id, item);
  });
  handle('reportForgeRowResting', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reportRestingOn(id, item);
  });
  handle('reportForgeItemChanged', async (workbench, id, item) => {
    await loginPathMerged;
    return workbench.forgeSidebar.reloadChanged(id, item);
  });
  handle('dispatch', (workbench, id, request) => workbench.dispatch(id, request));
  handle('performDirectAction', async (workbench, id, action) => {
    await loginPathMerged;
    return workbench.performDirectAction(id, action);
  });
  handle('activateProject', (workbench, id) => workbench.activateProject(id));
  handle('addPanel', (workbench, project, agent) => workbench.addPanel(project, agent));
  handle('closePanel', (workbench, project, panel) => workbench.closePanel(project, panel));
  handle('placeInLayout', (workbench, project, panel, layout) => workbench.placeInLayout(project, panel, layout));
  handle('moveToTray', (workbench, project, panel) => workbench.moveToTray(project, panel));
  handle('saveLayout', (workbench, project, layout) => workbench.saveLayout(project, layout));
  handle('saveSidebar', (workbench, sidebar, preferences) => workbench.saveSidebar(sidebar, preferences));
  handle('saveSettings', (workbench, settings) => workbench.saveSettings(settings));
  handle('checkCommand', (workbench, command) => workbench.runs.checkCommand(command));
  handle('sendInput', (workbench, run, data) => workbench.runs.input(run, data));
  handle('resizeRun', (workbench, run, cols, rows) => workbench.runs.resize(run, cols, rows));
  ipcMain.on(desktopChannels.acknowledgeOutput, (event, ...args: unknown[]) => {
    if (!fromPage(event)) return;
    const acknowledged = desktopRequestArguments.acknowledgeOutput.safeParse(args);
    if (!acknowledged.success) return;
    const [run, characters] = acknowledged.data;
    void opening.then(workbench => workbench.runs.acknowledgeOutput(run, characters));
  });
  handle('chooseDirectory', async () => {
    const { t } = localize(language);
    const choice = await dialog.showOpenDialog(mainWindow, {
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
  handle('reportRendererReady', async workbench => {
    if (ready) return;
    ready = true;
    workbench.subscribe(event => {
      if (!mainWindow.isDestroyed()) mainWindow.webContents.send(workbenchEventChannel, event);
    });
    const active = workbench.snapshot().activeProjectId;
    if (active) await workbench.activateProject(active);
  });
  await mainWindow.loadURL(page);
});
