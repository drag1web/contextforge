const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("contextforge", {
  selectProjectFolder: () => ipcRenderer.invoke("dialog:select-project-folder")
});
