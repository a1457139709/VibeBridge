import { message } from '../shared/messages';
import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/api';

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('workbench:snapshot'),
  createProject: draft => ipcRenderer.invoke('workbench:create', draft),
  editProject: (id, edit, restart) => ipcRenderer.invoke('workbench:edit-project', id, edit, restart),
  deleteProject: id => ipcRenderer.invoke('workbench:delete-project', id),
  repositoryChoices: id => ipcRenderer.invoke('workbench:repository-choices', id),
  bindRepository: (id, repository) => ipcRenderer.invoke('workbench:bind-repository', id, repository),
  issuePage: (id, filter, cursor) => ipcRenderer.invoke('workbench:issue-page', id, filter, cursor),
  dispatch: (id, request) => ipcRenderer.invoke('workbench:dispatch', id, request),
  mergeRequestPage: (id, filter, cursor) => ipcRenderer.invoke('workbench:merge-request-page', id, filter, cursor),
  inspectDirectory: directory => ipcRenderer.invoke('workbench:directory', directory),
  chooseDirectory: () => ipcRenderer.invoke('workbench:choose-directory'),
  activateProject: id => ipcRenderer.invoke('workbench:activate', id),
  addPanel: (project, agent) => ipcRenderer.invoke('workbench:add', project, agent),
  closePanel: (project, panel) => ipcRenderer.invoke('workbench:close', project, panel),
  placeInLayout: (project, panel, layout) => ipcRenderer.invoke('workbench:place', project, panel, layout),
  moveToTray: (project, panel) => ipcRenderer.invoke('workbench:tray', project, panel),
  saveLayout: (project, layout) => ipcRenderer.invoke('workbench:layout', project, layout),
  saveNavigation: preferences => ipcRenderer.invoke('workbench:navigation', preferences),
  saveIssueSidebar: preferences => ipcRenderer.invoke('workbench:issue-sidebar', preferences),
  saveSettings: settings => ipcRenderer.invoke('workbench:settings', settings).catch(() => ({ ok: false, kind: 'unavailable', message: message('settingsUnavailable') })),
  checkCommand: command => ipcRenderer.invoke('workbench:check-command', command),
  sendInput: (run, data) => ipcRenderer.invoke('workbench:input', run, data),
  resizeRun: (run, cols, rows) => ipcRenderer.invoke('workbench:resize', run, cols, rows),
  acknowledgeOutput: (run, characters) => ipcRenderer.send('workbench:output-consumed', run, characters),
  ready: () => ipcRenderer.invoke('workbench:ready'),
  quit: () => ipcRenderer.invoke('workbench:quit'),
  subscribe: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('workbench:event', receive);
    return () => { ipcRenderer.removeListener('workbench:event', receive); };
  },
};
contextBridge.exposeInMainWorld('workbench', api);
