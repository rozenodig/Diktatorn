// Electron main process: wires the macOS helper, microphone capture and the speech engine
// together, inserts each transcript into the frontmost app, and shows every utterance in
// the debug window.
import { app, BrowserWindow, ipcMain, session, systemPreferences, type IpcMainEvent } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { IPC, type DebugResult, type StatusUpdate } from "../shared/ipc.ts";
import { planInsertion } from "./apps.ts";
import { transcribeUtterance } from "./dictation.ts";
import { JsonLinesProcess } from "./json-lines.ts";
import type { Lang } from "./language.ts";
import { DEFAULT_MODELS, modelPath } from "./models.ts";
import { PushToTalk, type PttAction } from "./ptt.ts";
import { WhisperProcessEngine } from "./speech-engine.ts";

// Hard-coded until the settings window exists.
const SETTINGS = { languageMode: "auto", primaryLanguage: "sv" } as const;
const MIN_HOLD_MS = 150;
/** The helper exits with this code once Input Monitoring is granted, so it can be restarted. */
const HELPER_EXIT_PERMISSION_GRANTED = 3;

const binary = (name: string) => join(app.getAppPath(), "build", "bin", name);
const renderer = (file: string) => join(import.meta.dirname, "..", "renderer", file);
const preload = join(import.meta.dirname, "..", "preload", "preload.cjs");

let debugWin: BrowserWindow | null = null;
let captureWin: BrowserWindow | null = null;
let engine: WhisperProcessEngine | null = null;
let engineReady = false;
let helper: JsonLinesProcess | null = null;

const ptt = new PushToTalk({ minHoldMs: MIN_HOLD_MS });
const statuses = new Map<string, StatusUpdate>();
let previousLanguage: Lang | null = null;
let micStartMs: number | null = null;
let queue: Promise<void> = Promise.resolve();

function setStatus(update: StatusUpdate): void {
  console.log(`[status] ${update.key}: ${update.text}`);
  statuses.set(update.key, update);
  debugWin?.webContents.send(IPC.debugStatus, update);
}

function act(action: PttAction): void {
  if (action === "none") return;
  const channel = { start: IPC.captureStart, stop: IPC.captureStop, cancel: IPC.captureCancel }[action];
  if (action === "start") micStartMs = null;
  captureWin?.webContents.send(channel);
  setStatus({ key: "recording", ok: true, text: action === "start" ? "recording…" : action === "stop" ? "transcribing…" : "cancelled" });
}

/** Only accept IPC from the window that is supposed to send it. */
const from = (win: BrowserWindow | null, e: IpcMainEvent) => win !== null && e.sender === win.webContents;

async function insert(text: string): Promise<DebugResult["insertion"]> {
  if (!helper) return null;
  const t0 = performance.now();
  const front = await helper.request("frontmost");
  const bundleId = (front.bundleId as string | null) ?? null;
  const plan = planInsertion(text, bundleId);
  if (!plan) return null;
  const res = await helper.request("insert", { text: plan.text, restoreDelayMs: plan.restoreDelayMs });
  setStatus(res.pasted
    ? { key: "paste", ok: true, text: "pastes into the frontmost app" }
    : { key: "paste", ok: false, text: String(res.note) });
  return {
    app: bundleId,
    kind: plan.kind,
    pasted: res.pasted === true,
    restored: res.restored === true,
    note: String(res.note ?? ""),
    ms: performance.now() - t0,
  };
}

async function handleAudio(samples: Float32Array): Promise<void> {
  if (!engine || !engineReady) {
    setStatus({ key: "asr", ok: false, text: "speech engine not ready; utterance dropped" });
    return;
  }
  const r = await transcribeUtterance(engine, samples, SETTINGS, previousLanguage);
  if (r.language) previousLanguage = r.language.language;
  const insertion = r.text ? await insert(r.text) : null;
  const result: DebugResult = {
    at: new Date().toLocaleTimeString("sv-SE"),
    text: r.text,
    speech: r.speech,
    language: r.language?.language ?? null,
    reason: r.language?.reason ?? null,
    probs: r.probs,
    audioMs: r.audioMs,
    speechMs: r.speechMs,
    micStartMs,
    timings: r.timings,
    insertion,
  };
  const mic = micStartMs === null ? "-" : `${Math.round(micStartMs)} ms`;
  const where = insertion ? ` -> ${insertion.app ?? "?"} (${insertion.pasted ? "pasted" : "not pasted"}, ${insertion.restored ? "restored" : insertion.note || "not restored"})` : "";
  console.log(`[result] ${result.language ?? "-"} ${Math.round(r.timings.totalMs)} ms (audio ${Math.round(r.audioMs)} ms, mic start ${mic}): ${result.text || "(no speech)"}${where}`);
  debugWin?.webContents.send(IPC.debugResult, result);
  setStatus({ key: "recording", ok: true, text: "idle" });
}

async function ensureMicrophone(): Promise<void> {
  const before = systemPreferences.getMediaAccessStatus("microphone");
  const granted = before === "granted" || (await systemPreferences.askForMediaAccess("microphone"));
  setStatus({ key: "mic", ok: granted, text: granted ? "access granted" : `access ${before}; allow in System Settings → Privacy → Microphone` });
}

