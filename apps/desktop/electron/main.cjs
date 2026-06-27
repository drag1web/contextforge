const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1100,
    minHeight: 720,
    title: "ContextForge",
    backgroundColor: "#050505",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, "../renderer/dist/index.html"));
  }
}

function getWindowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

ipcMain.handle("dialog:select-project-folder", async () => {
  const result = await dialog.showOpenDialog({
    title: "Select project folder",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.on("window:minimize", (event) => {
  const win = getWindowFromEvent(event);
  win?.minimize();
});

ipcMain.on("window:toggle-maximize", (event) => {
  const win = getWindowFromEvent(event);

  if (!win) {
    return;
  }

  if (win.isMaximized()) {
    win.unmaximize();
    return;
  }

  win.maximize();
});

ipcMain.on("window:close", (event) => {
  const win = getWindowFromEvent(event);
  win?.close();
});

ipcMain.handle("window:is-maximized", (event) => {
  const win = getWindowFromEvent(event);
  return Boolean(win?.isMaximized());
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});