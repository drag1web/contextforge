const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contextforge", {
  selectProjectFolder: () => ipcRenderer.invoke("dialog:select-project-folder"),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),
  desktopSync: {
    getStatus: (options) =>
      ipcRenderer.invoke("desktop-sync:get-status", options),
    pair: (input) => ipcRenderer.invoke("desktop-sync:pair", input),
    peekLaunchRequest: () =>
      ipcRenderer.invoke("desktop-sync:peek-launch-request"),
    consumeLaunchRequest: () =>
      ipcRenderer.invoke("desktop-sync:consume-launch-request"),
    onLaunchRequest: (listener) => {
      const handler = (_event, request) => listener(request);
      ipcRenderer.on("desktop-sync:launch-request", handler);

      return () => {
        ipcRenderer.removeListener("desktop-sync:launch-request", handler);
      };
    },
    heartbeat: () => ipcRenderer.invoke("desktop-sync:heartbeat"),
    checkForUpdates: () => ipcRenderer.invoke("desktop-sync:check-update"),
    publishTaskPack: (taskPack) =>
      ipcRenderer.invoke("desktop-sync:publish-task-pack", taskPack),
    getTaskPackInbox: () =>
      ipcRenderer.invoke("desktop-sync:get-task-pack-inbox"),
    acknowledgeTaskPack: (deliveryId, status, options) =>
      ipcRenderer.invoke("desktop-sync:ack-task-pack", { deliveryId, status, options }),
    unpair: () => ipcRenderer.invoke("desktop-sync:unpair"),
    openPairingPage: (siteUrl) =>
      ipcRenderer.invoke("desktop-sync:open-pairing-page", siteUrl),
    onStatusChanged: (listener) => {
      const handler = (_event, status) => listener(status);
      ipcRenderer.on("desktop-sync:status-changed", handler);

      return () => {
        ipcRenderer.removeListener("desktop-sync:status-changed", handler);
      };
    }
  },
  discordPresence: {
    setActivity: (activity) =>
      ipcRenderer.invoke("discord-presence:set-activity", activity),
    getStatus: () =>
      ipcRenderer.invoke("discord-presence:get-status")
  },

  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized")
  }
});
