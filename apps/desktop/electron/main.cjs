const { app, BrowserWindow, ipcMain, dialog, Menu, screen } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);

const appIconPath = path.join(
  __dirname,
  "assets",
  process.platform === "win32" ? "icon.ico" : "icon.png"
);

function getWindowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    const raw = fs.readFileSync(getWindowStatePath(), "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  if (!win || win.isDestroyed() || win.isMinimized()) {
    return;
  }

  const state = {
    bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds(),
    isMaximized: win.isMaximized()
  };

  try {
    fs.writeFileSync(getWindowStatePath(), JSON.stringify(state, null, 2));
  } catch {
    // Ignore window state write errors.
  }
}

function getDefaultWindowBounds() {
  const { workArea } = screen.getPrimaryDisplay();

  const width = Math.min(1280, workArea.width);
  const height = Math.min(820, workArea.height);

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  };
}

function isValidBounds(bounds) {
  return (
    bounds &&
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width >= 900 &&
    bounds.height >= 600
  );
}

function isBoundsVisible(bounds) {
  if (!isValidBounds(bounds)) {
    return false;
  }

  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;

    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function getInitialWindowState() {
  const savedState = readWindowState();
  const defaultBounds = getDefaultWindowBounds();

  const bounds =
    savedState?.bounds && isBoundsVisible(savedState.bounds)
      ? savedState.bounds
      : defaultBounds;

  return {
    bounds,
    shouldMaximize: savedState?.isMaximized ?? true
  };
}

function createWindow() {
  const initialWindowState = getInitialWindowState();

  const win = new BrowserWindow({
    ...initialWindowState.bounds,
    minWidth: 1100,
    minHeight: 720,
    title: "ContextForge",
    backgroundColor: "#050505",
    frame: false,
    show: false,
    icon: appIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.removeMenu();

  win.once("ready-to-show", () => {
    if (initialWindowState.shouldMaximize) {
      win.maximize();
    }

    win.show();
  });

  win.on("close", () => {
    writeWindowState(win);
  });

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

app.setName("ContextForge");

if (process.platform === "win32") {
  app.setAppUserModelId("com.contextforge.desktop");
}

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