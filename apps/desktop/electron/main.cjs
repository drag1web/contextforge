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
const {
  DESKTOP_PROTOCOL,
  findDesktopConnectUrl,
  parseDesktopConnectUrl
} = require("./deep-link.cjs");
const {
  createDiscordPresenceService
} = require("./discord-presence.cjs");

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const desktopHeartbeatIntervalMs = 60_000;
let desktopHeartbeatTimer = null;
let desktopSyncService = null;
let discordPresenceService = null;
let pendingDesktopLaunchRequest = null;

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

async function getLocalProjects() {
  const response = await fetch("http://127.0.0.1:4000/api/projects", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(3_000)
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  return Array.isArray(payload?.projects) ? payload.projects : null;
}

async function getLocalProjectCount() {
  const projects = await getLocalProjects();
  return Array.isArray(projects) ? projects.length : null;
}

async function getLocalProjectSnapshot() {
  const projects = await getLocalProjects();
  if (!Array.isArray(projects)) return null;

  return projects.slice(0, 100).map((project) => {
    const readinessScore = Number.isInteger(project?.readinessScore)
      ? Math.max(0, Math.min(100, project.readinessScore))
      : null;
    const rawId = String(project?.id ?? "unknown").replace(/[^a-zA-Z0-9._:-]/g, "-");

    return {
      projectId: `local-${rawId}`,
      name: String(project?.name ?? "Local project").slice(0, 120),
      stack: Array.isArray(project?.detectedStack)
        ? [...new Set(project.detectedStack.filter((item) => typeof item === "string"))].slice(0, 12)
        : [],
      readinessScore,
      gitBranch: null,
      gitDirty: null,
      hasTaskPack: false,
      status: readinessScore === null ? "unknown" : readinessScore >= 80 ? "ready" : "attention",
      lastScannedAt: project?.lastScanAt ?? project?.updatedAt ?? null
    };
  });
}

function broadcastDesktopSyncStatus(status) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop-sync:status-changed", status);
    }
  }
}

function focusMainWindow() {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function queueDesktopConnectUrl(rawUrl) {
  try {
    const trustedOrigin = normalizeWebsiteOrigin(
      process.env.CONTEXTFORGE_WEB_ORIGIN ??
        (isDev ? "http://127.0.0.1:5177" : DEFAULT_WEBSITE_ORIGIN),
      { allowInsecureLocal: isDev }
    );
    pendingDesktopLaunchRequest = parseDesktopConnectUrl(rawUrl, {
      allowInsecureLocal: isDev,
      allowedOrigins: [trustedOrigin]
    });
  } catch {
    return false;
  }

  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send("desktop-sync:launch-request", pendingDesktopLaunchRequest);
    }
  }
  focusMainWindow();
  return true;
}

function registerDesktopProtocolClient() {
  if (process.defaultApp && process.argv[1]) {
    return app.setAsDefaultProtocolClient(
      DESKTOP_PROTOCOL,
      process.execPath,
      [path.resolve(process.argv[1])]
    );
  }

  return app.setAsDefaultProtocolClient(DESKTOP_PROTOCOL);
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
    getProjectSnapshot: getLocalProjectSnapshot,
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

ipcMain.handle("desktop-sync:peek-launch-request", async () =>
  pendingDesktopLaunchRequest
);

ipcMain.handle("desktop-sync:consume-launch-request", async () => {
  const request = pendingDesktopLaunchRequest;
  pendingDesktopLaunchRequest = null;
  return request;
});

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

ipcMain.handle("discord-presence:set-activity", async (_event, activity) => {
  return discordPresenceService?.setActivity(activity) ?? false;
});

ipcMain.handle("discord-presence:get-status", async () => {
  return discordPresenceService?.getStatus() ?? {
    connected: false,
    activity: "dashboard"
  };
});

app.setName("ContextForge");

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const deepLink = findDesktopConnectUrl(commandLine);
    if (deepLink) queueDesktopConnectUrl(deepLink);
    focusMainWindow();
  });
}

app.on("open-url", (event, rawUrl) => {
  event.preventDefault();
  queueDesktopConnectUrl(rawUrl);
});

if (process.platform === "win32") {
  app.setAppUserModelId("com.contextforge.desktop");
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  Menu.setApplicationMenu(null);
  registerDesktopProtocolClient();

  discordPresenceService = createDiscordPresenceService({
    clientId: "1544321040098791444"
  });
  discordPresenceService.start();

  const initialDeepLink = findDesktopConnectUrl(process.argv);
  if (initialDeepLink) queueDesktopConnectUrl(initialDeepLink);

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
  discordPresenceService?.stop();
  discordPresenceService = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
