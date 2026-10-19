// Electron main process: wires the macOS helper, microphone capture and the speech engine
// together, inserts each transcript into the frontmost app, and shows every utterance in
// the debug window.
import { app, BrowserWindow, ipcMain, screen, session, systemPreferences, type IpcMainEvent } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { IPC, type DebugResult, type OverlayState, type StatusUpdate } from "../shared/ipc.ts";
import { planInsertion } from "./apps.ts";
import { transcribeUtterance } from "./dictation.ts";
import { JsonLinesProcess } from "./json-lines.ts";
import type { Lang } from "./language.ts";
import { DEFAULT_MODELS, modelPath } from "./models.ts";
import { Hotkey, type HotkeyAction } from "./hotkey.ts";
import { WhisperProcessEngine } from "./speech-engine.ts";

// Hard-coded until the settings window exists.
const SETTINGS = { languageMode: "auto", primaryLanguage: "sv" } as const;
const MIN_HOLD_MS = 150;
/** A second fn press within this window after a quick tap turns on hands-free mode. */
const DOUBLE_TAP_MS = 300;
const OVERLAY_SIZE = { width: 300, height: 56 };
/** The helper exits with this code once Input Monitoring is granted, so it can be restarted. */
const HELPER_EXIT_PERMISSION_GRANTED = 3;

const binary = (name: string) => join(app.getAppPath(), "build", "bin", name);
const renderer = (file: string) => join(import.meta.dirname, "..", "renderer", file);
const preload = join(import.meta.dirname, "..", "preload", "preload.cjs");

let debugWin: BrowserWindow | null = null;
let captureWin: BrowserWindow | null = null;
let overlayWin: BrowserWindow | null = null;
let overlayHideTimer: NodeJS.Timeout | null = null;
let doubleTapTimer: NodeJS.Timeout | null = null;
let engine: WhisperProcessEngine | null = null;
let engineReady = false;
let helper: JsonLinesProcess | null = null;

const hotkey = new Hotkey({ minHoldMs: MIN_HOLD_MS });
const statuses = new Map<string, StatusUpdate>();
let previousLanguage: Lang | null = null;
let micStartMs: number | null = null;
let queue: Promise<void> = Promise.resolve();

function setStatus(update: StatusUpdate): void {
  console.log(`[status] ${update.key}: ${update.text}`);
  statuses.set(update.key, update);
  debugWin?.webContents.send(IPC.debugStatus, update);
}

/** Shows the overlay without activating the app, so the target text field keeps focus. */
function showOverlay(state: OverlayState, text: string, hideAfterMs?: number): void {
  if (!overlayWin) return;
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = hideAfterMs === undefined ? null : setTimeout(hideOverlay, hideAfterMs);
  overlayWin.webContents.send(IPC.overlayState, { state, text });
  if (!overlayWin.isVisible()) {
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    overlayWin.setBounds({
      x: Math.round(area.x + (area.width - OVERLAY_SIZE.width) / 2),
      y: Math.round(area.y + area.height - OVERLAY_SIZE.height - 24),
      ...OVERLAY_SIZE,
    });
    overlayWin.showInactive();
  }
}

function hideOverlay(): void {
  if (overlayHideTimer) clearTimeout(overlayHideTimer);
  overlayHideTimer = null;
  overlayWin?.hide();
}

/** Tells the helper whether Esc should currently cancel (and be swallowed). */
function setRecording(active: boolean): void {
  helper?.request("recording", { active }).catch(() => {});
}

function act(action: HotkeyAction): void {
  if (action === "none") return;
  if (doubleTapTimer) clearTimeout(doubleTapTimer);
  doubleTapTimer = null;
  switch (action) {
    case "start":
      micStartMs = null;
      captureWin?.webContents.send(IPC.captureStart);
      setRecording(true);
      showOverlay("listening", "Listening");
      setStatus({ key: "recording", ok: true, text: "recording…" });
      break;
    case "pending":
      doubleTapTimer = setTimeout(() => act(hotkey.expire()), DOUBLE_TAP_MS);
      break;
    case "handsFree":
      showOverlay("handsFree", "Hands-free · tap fn to finish");
      setStatus({ key: "recording", ok: true, text: "recording hands-free…" });
      break;
    case "stop":
      captureWin?.webContents.send(IPC.captureStop);
      setRecording(false);
      showOverlay("processing", "Transcribing");
      setStatus({ key: "recording", ok: true, text: "transcribing…" });
      break;
    case "cancel":
      captureWin?.webContents.send(IPC.captureCancel);
      setRecording(false);
      hideOverlay();
      setStatus({ key: "recording", ok: true, text: "cancelled" });
      break;
  }
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
  if (!r.text) hideOverlay();
  else if (insertion?.pasted) showOverlay("done", "Inserted", 700);
  else showOverlay("done", "Copied to clipboard", 1500);
}

function fail(err: unknown): void {
  setStatus({ key: "asr", ok: false, text: String(err) });
  showOverlay("error", "Something went wrong", 2500);
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
    tap?: boolean; tapActive?: boolean; hid?: boolean; message?: string; reason?: string;
  };
  proc.on("event", (msg: HelperEvent) => {
    switch (msg.event) {
      case "ready":
        setStatus(msg.inputMonitoring
          ? { key: "keys", ok: true, text: `hold fn to dictate, double-tap for hands-free (HID ${msg.hid ? "on" : "off"}, event tap ${msg.tapActive ? "active" : msg.tap ? "listen-only, Esc not swallowed" : "off"})` }
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
        act(msg.down ? hotkey.fnDown(msg.t) : hotkey.fnUp(msg.t));
        break;
      case "chord":
        act(hotkey.chord());
        break;
      case "escape":
        act(hotkey.escape());
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
  queue = queue.then(() => handleAudio(samples)).catch(fail);
});
ipcMain.on(IPC.captureError, (e, message: string) => {
  if (from(captureWin, e)) setStatus({ key: "mic", ok: false, text: message });
});
ipcMain.on(IPC.debugRecord, (e, down: boolean) => {
  if (from(debugWin, e)) act(down ? hotkey.fnDown(performance.now()) : hotkey.fnUp(performance.now()));
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

  // A non-activating panel that ignores the mouse: it can never take focus from the text field
  // the user is dictating into, so the paste lands where they were typing.
  overlayWin = new BrowserWindow({
    ...OVERLAY_SIZE,
    type: "panel",
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    alwaysOnTop: true,
    hiddenInMissionControl: true,
    webPreferences,
  });
  overlayWin.setAlwaysOnTop(true, "screen-saver");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWin.setIgnoreMouseEvents(true);
  await overlayWin.loadFile(renderer("overlay.html"));

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
