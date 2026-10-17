const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("changyiDesktop", {
  getStorage: () => ipcRenderer.invoke("storage:info"),
  chooseDirectory: () => ipcRenderer.invoke("storage:choose"),
  openStorage: () => ipcRenderer.invoke("storage:open"),
  applyStorage: (request) => ipcRenderer.invoke("storage:apply", request),
});
