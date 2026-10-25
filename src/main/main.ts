// Electron main process: wires the macOS helper, microphone capture, the speech engine, text
// cleanup, settings and model downloads together, inserts each transcript into the frontmost
// app, and owns the app window, menu bar icon, overlay and debug window.
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Tray,
} from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  FIRST_RUN_MODELS,
  IPC,
  type AppState,
  type BenchCommand,
  type DebugResult,
  type DictionaryEntry,
  type Permission,
  type Permissions,
  type RecentDictation,
  type Settings,
  type StatusUpdate,
} from "../shared/ipc.ts";
import { AppWindow, createTray } from "./app-window.ts";
import { planInsertion } from "./apps.ts";
import { BenchRecorder } from "./bench.ts";
import { DictionaryFile, dictionaryPrompt, saveDictionary } from "./cleanup/dictionary.ts";
import { LlamaCleaner } from "./cleanup/llm.ts";
import { cleanUp, LLM_TIMEOUT_MS } from "./cleanup/pipeline.ts";
import { transcribeUtterance } from "./dictation.ts";
import { Hotkey, type HotkeyAction } from "./hotkey.ts";
import { JsonLinesProcess } from "./json-lines.ts";
import { PRIMARY_LANGUAGE, type Lang } from "./language.ts";
import { ModelStore } from "./model-store.ts";
import { DEFAULT_CLEANUP_MODEL, DEFAULT_MODELS, MODELS, type ModelId } from "./models.ts";
import { Overlay } from "./overlay.ts";
import { RestartPolicy } from "./restart.ts";
import { SettingsStore } from "./settings.ts";
import { WhisperProcessEngine } from "./speech-engine.ts";

// Finder and LaunchServices start the packaged app without arguments. A command-line switch such
// as --remote-debugging-port, which no Electron fuse turns off, would let other code drive the app
// and use its permissions, so the packaged app refuses to start with any.
if (app.isPackaged && process.argv.length > 1) {
  console.error(`Diktatorn doesn't take command-line arguments: ${process.argv.slice(1).join(" ")}`);
  process.exit(1);
}

const MIN_HOLD_MS = 150;
/** A second press within this window after a quick tap turns on hands-free mode. */
const DOUBLE_TAP_MS = 300;
/** The helper exits with this code once it has keyboard access, so it can be restarted with a working tap. */
const HELPER_EXIT_PERMISSION_GRANTED = 3;
const MAX_RECENT = 20;
const KEY_NAMES: Record<Settings["hotkey"], string> = {
  fn: "fn",
  rightOption: "right ⌥",
  rightCommand: "right ⌘",
  rightControl: "right ⌃",
};

// A packaged app keeps the helpers beside its own executable in Contents/MacOS, where they are
// signed with the app. Development builds run them from build/bin.
const binary = (name: string) =>
  app.isPackaged ? join(dirname(process.execPath), name) : join(app.getAppPath(), "build", "bin", name);
const renderer = (file: string) => join(import.meta.dirname, "..", "renderer", file);
const preload = join(import.meta.dirname, "..", "preload", "preload.cjs");
const webPreferences = { preload, sandbox: true, contextIsolation: true, nodeIntegration: false };

const userData = app.getPath("userData");
const settings = new SettingsStore(join(userData, "settings.json"));
const models = new ModelStore(userData);
const dictionaryFile = new DictionaryFile(join(userData, "dictionary.json"));
const appWindow = new AppWindow(renderer("app.html"), webPreferences);
/** Development only: records the benchmark sentences from the debug window. */
const benchDir = join(app.getAppPath(), "bench");
const bench = BenchRecorder.available(benchDir) ? new BenchRecorder(benchDir) : null;

let debugWin: BrowserWindow | null = null;
let captureWin: BrowserWindow | null = null;
let overlay: Overlay | null = null;
let tray: Tray | null = null;
let doubleTapTimer: NodeJS.Timeout | null = null;
let engine: WhisperProcessEngine | null = null;
let engineReady = false;
let engineLoad: Promise<void> = Promise.resolve();
let helper: JsonLinesProcess | null = null;
let cleaner: LlamaCleaner | null = null;
let cleanerReady = false;
let dictionary: DictionaryEntry[] = [];
/** True until every first-run model is on disk. */
let setup = false;
/** As the helper last reported them; null until it has started. */
const helperPermissions: Omit<Permissions, "microphone"> = { accessibility: null };
let microphoneWatch: NodeJS.Timeout | null = null;

