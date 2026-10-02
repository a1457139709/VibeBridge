// Narrow, sandbox-compatible bridge. No arbitrary process/file access in the renderer.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('terminalPrototype', {
  boot: () => ipcRenderer.invoke('terminal:boot'),
  start: options => ipcRenderer.invoke('terminal:start', options),
  stop: id => ipcRenderer.invoke('terminal:stop', id),
  input: (id, data, binary = false) => ipcRenderer.send('terminal:input', { id, data, binary }),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', { id, cols, rows }),
  copy: text => ipcRenderer.invoke('terminal:copy', text),
  onEvent: callback => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  },
});
