const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let win;
const overlay = (dark) => ({ color: '#00000000', symbolColor: dark ? '#efe3c8' : '#1a1712', height: 46 });

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 980, minHeight: 640, title: 'Aster Ink',
    icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#0b0b0b',
    titleBarStyle: 'hidden', titleBarOverlay: overlay(true),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.setMenuBarVisibility(false);
  win.loadFile('index.html');
}

ipcMain.on('theme', (_e, t) => { if (win) win.setTitleBarOverlay(overlay(t === 'dark')); });
ipcMain.handle('file:save', async (_e, { name, bytes }) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('pictures'), name), filters: [{ name: 'PNG', extensions: ['png'] }] });
  if (r.canceled || !r.filePath) return { canceled: true };
  try { fs.writeFileSync(r.filePath, Buffer.from(bytes)); return { path: r.filePath }; } catch (e) { return { error: e.message }; }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
