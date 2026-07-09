const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contextforge", {
  selectProjectFolder: () => ipcRenderer.invoke("dialog:select-project-folder"),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),

  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
    isMaximized: () => ipcRenderer.invoke("window:is-maximized")
  }
});