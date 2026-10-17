const { contextBridge, ipcRenderer } = require("electron");

if (process.platform === "win32") {
  const initializeTitleBar = () => {
    const root = document.documentElement;
    if (!root) return false;
    root.dataset.desktop = "true";
    const darkMode = window.matchMedia("(prefers-color-scheme: dark)");
    let previousTheme;
    const updateTheme = () => {
      const dark = root.classList.contains("dark") || (!root.classList.contains("light") && darkMode.matches);
      const theme = dark ? "dark" : "light";
      if (theme === previousTheme) return;
      previousTheme = theme;
      ipcRenderer.send("window:theme", theme);
    };
    new MutationObserver(updateTheme).observe(root, { attributes: true, attributeFilter: ["class"] });
    darkMode.addEventListener("change", updateTheme);
    updateTheme();
    return true;
  };
  if (!initializeTitleBar()) {
    const ready = new MutationObserver(() => {
      if (initializeTitleBar()) ready.disconnect();
    });
    ready.observe(document, { childList: true });
  }
}

contextBridge.exposeInMainWorld("changyiDesktop", {
  getStorage: () => ipcRenderer.invoke("storage:info"),
  chooseDirectory: () => ipcRenderer.invoke("storage:choose"),
  openStorage: () => ipcRenderer.invoke("storage:open"),
  applyStorage: (request) => ipcRenderer.invoke("storage:apply", request),
});
