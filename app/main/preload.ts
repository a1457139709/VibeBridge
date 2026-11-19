import { message } from '../shared/messages';
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/api';

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('workbench:snapshot'),
  createProject: draft => ipcRenderer.invoke('workbench:create', draft),
  editProject: (id, edit, restart) => ipcRenderer.invoke('workbench:edit-project', id, edit, restart),
  deleteProject: id => ipcRenderer.invoke('workbench:delete-project', id),
  inspectDirectory: directory => ipcRenderer.invoke('workbench:directory', directory),
  repositoryChoices: (id, directory) => ipcRenderer.invoke('workbench:repository-choices', id, directory),
  bindRepository: (id, repository) => ipcRenderer.invoke('workbench:bind-repository', id, repository),
  unbindRepository: id => ipcRenderer.invoke('workbench:unbind-repository', id),
  showForgeList: (id, view) => ipcRenderer.invoke('workbench:show-forge-list', id, view),
  reportForgeSidebarPresence: presence => ipcRenderer.invoke('workbench:report-forge-sidebar-presence', presence),
  loadMoreForgeList: id => ipcRenderer.invoke('workbench:load-more-forge-list', id),
  showForgeRows: (id, numbers) => ipcRenderer.invoke('workbench:show-forge-rows', id, numbers),
  refreshForgeList: id => ipcRenderer.invoke('workbench:refresh-forge-list', id),
  showRepositoryChoices: id => ipcRenderer.invoke('workbench:show-repository-choices', id),
  showForgeDetail: (id, item) => ipcRenderer.invoke('workbench:show-forge-detail', id, item),
  reportForgeRowResting: (id, item) => ipcRenderer.invoke('workbench:report-forge-row-resting', id, item),
  reportForgeItemChanged: (id, item) => ipcRenderer.invoke('workbench:report-forge-item-changed', id, item),
  directAction: (id, action) => ipcRenderer.invoke('workbench:direct-action', id, action),
  dispatch: (id, request) => ipcRenderer.invoke('workbench:dispatch', id, request),
  chooseDirectory: () => ipcRenderer.invoke('workbench:choose-directory'),
  activateProject: id => ipcRenderer.invoke('workbench:activate', id),
  addPanel: (project, agent) => ipcRenderer.invoke('workbench:add', project, agent),
  closePanel: (project, panel) => ipcRenderer.invoke('workbench:close', project, panel),
  placeInLayout: (project, panel, layout) => ipcRenderer.invoke('workbench:place', project, panel, layout),
  moveToTray: (project, panel) => ipcRenderer.invoke('workbench:tray', project, panel),
  saveLayout: (project, layout) => ipcRenderer.invoke('workbench:layout', project, layout),
  saveSidebar: (sidebar, preferences) => ipcRenderer.invoke('workbench:sidebar', sidebar, preferences),
  saveSettings: settings =>
    ipcRenderer
      .invoke('workbench:settings', settings)
      .catch(() => ({ ok: false, kind: 'unavailable', message: message('settingsUnavailable') })),
  checkCommand: command => ipcRenderer.invoke('workbench:check-command', command),
  sendInput: (run, data) => ipcRenderer.invoke('workbench:input', run, data),
  resizeRun: (run, cols, rows) => ipcRenderer.invoke('workbench:resize', run, cols, rows),
  acknowledgeOutput: (run, characters) => ipcRenderer.send('workbench:output-consumed', run, characters),
  ready: () => ipcRenderer.invoke('workbench:ready'),
  quit: () => ipcRenderer.invoke('workbench:quit'),
  subscribe: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('workbench:event', receive);
    return () => {
      ipcRenderer.removeListener('workbench:event', receive);
    };
  },
};
contextBridge.exposeInMainWorld('workbench', api);
