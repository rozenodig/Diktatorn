// Exposes a minimal, typed bridge to the renderers. Sandboxed preloads can only require
// "electron", so channel names are duplicated here instead of imported from src/shared.
const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const on = (channel: string, cb: (payload: unknown) => void) => {
  ipcRenderer.on(channel, (_e, payload) => cb(payload));
};

contextBridge.exposeInMainWorld("diktatorn", {
  capture: {
    onStart: (cb: () => void) => on("capture:start", cb),
    onStop: (cb: () => void) => on("capture:stop", cb),
    onCancel: (cb: () => void) => on("capture:cancel", cb),
    onDevice: (cb: (deviceId: unknown) => void) => on("capture:device", cb),
    started: (micStartMs: number) => ipcRenderer.send("capture:started", micStartMs),
    audio: (samples: Float32Array) => ipcRenderer.send("capture:audio", samples),
    error: (message: string) => ipcRenderer.send("capture:error", message),
    level: (level: number) => ipcRenderer.send("capture:level", level),
  },
  overlay: {
    onState: (cb: (update: unknown) => void) => on("overlay:state", cb),
    onHide: (cb: () => void) => on("overlay:hide", cb),
    onLevel: (cb: (level: unknown) => void) => on("overlay:level", cb),
  },
  app: {
    getState: () => ipcRenderer.invoke("app:get-state"),
    onState: (cb: (state: unknown) => void) => on("app:state", cb),
    setSettings: (patch: unknown) => ipcRenderer.invoke("app:set-settings", patch),
    setDictionary: (entries: unknown) => ipcRenderer.invoke("app:set-dictionary", entries),
    download: (ids: unknown) => ipcRenderer.send("app:download", ids),
    cancelDownload: () => ipcRenderer.send("app:cancel-download"),
    copy: (text: string) => ipcRenderer.send("app:copy", text),
    openSettings: (permission: string) => ipcRenderer.send("app:open-settings", permission),
  },
  debug: {
    onStatus: (cb: (status: unknown) => void) => on("debug:status", cb),
    onResult: (cb: (result: unknown) => void) => on("debug:result", cb),
    record: (down: boolean) => ipcRenderer.send("debug:record", down),
    bench: (command: string) => ipcRenderer.send("debug:bench", command),
    onBench: (cb: (state: unknown) => void) => on("debug:bench-state", cb),
  },
});