const hotkey = new Hotkey({ minHoldMs: MIN_HOLD_MS });
const engineRestarts = new RestartPolicy();
const cleanerRestarts = new RestartPolicy();
const helperRestarts = new RestartPolicy();
const statuses = new Map<string, StatusUpdate>();
const recent: RecentDictation[] = [];
let previousLanguage: Lang | null = null;
let micStartMs: number | null = null;
let queue: Promise<void> = Promise.resolve();

function appState(): AppState {
  const mic = systemPreferences.getMediaAccessStatus("microphone");
  const permissions = { microphone: mic === "granted" ? true : mic === "not-determined" ? null : false, ...helperPermissions };
  return { settings: settings.current, statuses: [...statuses.values()], models: models.info(), recent, dictionary, permissions, setup };
}

function pushState(): void {
  appWindow.send(IPC.appState, appState());
}

function setStatus(update: StatusUpdate): void {
  console.log(`[status] ${update.key}: ${update.text}`);
  statuses.set(update.key, update);
  debugWin?.webContents.send(IPC.debugStatus, update);
  pushState();
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
      overlay?.show("listening", "Listening");
      setStatus({ key: "recording", ok: true, text: "recording…" });
      break;
    case "pending":
      doubleTapTimer = setTimeout(() => act(hotkey.expire()), DOUBLE_TAP_MS);
      break;
    case "handsFree":
      overlay?.show("handsFree", `Hands-free · tap ${KEY_NAMES[settings.current.hotkey]} to finish`);
      setStatus({ key: "recording", ok: true, text: "recording hands-free…" });
      break;
    case "stop":
      captureWin?.webContents.send(IPC.captureStop);
      setRecording(false);
      overlay?.show("processing", "Transcribing");
      setStatus({ key: "recording", ok: true, text: "transcribing…" });
      break;
    case "cancel":
      captureWin?.webContents.send(IPC.captureCancel);
      setRecording(false);
      overlay?.hide();
      setStatus({ key: "recording", ok: true, text: "cancelled" });
      break;
  }
}

/** Only accept IPC from the window that is supposed to send it. */
const from = (win: { webContents: Electron.WebContents } | null, e: IpcMainEvent | IpcMainInvokeEvent) =>
  win !== null && e.sender === win.webContents;
const fromApp = (e: IpcMainEvent | IpcMainInvokeEvent) => appWindow.webContents !== null && e.sender === appWindow.webContents;

async function insert(text: string): Promise<DebugResult["insertion"]> {
  if (!helper) return null;
  const t0 = performance.now();
  const front = await helper.request("frontmost");
  const bundleId = (front.bundleId as string | null) ?? null;
  const appName = (front.name as string | null) ?? null;
  const plan = planInsertion(text, bundleId);
  if (!plan) return null;
  const res = await helper.request("insert", { text: plan.text, restoreDelayMs: plan.restoreDelayMs });
  setStatus(res.pasted
    ? { key: "paste", ok: true, text: "pastes into the frontmost app" }
    : { key: "paste", ok: false, text: String(res.note) });
  return {
    app: bundleId,
    appName,
    kind: plan.kind,
    pasted: res.pasted === true,
    restored: res.restored === true,
    note: String(res.note ?? ""),
    ms: performance.now() - t0,
  };
}

async function refreshDictionary(): Promise<DictionaryEntry[]> {
  dictionary = await dictionaryFile.current();
  if (dictionaryFile.error) setStatus({ key: "cleanup", ok: false, text: `dictionary not loaded: ${dictionaryFile.error}` });
  return dictionary;
}

