const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  powerMonitor,
  safeStorage,
  screen,
  shell
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_WEBSITE_ORIGIN,
  createDesktopSyncService,
  normalizeWebsiteOrigin
} = require("./desktop-sync.cjs");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const desktopHeartbeatIntervalMs = 60_000;
let desktopHeartbeatTimer = null;
let desktopSyncService = null;

const appIconPath = path.join(
  __dirname,
  "assets",
  process.platform === "win32" ? "icon.ico" : "icon.png"
);

function getDesktopAppVersion() {
  if (!isDev) {
    return app.getVersion();
  }

  try {
    const packageMetadata = require(path.join(__dirname, "../../../package.json"));
    return String(packageMetadata.version ?? app.getVersion());
  } catch {
    return app.getVersion();
  }
}

async function getLocalProjectCount() {
  const response = await fetch("http://127.0.0.1:4000/api/projects", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(3_000)
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return Array.isArray(payload?.projects) ? payload.projects.length : null;
}

function broadcastDesktopSyncStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop-sync:status-changed", status);
    }
  }
}

function createDesktopSync() {
  return createDesktopSyncService({
    appVersion: getDesktopAppVersion(),
    platform: process.platform,
    arch: process.arch,
    isDev,
    defaultSiteUrl:
      process.env.CONTEXTFORGE_WEB_ORIGIN ??
      (isDev ? "http://127.0.0.1:5177" : DEFAULT_WEBSITE_ORIGIN),
    userDataPath: app.getPath("userData"),
    secureStorage: safeStorage,
    getProjectCount: getLocalProjectCount,
    onStatusChanged: broadcastDesktopSyncStatus
  });
}

function startDesktopHeartbeat() {
  if (desktopHeartbeatTimer) {
    return;
  }

  desktopHeartbeatTimer = setInterval(() => {
    if (desktopSyncService?.getStatus().configured) {
      void desktopSyncService.heartbeat().catch(() => {
        // Offline website access never interrupts the local-first workspace.
      });
    }
  }, desktopHeartbeatIntervalMs);

  desktopHeartbeatTimer.unref?.();
}

function stopDesktopHeartbeat() {
  if (desktopHeartbeatTimer) {
    clearInterval(desktopHeartbeatTimer);
    desktopHeartbeatTimer = null;
  }
}

function requireDesktopSync() {
  if (!desktopSyncService) {
    throw new Error("DESKTOP_SYNC_NOT_READY: Desktop sync is not ready.");
  }

  return desktopSyncService;
}

async function runDesktopSyncOperation(operation) {
  try {
    return await operation(requireDesktopSync());
  } catch (error) {
    const code =
      typeof error?.code === "string" ? error.code : "DESKTOP_SYNC_FAILED";
    const message =
      error instanceof Error ? error.message : "Desktop sync failed.";
    throw new Error(`${code}: ${message}`);
  }
}

function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);

    return (
      (url.protocol === "https:" &&
        (url.hostname === "github.com" ||
          url.hostname.endsWith(".github.com") ||
          url.hostname === "githubusercontent.com" ||
          url.hostname.endsWith(".githubusercontent.com"))) ||
      Boolean(desktopSyncService?.isAllowedWebsiteUrl(rawUrl))
    );
  } catch {
    return false;
  }
}

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


ipcMain.handle("shell:open-external", async (_event, rawUrl) => {
  if (typeof rawUrl !== "string" || !isAllowedExternalUrl(rawUrl)) {
    return false;
  }

  await shell.openExternal(rawUrl);
  return true;
});

ipcMain.handle("desktop-sync:get-status", async (_event, options) =>
  runDesktopSyncOperation(async (service) => {
    if (options?.refresh && service.getStatus().configured) {
      try {
        await service.refreshAccount();
      } catch {
        // Return the current offline/error state to the renderer.
      }
    }

    return service.getStatus();
  })
);

ipcMain.handle("desktop-sync:pair", async (_event, input) =>
  runDesktopSyncOperation((service) => service.pair(input))
);

ipcMain.handle("desktop-sync:heartbeat", async () =>
  runDesktopSyncOperation((service) => service.heartbeat())
);

ipcMain.handle("desktop-sync:check-update", async () =>
  runDesktopSyncOperation((service) => service.checkForUpdates())
);

ipcMain.handle("desktop-sync:publish-task-pack", async (_event, taskPack) =>
  runDesktopSyncOperation((service) => service.publishTaskPack(taskPack))
);

ipcMain.handle("desktop-sync:get-task-pack-inbox", async () =>
  runDesktopSyncOperation((service) => service.getTaskPackInbox())
);

ipcMain.handle("desktop-sync:ack-task-pack", async (_event, input) =>
  runDesktopSyncOperation((service) =>
    service.acknowledgeTaskPack(input?.deliveryId, input?.status, input?.options)
  )
);

ipcMain.handle("desktop-sync:unpair", async () =>
  runDesktopSyncOperation((service) => service.unpair())
);

ipcMain.handle("desktop-sync:open-pairing-page", async (_event, rawSiteUrl) =>
  runDesktopSyncOperation(async () => {
    const origin = normalizeWebsiteOrigin(rawSiteUrl, {
      allowInsecureLocal: isDev
    });
    await shell.openExternal(`${origin}/devices`);
    return true;
  })
);

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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  try {
    desktopSyncService = createDesktopSync();
    await desktopSyncService.initialize();
    startDesktopHeartbeat();
    powerMonitor.on("resume", () => {
      if (desktopSyncService?.getStatus().configured) {
        void desktopSyncService.heartbeat().catch(() => {});
      }
    });
  } catch (error) {
    console.error("Desktop sync initialization failed:", error);
    desktopSyncService = null;
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  stopDesktopHeartbeat();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
