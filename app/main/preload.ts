import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopAPI } from '../shared/api';

const api: DesktopAPI = {
  snapshot: () => ipcRenderer.invoke('workbench:snapshot'),
  createProject: draft => ipcRenderer.invoke('workbench:create', draft),
  inspectDirectory: directory => ipcRenderer.invoke('workbench:directory', directory),
  chooseDirectory: () => ipcRenderer.invoke('workbench:choose-directory'),
  activateProject: id => ipcRenderer.invoke('workbench:activate', id),
  addPanel: (project, agent) => ipcRenderer.invoke('workbench:add', project, agent),
  closePanel: (project, panel) => ipcRenderer.invoke('workbench:close', project, panel),
  saveLayout: (project, layout) => ipcRenderer.invoke('workbench:layout', project, layout),
  saveSettings: settings => ipcRenderer.invoke('workbench:settings', settings),
  checkCommand: command => ipcRenderer.invoke('workbench:check-command', command),
  sendInput: (run, data) => ipcRenderer.invoke('workbench:input', run, data),
  resizeRun: (run, cols, rows) => ipcRenderer.invoke('workbench:resize', run, cols, rows),
  acknowledgeOutput: (run, characters) => ipcRenderer.send('workbench:output-consumed', run, characters),
  ready: () => ipcRenderer.invoke('workbench:ready'),
  subscribe: listener => {
    const receive = (_event: Electron.IpcRendererEvent, value: Parameters<typeof listener>[0]) => listener(value);
    ipcRenderer.on('workbench:event', receive);
    return () => { ipcRenderer.removeListener('workbench:event', receive); };
  },
};
contextBridge.exposeInMainWorld('workbench', api);