async function handleAudio(samples: Float32Array): Promise<void> {
  if (bench?.active) return saveBenchTake(bench, samples);
  if (!engine || !engineReady) {
    setStatus({ key: "asr", ok: false, text: "speech engine not ready; dictation dropped" });
    overlay?.show("error", "Still getting ready", 2000);
    return;
  }
  const entries = await refreshDictionary();
  const utterance = {
    languageMode: settings.current.languageMode,
    primaryLanguage: PRIMARY_LANGUAGE,
    prompt: dictionaryPrompt(entries),
  };
  const r = await transcribeUtterance(engine, samples, utterance, previousLanguage);
  if (r.language) previousLanguage = r.language.language;
  const cleanup = r.text
    ? await cleanUp(r.text, { dictionary: entries, llm: cleanerReady ? cleaner : null, llmTimeoutMs: LLM_TIMEOUT_MS })
    : null;
  const text = cleanup?.text ?? "";
  const insertion = text ? await insert(text) : null;
  const at = new Date().toLocaleTimeString("sv-SE");
  const result: DebugResult = {
    at,
    text,
    raw: r.text,
    speech: r.speech,
    language: r.language?.language ?? null,
    reason: r.language?.reason ?? null,
    probs: r.probs,
    audioMs: r.audioMs,
    speechMs: r.speechMs,
    micStartMs,
    timings: r.timings,
    cleanup: cleanup && { ms: cleanup.ms, llm: cleanup.llm },
    insertion,
  };
  const mic = micStartMs === null ? "-" : `${Math.round(micStartMs)} ms`;
  const where = insertion ? ` -> ${insertion.app ?? "?"} (${insertion.pasted ? "pasted" : "not pasted"}, ${insertion.restored ? "restored" : insertion.note || "not restored"})` : "";
  console.log(`[result] ${result.language ?? "-"} ${Math.round(r.timings.totalMs)} ms (audio ${Math.round(r.audioMs)} ms, mic start ${mic}): ${result.text || "(no speech)"}${where}`);
  if (cleanup && text !== r.text) console.log(`[cleanup] ${Math.round(cleanup.ms)} ms, llm ${cleanup.llm?.status ?? "off"}: ${r.text} => ${text}`);
  else if (cleanup?.llm && cleanup.llm.status !== "unchanged") console.log(`[cleanup] llm ${cleanup.llm.status}: ${cleanup.llm.detail}`);
  debugWin?.webContents.send(IPC.debugResult, result);
  if (text) {
    recent.unshift({ at: at.slice(0, 5), text, app: insertion?.appName ?? insertion?.app ?? null });
    recent.length = Math.min(recent.length, MAX_RECENT);
  }
  setStatus({ key: "recording", ok: true, text: "idle" });
  if (!text) overlay?.hide();
  else if (insertion?.pasted) overlay?.show("done", "Inserted", 700);
  else overlay?.show("done", "Copied to clipboard", 1500);
}

/** While benchmark recording is on, a take is saved for the benchmark instead of transcribed. */
async function saveBenchTake(recorder: BenchRecorder, samples: Float32Array): Promise<void> {
  const id = await recorder.save(samples);
  sendBenchState();
  setStatus({ key: "recording", ok: true, text: `saved benchmark take ${id}` });
  overlay?.show("done", `Saved ${id}`, 700);
}

function sendBenchState(): void {
  debugWin?.webContents.send(IPC.debugBenchState, bench?.state() ?? null);
}

async function runBenchCommand(recorder: BenchRecorder, command: BenchCommand): Promise<void> {
  if (command === "start") await recorder.start();
  else if (command === "stop") recorder.stop();
  else if (command === "previous") recorder.move(-1);
  else if (command === "next") recorder.move(1);
  const { active, index, total, recorded } = recorder.state();
  console.log(`[bench] ${command}: ${active ? "recording" : "off"}, sentence ${index + 1}/${total}, ${recorded} recorded`);
  sendBenchState();
}

function benchFailed(err: unknown): void {
  setStatus({ key: "recording", ok: false, text: `benchmark: ${(err as Error).message}` });
}

/** Opens the debug window with benchmark recording already on. */
async function recordBenchmark(recorder: BenchRecorder): Promise<void> {
  await openDebugWindow();
  await runBenchCommand(recorder, "start");
}

function fail(err: unknown): void {
  setStatus({ key: "asr", ok: false, text: String(err) });
  overlay?.show("error", "Something went wrong", 2500);
}

