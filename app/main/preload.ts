import { message } from '../shared/messages';
import { contextBridge, ipcRenderer } from 'electron';
import { desktopChannels, workbenchEventChannel, type DesktopAPI, type DesktopRequest } from '../shared/api';

const invoke = <R extends DesktopRequest>(request: R, ...args: Parameters<DesktopAPI[R]>) =>
  ipcRenderer.invoke(desktopChannels[request], ...args);

const api: DesktopAPI = {
  fetchSnapshot: () => invoke('fetchSnapshot'),
  createProject: draft => invoke('createProject', draft),
  editProject: (id, edit, restart) => invoke('editProject', id, edit, restart),
  deleteProject: id => invoke('deleteProject', id),
  inspectDirectory: directory => invoke('inspectDirectory', directory),
  fetchRepositoryChoices: (id, directory) => invoke('fetchRepositoryChoices', id, directory),
  bindRepository: (id, repository) => invoke('bindRepository', id, repository),
  unbindRepository: id => invoke('unbindRepository', id),
  showForgeList: (id, view) => invoke('showForgeList', id, view),
  reportForgeSidebarPresence: presence => invoke('reportForgeSidebarPresence', presence),
  loadMoreForgeList: id => invoke('loadMoreForgeList', id),
  showForgeRows: (id, numbers) => invoke('showForgeRows', id, numbers),
  refreshForgeList: id => invoke('refreshForgeList', id),
  showRepositoryChoices: id => invoke('showRepositoryChoices', id),
  showForgeDetail: (id, item) => invoke('showForgeDetail', id, item),
  reportForgeRowResting: (id, item) => invoke('reportForgeRowResting', id, item),
  reportForgeItemChanged: (id, item) => invoke('reportForgeItemChanged', id, item),
  performDirectAction: (id, action) => invoke('performDirectAction', id, action),
  dispatch: (id, request) => invoke('dispatch', id, request),
  chooseDirectory: () => invoke('chooseDirectory'),
  activateProject: id => invoke('activateProject', id),
  addPanel: (project, agent) => invoke('addPanel', project, agent),
  closePanel: (project, panel) => invoke('closePanel', project, panel),
  placeInLayout: (project, panel, layout) => invoke('placeInLayout', project, panel, layout),
  moveToTray: (project, panel) => invoke('moveToTray', project, panel),
  saveLayout: (project, layout) => invoke('saveLayout', project, layout),
  saveSidebar: (sidebar, preferences) => invoke('saveSidebar', sidebar, preferences),
  saveSettings: settings =>
    invoke('saveSettings', settings).catch(() => ({
      ok: false,
      kind: 'unavailable',
      message: message('settingsUnavailable'),
    })),
  checkCommand: command => invoke('checkCommand', command),
  sendInput: (run, data) => invoke('sendInput', run, data),
  resizeRun: (run, cols, rows) => invoke('resizeRun', run, cols, rows),
  acknowledgeOutput: (run, characters) => ipcRenderer.send(desktopChannels.acknowledgeOutput, run, characters),
  reportRendererReady: () => invoke('reportRendererReady'),
  quit: () => invoke('quit'),
  subscribe: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on(workbenchEventChannel, receive);
    return () => {
      ipcRenderer.removeListener(workbenchEventChannel, receive);
    };
  },
};
contextBridge.exposeInMainWorld('workbench', api);
