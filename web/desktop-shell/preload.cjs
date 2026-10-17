const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("changyiDesktop", {
  getStorage: () => ipcRenderer.invoke("storage:info"),
  chooseDirectory: (purpose) => ipcRenderer.invoke("storage:choose", purpose),
  openStorage: () => ipcRenderer.invoke("storage:open"),
  applyStorage: (request) => ipcRenderer.invoke("storage:apply", request),
});