async function ensureMicrophone(): Promise<void> {
  const before = systemPreferences.getMediaAccessStatus("microphone");
  const granted = before === "granted" || (await systemPreferences.askForMediaAccess("microphone"));
  setStatus({ key: "mic", ok: granted, text: granted ? "access granted" : `access ${before}; allow in System Settings → Privacy → Microphone` });
  if (!granted) watchMicrophone();
}

/** Checks every second until the microphone is switched on in System Settings, so the app window updates. */
function watchMicrophone(): void {
  if (microphoneWatch) return;
  microphoneWatch = setInterval(() => {
    if (systemPreferences.getMediaAccessStatus("microphone") !== "granted") return;
    clearInterval(microphoneWatch!);
    microphoneWatch = null;
    setStatus({ key: "mic", ok: true, text: "access granted" });
  }, 1000);
}

/** (Re)loads the speech models, once they are on disk. Calls are serialised. */
function loadSpeechEngine(): Promise<void> {
  engineLoad = engineLoad.then(async () => {
    if (!existsSync(binary("diktatorn-asr"))) {
      setStatus({ key: "asr", ok: false, text: "missing speech engine; run npm run build:native" });
      return;
    }
    // Use the chosen Swedish model once it is downloaded, the default one until then.
    const sv: ModelId = models.isReady(settings.current.swedishModel) ? settings.current.swedishModel : DEFAULT_MODELS.sv;
    const needed: ModelId[] = [sv, DEFAULT_MODELS.en, DEFAULT_MODELS.vad];
    if (!needed.every((id) => models.isReady(id))) {
      setStatus({ key: "asr", ok: true, text: "waiting for the speech models to download…" });
      return;
    }
    if (!engine) {
      const created = new WhisperProcessEngine(binary("diktatorn-asr"));
      created.onExit((reason) => speechEngineExited(created, reason));
      engine = created;
    }
    if (!engineReady) setStatus({ key: "asr", ok: true, text: "loading models…" });
    const t0 = performance.now();
    try {
      await engine.ensureLoaded({ sv: models.path(sv), en: models.path(DEFAULT_MODELS.en) }, models.path(DEFAULT_MODELS.vad));
      engineReady = true;
      setStatus({ key: "asr", ok: true, text: `ready (${MODELS[sv].name} + ${MODELS[DEFAULT_MODELS.en].name}, ${Math.round(performance.now() - t0)} ms)` });
    } catch (err) {
      setStatus({ key: "asr", ok: false, text: String(err) });
    }
  });
  return engineLoad;
}

/** Restarts the speech process after a crash; the dictation in progress, if any, has failed. */
function speechEngineExited(exited: WhisperProcessEngine, reason: string): void {
  if (engine !== exited) return; // replaced or shutting down
  engine = null;
  engineReady = false;
  const delay = engineRestarts.crashed(Date.now());
  if (delay === null) {
    setStatus({ key: "asr", ok: false, text: `speech engine keeps stopping (${reason}); restart Diktatorn` });
    return;
  }
  setStatus({ key: "asr", ok: false, text: `speech engine stopped (${reason}); restarting…` });
  setTimeout(() => void loadSpeechEngine(), delay);
}

/** Starts or stops the cleanup model to match the setting and what is on disk. */
async function syncCleaner(): Promise<void> {
  const wanted = settings.current.smartCleanup;
  if (!wanted || !models.isReady(DEFAULT_CLEANUP_MODEL)) {
    cleaner?.close();
    cleaner = null;
    cleanerReady = false;
    setStatus(wanted
      ? { key: "cleanup", ok: true, text: `rules only until ${MODELS[DEFAULT_CLEANUP_MODEL].name} is downloaded` }
      : { key: "cleanup", ok: true, text: "rules only (smart cleanup is off)" });
    return;
  }
  if (cleaner) return;
  if (!existsSync(binary("diktatorn-llm"))) {
    setStatus({ key: "cleanup", ok: false, text: "rules only; missing language-model process, run npm run build:native" });
    return;
  }
  const current = new LlamaCleaner(binary("diktatorn-llm"), models.path(DEFAULT_CLEANUP_MODEL));
  current.onExit((reason) => cleanerExited(current, reason));
  cleaner = current;
  setStatus({ key: "cleanup", ok: true, text: "rules only while the language model loads…" });
  const t0 = performance.now();
  try {
    await current.ready;
    if (cleaner !== current) return; // turned off while loading
    cleanerReady = true;
    setStatus({ key: "cleanup", ok: true, text: `rules + ${MODELS[DEFAULT_CLEANUP_MODEL].name} (ready in ${Math.round(performance.now() - t0)} ms)` });
  } catch (err) {
    if (cleaner === current) setStatus({ key: "cleanup", ok: false, text: `rules only; language model failed: ${String(err)}` });
  }
}

