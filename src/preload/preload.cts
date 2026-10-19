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
    started: (micStartMs: number) => ipcRenderer.send("capture:started", micStartMs),
    audio: (samples: Float32Array) => ipcRenderer.send("capture:audio", samples),
    error: (message: string) => ipcRenderer.send("capture:error", message),
  },
  overlay: {
    onState: (cb: (update: unknown) => void) => on("overlay:state", cb),
  },
  debug: {
    onStatus: (cb: (status: unknown) => void) => on("debug:status", cb),
    onResult: (cb: (result: unknown) => void) => on("debug:result", cb),
    record: (down: boolean) => ipcRenderer.send("debug:record", down),
  },
});
