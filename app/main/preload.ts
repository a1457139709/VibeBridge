import { message } from '../shared/messages';
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/api';

const api: DesktopAPI = {
  fetchSnapshot: () => ipcRenderer.invoke('workbench:fetch-snapshot'),
  createProject: draft => ipcRenderer.invoke('workbench:create-project', draft),
  editProject: (id, edit, restart) => ipcRenderer.invoke('workbench:edit-project', id, edit, restart),
  deleteProject: id => ipcRenderer.invoke('workbench:delete-project', id),
  inspectDirectory: directory => ipcRenderer.invoke('workbench:inspect-directory', directory),
  fetchRepositoryChoices: (id, directory) => ipcRenderer.invoke('workbench:fetch-repository-choices', id, directory),
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
  performDirectAction: (id, action) => ipcRenderer.invoke('workbench:perform-direct-action', id, action),
  dispatch: (id, request) => ipcRenderer.invoke('workbench:dispatch', id, request),
  chooseDirectory: () => ipcRenderer.invoke('workbench:choose-directory'),
  activateProject: id => ipcRenderer.invoke('workbench:activate-project', id),
  addPanel: (project, agent) => ipcRenderer.invoke('workbench:add-panel', project, agent),
  closePanel: (project, panel) => ipcRenderer.invoke('workbench:close-panel', project, panel),
  placeInLayout: (project, panel, layout) => ipcRenderer.invoke('workbench:place-in-layout', project, panel, layout),
  moveToTray: (project, panel) => ipcRenderer.invoke('workbench:move-to-tray', project, panel),
  saveLayout: (project, layout) => ipcRenderer.invoke('workbench:save-layout', project, layout),
  saveSidebar: (sidebar, preferences) => ipcRenderer.invoke('workbench:save-sidebar', sidebar, preferences),
  saveSettings: settings =>
    ipcRenderer
      .invoke('workbench:save-settings', settings)
      .catch(() => ({ ok: false, kind: 'unavailable', message: message('settingsUnavailable') })),
  checkCommand: command => ipcRenderer.invoke('workbench:check-command', command),
  sendInput: (run, data) => ipcRenderer.invoke('workbench:send-input', run, data),
  resizeRun: (run, cols, rows) => ipcRenderer.invoke('workbench:resize-run', run, cols, rows),
  acknowledgeOutput: (run, characters) => ipcRenderer.send('workbench:acknowledge-output', run, characters),
  reportRendererReady: () => ipcRenderer.invoke('workbench:renderer-ready'),
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