/** Restarts the language model after a crash; dictations use the rules meanwhile. */
function cleanerExited(exited: LlamaCleaner, reason: string): void {
  if (cleaner !== exited) return; // turned off, replaced or shutting down
  cleaner = null;
  cleanerReady = false;
  const delay = cleanerRestarts.crashed(Date.now());
  if (delay === null) {
    setStatus({ key: "cleanup", ok: false, text: `rules only; the language model keeps stopping (${reason})` });
    return;
  }
  setStatus({ key: "cleanup", ok: true, text: `rules only; language model stopped (${reason}), restarting…` });
  setTimeout(() => void syncCleaner(), delay);
}

/** Applies a settings change to the running app. */
function applySettings(before: Settings, after: Settings): void {
  if (after.hotkey !== before.hotkey) {
    helper?.request("hotkey", { key: after.hotkey }).catch(() => {});
    const keys = statuses.get("keys");
    if (keys?.ok) setStatus({ key: "keys", ok: true, text: `hold ${KEY_NAMES[after.hotkey]} to dictate, double-tap for hands-free` });
  }
  if (after.microphoneId !== before.microphoneId) captureWin?.webContents.send(IPC.captureDevice, after.microphoneId);
  if (after.appearance !== before.appearance) nativeTheme.themeSource = after.appearance;
  if (after.swedishModel !== before.swedishModel) {
    models.download([after.swedishModel]);
    void loadSpeechEngine();
  }
  if (after.smartCleanup !== before.smartCleanup) {
    if (after.smartCleanup) models.download([DEFAULT_CLEANUP_MODEL]);
    void syncCleaner();
  }
}

const PERMISSION_HINT = "Diktatorn in System Settings → Privacy & Security";
/** The dictation key's status while the helper has no working tap yet. */
function waitingKeysStatus(accessibility: boolean, keyboard: boolean): StatusUpdate {
  if (!accessibility) {
    return { key: "keys", ok: false, text: `Accessibility not granted. Allow ${PERMISSION_HINT} → Accessibility; the dictation key starts working as soon as it is on.` };
  }
  // Accessibility normally brings keyboard access with it, and the helper then restarts with a working tap.
  if (keyboard) return { key: "keys", ok: true, text: "keyboard access granted; restarting helper…" };
  return { key: "keys", ok: false, text: `no keyboard access. Add ${PERMISSION_HINT} → Input Monitoring with +; the dictation key starts working as soon as it is on.` };
}
/** The System Settings pane for each permission. These fixed URLs are the only ones the app window can open. */
const SETTINGS_PANES: Record<Permission, string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
};