async function startSpeechEngine(): Promise<void> {
  const paths = { sv: modelPath(DEFAULT_MODELS.sv), en: modelPath(DEFAULT_MODELS.en), vad: modelPath(DEFAULT_MODELS.vad) };
  const missing = [binary("diktatorn-asr"), ...Object.values(paths)].filter((p) => !existsSync(p));
  if (missing.length > 0) {
    setStatus({ key: "asr", ok: false, text: `missing ${missing.join(", ")}; run npm run build:native and npm run fetch-models` });
    return;
  }
  engine = new WhisperProcessEngine(binary("diktatorn-asr"));
  setStatus({ key: "asr", ok: true, text: "loading models…" });
  const t0 = performance.now();
  try {
    await engine.ensureLoaded({ sv: paths.sv, en: paths.en }, paths.vad);
    engineReady = true;
    setStatus({ key: "asr", ok: true, text: `ready (${DEFAULT_MODELS.sv} + ${DEFAULT_MODELS.en}, loaded in ${Math.round(performance.now() - t0)} ms)` });
  } catch (err) {
    setStatus({ key: "asr", ok: false, text: String(err) });
  }
}

const PERMISSION_HINT = 'Diktatorn ("Electron" when started with npm start) in System Settings → Privacy & Security';

function startHelper(): void {
  if (!existsSync(binary("diktatorn-helper"))) {
    setStatus({ key: "keys", ok: false, text: "missing helper; run npm run build:native" });
    return;
  }
  const proc = new JsonLinesProcess("helper", binary("diktatorn-helper"));
  helper = proc;
  type HelperEvent = {
    event: string; down?: boolean; t: number; inputMonitoring?: boolean; accessibility?: boolean;
    tap?: boolean; hid?: boolean; message?: string; reason?: string;
  };
  proc.on("event", (msg: HelperEvent) => {
    switch (msg.event) {
      case "ready":
        setStatus(msg.inputMonitoring
          ? { key: "keys", ok: true, text: `hold fn to dictate (HID ${msg.hid ? "on" : "off"}, event tap ${msg.tap ? "on" : "off"})` }
          : { key: "keys", ok: false, text: `Input Monitoring not granted. Allow ${PERMISSION_HINT} → Input Monitoring; fn starts working as soon as it is on.` });
        setStatus(msg.accessibility
          ? { key: "paste", ok: true, text: "pastes into the frontmost app" }
          : { key: "paste", ok: false, text: `Accessibility not granted; transcripts are left on the clipboard. Allow ${PERMISSION_HINT} → Accessibility.` });
        break;
      case "permission":
        setStatus({ key: "keys", ok: true, text: "Input Monitoring granted; restarting helper…" });
        break;
      case "debug":
        console.log(`[helper] debug ${JSON.stringify(msg)}`);
        break;
      case "fn":
        act(msg.down ? ptt.fnDown(msg.t) : ptt.fnUp(msg.t));
        break;
      case "chord":
        act(ptt.chord(msg.t));
        break;
      case "tap":
        console.warn(`[helper] event tap re-enabled after ${msg.reason}`);
        break;
      case "error":
        setStatus({ key: "keys", ok: false, text: msg.message ?? "error" });
        break;
    }
  });
  proc.on("exit", (code: number | null) => {
    if (helper !== proc) return; // superseded or shutting down
    if (code === HELPER_EXIT_PERMISSION_GRANTED) startHelper();
    else setStatus({ key: "keys", ok: false, text: `helper exited (code ${code})` });
  });
}

ipcMain.on(IPC.captureStarted, (e, ms: number) => {
  if (from(captureWin, e)) micStartMs = ms;
});
ipcMain.on(IPC.captureAudio, (e, samples: Float32Array) => {
  if (!from(captureWin, e)) return;
  queue = queue.then(() => handleAudio(samples)).catch((err) => setStatus({ key: "asr", ok: false, text: String(err) }));
});
ipcMain.on(IPC.captureError, (e, message: string) => {
  if (from(captureWin, e)) setStatus({ key: "mic", ok: false, text: message });
});
ipcMain.on(IPC.debugRecord, (e, down: boolean) => {
  if (from(debugWin, e)) act(down ? ptt.fnDown(performance.now()) : ptt.fnUp(performance.now()));
});

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");

  const webPreferences = { preload, sandbox: true, contextIsolation: true, nodeIntegration: false };
  debugWin = new BrowserWindow({ width: 760, height: 640, title: "Diktatorn — debug", webPreferences });
  debugWin.webContents.on("did-finish-load", () => statuses.forEach((s) => debugWin?.webContents.send(IPC.debugStatus, s)));
  debugWin.on("closed", () => (debugWin = null));
  await debugWin.loadFile(renderer("debug.html"));

  captureWin = new BrowserWindow({
    show: false,
    webPreferences: { ...webPreferences, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  await captureWin.loadFile(renderer("capture.html"));

  setStatus({ key: "recording", ok: true, text: "idle" });
  // A pending permission prompt must not hold up the helpers, so none of these block each other.
  startHelper();
  void startSpeechEngine();
  void ensureMicrophone();
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => {
  engine?.close();
  const h = helper;
  helper = null;
  h?.close();
});
