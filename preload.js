const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('aster', {
  setTheme: (t) => ipcRenderer.send('theme', t),
  saveFile: (o) => ipcRenderer.invoke('file:save', o)
});