/** `restarted`: the helper is coming back, after it got keyboard access or after a crash, so it won't ask for Accessibility again. */
function startHelper(restarted = false): void {
  if (!existsSync(binary("diktatorn-helper"))) {
    setStatus({ key: "keys", ok: false, text: "missing helper; run npm run build:native" });
    return;
  }
  const env = restarted ? { ...process.env, DIKTATORN_HELPER_RESTARTED: "1" } : process.env;
  const proc = new JsonLinesProcess("helper", binary("diktatorn-helper"), env);
  helper = proc;
  type HelperEvent = {
    event: string; down?: boolean; t: number; keyboard?: boolean; accessibility?: boolean;
    tap?: boolean; tapActive?: boolean; hid?: boolean; message?: string; reason?: string;
  };
  proc.on("event", (msg: HelperEvent) => {
    switch (msg.event) {
      case "ready": {
        proc.request("hotkey", { key: settings.current.hotkey }).catch(() => {});
        const key = KEY_NAMES[settings.current.hotkey];
        helperPermissions.accessibility = msg.accessibility ?? false;
        setStatus(msg.keyboard
          ? { key: "keys", ok: true, text: `hold ${key} to dictate, double-tap for hands-free (HID ${msg.hid ? "on" : "off"}, event tap ${msg.tapActive ? "active" : msg.tap ? "listen-only, Esc not swallowed" : "off"})` }
          : waitingKeysStatus(msg.accessibility ?? false, false));
        setStatus(msg.accessibility
          ? { key: "paste", ok: true, text: "pastes into the frontmost app" }
          : { key: "paste", ok: false, text: `Accessibility not granted; transcripts are left on the clipboard. Allow ${PERMISSION_HINT} → Accessibility.` });
        break;
      }
      case "permission":
        setStatus(waitingKeysStatus(true, true));
        break;
      case "accessibility":
        helperPermissions.accessibility = true;
        setStatus({ key: "paste", ok: true, text: "pastes into the frontmost app" });
        if (msg.keyboard !== undefined) setStatus(waitingKeysStatus(true, msg.keyboard));
        break;
      case "debug":
        console.log(`[helper] debug ${JSON.stringify(msg)}`);
        break;
      case "hotkey":
        act(msg.down ? hotkey.down(msg.t) : hotkey.up(msg.t));
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
  proc.on("exit", (code: number | null, signal: string | null) => {
    if (helper !== proc) return; // superseded or shutting down
    if (code === HELPER_EXIT_PERMISSION_GRANTED) {
      startHelper(true);
      return;
    }
    helper = null;
    const reason = `code ${code}, signal ${signal}`;
    const delay = helperRestarts.crashed(Date.now());
    if (delay === null) {
      setStatus({ key: "keys", ok: false, text: `keyboard helper keeps stopping (${reason}); restart Diktatorn` });
      return;
    }
    setStatus({ key: "keys", ok: false, text: `keyboard helper stopped (${reason}); restarting…` });
    setTimeout(() => startHelper(true), delay);
  });
}

async function openDebugWindow(): Promise<void> {
  if (debugWin) {
    debugWin.show();
    return;
  }
  await app.dock?.show();
  debugWin = new BrowserWindow({ width: 760, height: 640, title: "Diktatorn — debug", webPreferences });
  debugWin.webContents.on("did-finish-load", () => {
    statuses.forEach((s) => debugWin?.webContents.send(IPC.debugStatus, s));
    sendBenchState();
  });
  debugWin.on("closed", () => {
    debugWin = null;
    bench?.stop(); // dictation goes back to inserting text
  });
  await debugWin.loadFile(renderer("debug.html"));
}

ipcMain.on(IPC.captureStarted, (e, ms: number) => {
  if (from(captureWin, e)) micStartMs = ms;
});
ipcMain.on(IPC.captureAudio, (e, samples: Float32Array) => {
  if (!from(captureWin, e)) return;
  queue = queue.then(() => handleAudio(samples)).catch(fail);
});
ipcMain.on(IPC.captureLevel, (e, level: unknown) => {
  if (from(captureWin, e) && typeof level === "number") overlay?.level(level);
});
ipcMain.on(IPC.captureError, (e, message: string) => {
  if (from(captureWin, e)) setStatus({ key: "mic", ok: false, text: message });
});
ipcMain.on(IPC.debugRecord, (e, down: boolean) => {
  if (from(debugWin, e)) act(down ? hotkey.down(performance.now()) : hotkey.up(performance.now()));
});

ipcMain.on(IPC.debugBench, (e, command: BenchCommand) => {
  if (!from(debugWin, e) || !bench) return;
  runBenchCommand(bench, command).catch(benchFailed);
});

ipcMain.handle(IPC.appGetState, (e) => {
  if (!fromApp(e)) throw new Error("not allowed");
  return appState();
});
ipcMain.handle(IPC.appSetSettings, async (e, patch: Partial<Settings>) => {
  if (!fromApp(e)) throw new Error("not allowed");
  const before = settings.current;
  const after = await settings.update(patch);
  applySettings(before, after);
  pushState();
  return after;
});
ipcMain.handle(IPC.appSetDictionary, async (e, entries: DictionaryEntry[]) => {
  if (!fromApp(e)) throw new Error("not allowed");
  try {
    await saveDictionary(dictionaryFile.path, entries);
    await refreshDictionary();
    pushState();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
});
ipcMain.on(IPC.appDownload, (e, ids: unknown) => {
  if (!fromApp(e) || !Array.isArray(ids)) return;
  models.download(ids.filter((id): id is ModelId => typeof id === "string" && id in MODELS));
});
ipcMain.on(IPC.appCancelDownload, (e) => {
  if (fromApp(e)) models.cancel();
});
ipcMain.on(IPC.appCopy, (e, text: unknown) => {
  if (fromApp(e) && typeof text === "string") clipboard.writeText(text);
});
ipcMain.on(IPC.appOpenSettings, (e, permission: unknown) => {
  if (fromApp(e) && typeof permission === "string" && Object.hasOwn(SETTINGS_PANES, permission)) {
    void shell.openExternal(SETTINGS_PANES[permission as Permission]);
  }
});

models.on("change", () => {
  if (setup && FIRST_RUN_MODELS.every((id) => models.isReady(id))) setup = false;
  pushState();
});
models.on("ready", (id: ModelId) => {
  if (id === DEFAULT_CLEANUP_MODEL) void syncCleaner();
  else void loadSpeechEngine();
});

/**
 * `npm run package` starts the signed app with DIKTATORN_LAUNCH_CHECK=1 to prove that it loads its
 * frameworks, helper processes and packaged files, and quits before it would ask for any permission.
 */
async function launchCheck(): Promise<void> {
  const win = new BrowserWindow({ show: false, webPreferences });
  await win.loadFile(renderer("overlay.html"));
  const icon = nativeImage.createFromPath(join(app.getAppPath(), "assets", "trayTemplate.png"));
  console.log(icon.isEmpty() ? "launch check: menu bar icon missing" : "launch check: ok");
  app.exit(icon.isEmpty() ? 1 : 0);
}

app.whenReady().then(async () => {
  if (process.env.DIKTATORN_LAUNCH_CHECK) return launchCheck();
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "media"));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === "media");
  // View has only the zoom items, so text in the app window can be made larger (⌘+, ⌘−, ⌘0).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: "appMenu" },
      { role: "editMenu" },
      { label: "View", submenu: [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }] },
      { role: "windowMenu" },
    ]),
  );

  await settings.load();
  nativeTheme.themeSource = settings.current.appearance;
  await refreshDictionary();
  const missing = FIRST_RUN_MODELS.filter((id) => !models.isReady(id));
  setup = missing.length > 0;

  captureWin = new BrowserWindow({
    show: false,
    webPreferences: { ...webPreferences, backgroundThrottling: false, autoplayPolicy: "no-user-gesture-required" },
  });
  await captureWin.loadFile(renderer("capture.html"));
  captureWin.webContents.send(IPC.captureDevice, settings.current.microphoneId);
  overlay = await Overlay.create(renderer("overlay.html"), webPreferences);
  // Development builds run inside a copy of Electron's bundle, which carries Electron's icon.
  app.dock?.setIcon(join(app.getAppPath(), "assets", "icon.png"));
  tray = createTray(join(app.getAppPath(), "assets", "trayTemplate.png"), {
    open: () => void appWindow.show(),
    debug: () => void openDebugWindow(),
    benchmark: bench ? () => void recordBenchmark(bench).catch(benchFailed) : undefined,
  });
  void appWindow.show();

  setStatus({ key: "recording", ok: true, text: "idle" });
  if (missing.length > 0) models.download(missing);
  // A pending permission prompt must not hold up the helpers, so none of these block each other.
  startHelper();
  void loadSpeechEngine();
  void syncCleaner();
  void ensureMicrophone();
});

// Dictation works without any window, so closing them does not quit the app.
app.on("window-all-closed", () => {});
app.on("activate", () => void appWindow.show());
app.on("will-quit", () => {
  tray?.destroy();
  // Cleared first, so the exits that follow are not treated as crashes.
  const [e, c] = [engine, cleaner];
  engine = null;
  cleaner = null;
  e?.close();
  c?.close();
  const h = helper;
  helper = null;
  h?.close();
});
